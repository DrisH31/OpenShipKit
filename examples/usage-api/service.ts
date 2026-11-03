import "server-only";

//
// The usage-billed API example: your customers call your API with keys they
// mint themselves, every call is counted against their plan, and with a
// metered price it is billed (docs/usage.md). What it shows:
//
//   - Customer API keys: minted by a signed-in person, shown once, stored as a
//     SHA-256 only, revocable, never returned again. A banned person's keys
//     stop working at once.
//   - Metering that holds the limit exactly: each call is one consumeUsage(),
//     which checks the plan's `api_calls` limit and records the call in one
//     atomic step. The caller's Idempotency-Key header (or a fresh id) is the
//     event key, so a retried request is never counted twice.
//   - Metered billing for free: with BILLING_METERED_METRICS=api_calls on
//     Polar or Stripe, every recorded call is reported to the provider's
//     meter by the kit's outbox. Nothing here talks to a provider.
//   - The write path: assertNotDemo, zod, the store, recordAudit.
//
// The API's own work is a stand-in (it echoes text back, shouted): replace
// runWork() with yours.
//

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { User } from "@/core/types";
import { getData } from "@/server/data";
import { assertNotDemo } from "@/server/demo";
import { dataProvider } from "@/server/env";
import { recordAudit } from "@/server/services/audit";
import { ServiceError, parseInput } from "@/server/services/errors";
import { consumeUsage } from "@/server/services/usage";
import { createMemoryApiKeyStore, type ApiKey, type ApiKeyStore } from "./store";

/** The metric each call counts against (a plan's limits.api_calls; BILLING_METERED_METRICS). */
export const METRIC = "api_calls";
const KEY_PREFIX = "uk_";

let memory: ApiKeyStore | null = null;

export async function getApiKeyStore(): Promise<ApiKeyStore> {
  if (dataProvider() === "memory") return (memory ??= createMemoryApiKeyStore());
  const { createPostgresApiKeyStore } = await import("./store-postgres");
  return createPostgresApiKeyStore();
}

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const actor = (user: User) => ({ type: "user" as const, id: user.id, label: user.email });

export const mintSchema = z.strictObject({ name: z.string().trim().min(1, "Name the key, so you can tell it apart later.").max(60) });

/** Mint a key for this person. The key is in the answer once, and never again. Audited (without the key). */
export async function mintApiKey(user: User, input: unknown): Promise<{ key: string; apiKey: ApiKey }> {
  assertNotDemo(user);
  const { name } = parseInput(mintSchema, input);
  const store = await getApiKeyStore();
  if ((await store.list(user.id)).filter((k) => !k.revokedAt).length >= 10) throw new ServiceError("conflict", "You have 10 live keys. Revoke one first.");
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const apiKey = await store.create({ userId: user.id, name, prefix: key.slice(0, 8), hash: hashKey(key) });
  await recordAudit(actor(user), "example_api_key.create", "example_api_key", apiKey.id, null, apiKey);
  return { key, apiKey };
}

export async function listApiKeys(user: User): Promise<ApiKey[]> {
  return (await getApiKeyStore()).list(user.id);
}

export async function revokeApiKey(user: User, id: string): Promise<void> {
  assertNotDemo(user);
  if (!(await (await getApiKeyStore()).revoke(user.id, id))) throw new ServiceError("not_found", "No such live key of yours.");
  await recordAudit(actor(user), "example_api_key.revoke", "example_api_key", id, null, { revoked: true });
}

/** The person an `Authorization: Bearer uk_…` header belongs to, or null (no key, a revoked one, a banned person). */
export async function authenticateApiKey(header: string | null): Promise<User | null> {
  const key = /^Bearer\s+(uk_[A-Za-z0-9_-]{20,100})$/.exec(header?.trim() ?? "")?.[1];
  if (!key) return null;
  const store = await getApiKeyStore();
  const found = await store.findActiveByHash(hashKey(key));
  if (!found) return null;
  const user = await (await getData()).users.getById(found.userId);
  if (!user || user.banned) return null;
  await store.touch(found.id, new Date().toISOString());
  return user;
}

export const callSchema = z.strictObject({ text: z.string().min(1).max(10_000) });

/** Stand-in for your API's real work. */
function runWork({ text }: z.output<typeof callSchema>) {
  return { result: text.toUpperCase() };
}

/**
 * One API call: validated, counted against the plan (atomically, refused past the limit), then done.
 * `requestId` dedupes: the same id again is the same call, not a second one (and is answered again).
 */
export async function callApi(user: User, requestId: string, input: unknown): Promise<{ result: string; usage: { used: number; limit: number | null } }> {
  const parsed = parseInput(callSchema, input);
  const { used, limit } = await consumeUsage({ type: "user", id: user.id }, METRIC, 1, { key: requestId });
  return { ...runWork(parsed), usage: { used, limit } };
}
