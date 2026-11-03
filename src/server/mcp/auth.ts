import "server-only";

//
// Who is calling /api/mcp. Two ways in:
//
//   1. An agent key (osk_…) minted in /admin/agents or with `npm run mcp:key`,
//      looked up by its SHA-256 (src/server/services/agent-keys.ts).
//   2. MCP_DEV_KEY from .env.local — ONLY while the site runs on the local
//      demo database (isDemo()) and NODE_ENV is not "production". It acts as
//      an admin key named "MCP_DEV_KEY", so development needs no minted key.
//      Set on a real server it does nothing, by design.
//
// Also: the Origin check that stops a web page in the person's browser from
// reaching a local server through DNS rebinding, and the per-IP block on
// failed authentications (counted by src/server/rate-limit.ts).
//

import { timingSafeEqual } from "node:crypto";
import type { AgentKey } from "@/core/types";
import { isDemo, isProduction, optionalEnv, siteUrl } from "@/server/env";
import { rateLimit } from "@/server/rate-limit";
import { agentActor, authenticateAgentKey } from "@/server/services/agent-keys";
import type { ToolContext } from "./types";

/** The id the dev key carries in the audit log and in agent_keys_list's `you`. */
export const DEV_KEY_ID = "mcp-dev-key";

/** A dev key shorter than this is ignored: it would be guessable. */
const DEV_KEY_MIN_LENGTH = 24;

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when MCP_DEV_KEY may be used right now (local demo, not production). */
export function devKeyAllowed(): boolean {
  return !isProduction() && isDemo();
}

function devKey(bearer: string): AgentKey | null {
  const configured = optionalEnv("MCP_DEV_KEY");
  if (!configured || configured.length < DEV_KEY_MIN_LENGTH || !devKeyAllowed()) return null;
  if (!sameSecret(bearer, configured)) return null;
  return {
    id: DEV_KEY_ID,
    name: "MCP_DEV_KEY",
    scope: "admin",
    hint: configured.slice(-6),
    createdAt: new Date(0).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    // Minted by the environment, not by an admin: nothing to revoke it with.
    createdBy: null,
  };
}

/** The bearer token of an Authorization header, or null. */
export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/** Bearer token → the caller's tool context, or null when it opens nothing. */
export async function authenticateMcp(bearer: string | null): Promise<ToolContext | null> {
  if (!bearer || bearer.length > 200) return null;
  const key = devKey(bearer) ?? (await authenticateAgentKey(bearer));
  return key ? { key, actor: agentActor(key) } : null;
}

/**
 * Origins a browser may call /api/mcp from: the site itself and anything in
 * MCP_ALLOWED_ORIGINS (comma-separated, e.g. a web-based MCP inspector).
 * Requests without an Origin header (every desktop and CLI client) pass.
 */
export function allowedOrigins(): string[] {
  const extra = (optionalEnv("MCP_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  let site: string[] = [];
  try {
    site = [new URL(siteUrl()).origin];
  } catch {
    // A malformed NEXT_PUBLIC_SITE_URL allows no browser origin, which is the safe side.
  }
  return [...site, ...extra];
}

/** Is a request with this Origin header allowed? Missing → yes; "null" or anything unlisted → no. */
export function originAllowed(origin: string | null): boolean {
  if (origin === null) return true;
  return allowedOrigins().includes(origin.replace(/\/+$/, ""));
}

/** Failed authentications an IP may make per window before it is blocked. */
const AUTH_FAIL_LIMIT = 20;
const AUTH_FAIL_WINDOW_MS = 60_000;

/**
 * IPs that went over AUTH_FAIL_LIMIT, and when their block ends. Checked
 * before authenticateMcp, so an IP that is guessing costs no key lookup and a
 * right guess from it is refused too until the block ends. The failures
 * themselves are counted by rateLimit; only IPs over the limit land here, so
 * the map stays small and the cap is a backstop.
 */
const authBlocked = new Map<string, number>();
const MAX_BLOCKED = 10_000;

/** Seconds until `ip` may present a key again; 0 when it isn't blocked. */
export function authBlockedFor(ip: string, now = Date.now()): number {
  const until = authBlocked.get(ip);
  if (until === undefined) return 0;
  if (until <= now) {
    authBlocked.delete(ip);
    return 0;
  }
  return Math.ceil((until - now) / 1000);
}

/**
 * Count a failed authentication from `ip`. Returns the seconds it is now
 * blocked for (answer 429 with Retry-After), or 0 while it is under the limit.
 */
export function noteAuthFailure(ip: string, now = Date.now()): number {
  const limited = rateLimit(`mcp-auth:${ip}`, AUTH_FAIL_LIMIT, AUTH_FAIL_WINDOW_MS);
  if (limited.ok) return 0;
  if (authBlocked.size >= MAX_BLOCKED) {
    for (const [k, v] of authBlocked) if (v <= now) authBlocked.delete(k);
    // Still full of live blocks: drop the oldest (Map keeps insertion order).
    if (authBlocked.size >= MAX_BLOCKED) authBlocked.delete(authBlocked.keys().next().value as string);
  }
  authBlocked.set(ip, now + limited.retryAfterSeconds * 1000);
  return limited.retryAfterSeconds;
}
