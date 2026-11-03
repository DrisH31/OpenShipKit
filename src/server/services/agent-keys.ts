import "server-only";

//
// MCP agent keys. A key is shown ONCE, at minting; only its SHA-256 is stored.
// Losing a key means revoking it and minting another.
//
// Format: "osk_" + 43 base64url characters (32 random bytes).
//
// A key belongs to the admin who minted it (AgentKey.createdBy): when that
// person is demoted, banned or deleted, revokeKeysMintedBy() ends every key
// they made, so admin access over MCP never outlives admin access in the app.
// A key minted by another key inherits that key's creator; a key from the CLI
// (scripts/mcp-key.mts) has none and lives until it is revoked.
//

import { createHash, randomBytes } from "node:crypto";
import type { Actor, AgentKey, AgentScope } from "@/core/types";
import { agentScopeSchema } from "@/core/schemas";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { recordAudit } from "./audit";
import { ServiceError, parseInput } from "./errors";

export const AGENT_KEY_PREFIX = "osk_";

export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const SCOPE_RANK: Record<AgentScope, number> = { read: 0, write: 1, admin: 2 };

/** Does a key with scope `has` satisfy a tool that needs `needs`? */
export function scopeAllows(has: AgentScope, needs: AgentScope): boolean {
  return SCOPE_RANK[has] >= SCOPE_RANK[needs];
}

export async function mintAgentKey(name: unknown, scope: unknown, actor: Actor): Promise<{ key: string; agentKey: AgentKey }> {
  assertNotDemo(actor);
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName || cleanName.length > 60) throw new ServiceError("invalid", "Name the key (1–60 characters), e.g. \"Claude Code on my laptop\"");
  const parsedScope = parseInput(agentScopeSchema, scope);
  const data = await getData();
  const key = AGENT_KEY_PREFIX + randomBytes(32).toString("base64url");
  const agentKey = await data.agentKeys.create({
    name: cleanName,
    scope: parsedScope,
    keyHash: hashAgentKey(key),
    hint: key.slice(-6),
    createdBy: await creatorOf(actor),
  });
  await recordAudit(actor, "agent_key.create", "agent_key", agentKey.id, null, agentKey);
  return { key, agentKey };
}

/** Who owns a key `actor` mints: a person, the person behind an agent key, or nobody (the CLI, a webhook). */
async function creatorOf(actor: Actor): Promise<string | null> {
  if (!actor.id) return null;
  if (actor.type === "user") return actor.id;
  if (actor.type !== "agent") return null;
  const parent = (await (await getData()).agentKeys.list()).find((k) => k.id === actor.id);
  return parent?.createdBy ?? null;
}

export async function listAgentKeys(): Promise<AgentKey[]> {
  return (await getData()).agentKeys.list();
}

export async function revokeAgentKey(id: string, actor: Actor): Promise<AgentKey> {
  assertNotDemo(actor);
  const revoked = await (await getData()).agentKeys.revoke(id);
  if (!revoked) throw new ServiceError("not_found", `No agent key ${id}`);
  await recordAudit(actor, "agent_key.revoke", "agent_key", id, null, revoked);
  return revoked;
}

/**
 * Revoke every active key `userId` minted, auditing each one. The user
 * services call it when an admin is demoted, banned or deleted (before the
 * row goes: deleting the user clears createdBy). Returns how many it ended.
 */
export async function revokeKeysMintedBy(userId: string, actor: Actor, reason: "demoted" | "banned" | "deleted"): Promise<number> {
  assertNotDemo(actor);
  const data = await getData();
  const mine = (await data.agentKeys.list()).filter((k) => k.createdBy === userId && !k.revokedAt);
  for (const k of mine) {
    const revoked = await data.agentKeys.revoke(k.id);
    if (revoked) await recordAudit(actor, "agent_key.revoke", "agent_key", k.id, { revokedAt: null }, { ...revoked, reason: `creator ${reason}` });
  }
  return mine.length;
}

/**
 * Bearer token → active key, or null. Looked up by SHA-256: the key is 256
 * random bits, so a hash lookup leaks nothing useful through timing.
 */
export async function authenticateAgentKey(bearer: string | null | undefined): Promise<AgentKey | null> {
  if (!bearer || !bearer.startsWith(AGENT_KEY_PREFIX) || bearer.length > 100) return null;
  const hash = hashAgentKey(bearer);
  const data = await getData();
  const key = await data.agentKeys.findActiveByHash(hash);
  if (!key) return null;
  data.agentKeys.touch(key.id).catch((e) => console.error("[agent-keys] touch failed", e));
  return key;
}

export function agentActor(key: AgentKey): Actor {
  return { type: "agent", id: key.id, label: `agent:${key.name}` };
}
