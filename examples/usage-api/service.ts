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
//     atomic step.
//   - Idempotency the way Stripe does it: an Idempotency-Key is claimed per API
//     key for 24 hours. The same key with the same body replays the first
//     answer (no work, no charge); the same key with another body is refused
//     (422); one still being answered is 409. A key is never a way to run new
//     work without being counted.
//   - Whose plan: the person's. Keys belong to a person, so a team's plan
//     doesn't apply here; for a team API, mint keys per organisation and meter
//     { type: "org" } (usageSubject with the key's orgId).
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

/** The person (and key) an `Authorization: Bearer uk_…` header belongs to, or null (no key, a revoked one, a banned person). */
export async function authenticateApiKey(header: string | null): Promise<{ user: User; apiKey: ApiKey } | null> {
  const key = /^Bearer\s+(uk_[A-Za-z0-9_-]{20,100})$/.exec(header?.trim() ?? "")?.[1];
  if (!key) return null;
  const store = await getApiKeyStore();
  const found = await store.findActiveByHash(hashKey(key));
  if (!found) return null;
  const user = await (await getData()).users.getById(found.userId);
  if (!user || user.banned) return null;
  await store.touch(found.id, new Date().toISOString());
  return { user, apiKey: found };
}

export const callSchema = z.strictObject({ text: z.string().min(1).max(10_000) });

/** Stand-in for your API's real work. */
function runWork({ text }: z.output<typeof callSchema>) {
  return { result: text.toUpperCase() };
}

/** How long an Idempotency-Key means "the same request" (Stripe keeps them 24 hours). */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60_000;
/** How long an unanswered request holds its key before a retry may take it over (with the same id). */
export const IDEMPOTENCY_LEASE_MS = 60_000;

type Answer = { result: string; usage: { used: number; limit: number | null } };

/**
 * One API call: validated, counted against the plan (atomically, refused past the limit), then done.
 *
 * With an Idempotency-Key, Stripe's rule, safe at every point the process can die:
 *   - the same key and body, answered: the saved answer is replayed (`replayed`), with the usage as
 *     of that first answer; no work, no charge;
 *   - another body: a conflict (reason idempotency_mismatch, 422);
 *   - still being answered: a conflict (reason in_progress, 409), until its lease (a minute) ends;
 *   - refused before anything was counted (the limit, bad input): the key is given back;
 *   - counted, then failed (the work threw, the process died): the key is NOT given back. A retry
 *     after the lease takes the same request id, the usage event already recorded under it is
 *     deduplicated, the work runs again, and the answer is saved. One request is charged once.
 * Each API key's expired requests are deleted as it calls.
 */
export async function callApi(caller: { user: User; apiKey: ApiKey }, idempotencyKey: string | null, input: unknown): Promise<Answer & { replayed?: true }> {
  const parsed = parseInput(callSchema, input);
  if (idempotencyKey !== null && (idempotencyKey.length < 1 || idempotencyKey.length > 200)) {
    throw new ServiceError("invalid", "An Idempotency-Key is 1 to 200 characters.");
  }
  const store = await getApiKeyStore();
  const bodyHash = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  let requestId: string = crypto.randomUUID();
  if (idempotencyKey) {
    await store.pruneRequests(caller.apiKey.id, IDEMPOTENCY_WINDOW_MS);
    const { claimed, request } = await store.claimRequest({ apiKeyId: caller.apiKey.id, key: idempotencyKey, bodyHash, windowMs: IDEMPOTENCY_WINDOW_MS, leaseMs: IDEMPOTENCY_LEASE_MS });
    if (!claimed) {
      if (request.bodyHash !== bodyHash) throw new ServiceError("conflict", "This Idempotency-Key was used for a different request. Use a new key for new work.", { reason: "idempotency_mismatch" });
      if (request.response === null) throw new ServiceError("conflict", "A request with this Idempotency-Key is still being answered. Retry in a minute.", { reason: "in_progress" });
      return { ...(request.response as Answer), replayed: true };
    }
    requestId = request.id;
  }
  let counted: { used: number; limit: number | null };
  try {
    counted = await consumeUsage({ type: "user", id: caller.user.id }, METRIC, 1, { key: requestId });
  } catch (error) {
    // Nothing was counted (refused, or the count itself failed): the key is free for a retry.
    if (idempotencyKey) await store.releaseRequest(requestId);
    throw error;
  }
  // Counted from here: a failure leaves the claim, so the retry reuses this id and isn't charged again.
  const answer: Answer = { ...runWork(parsed), usage: { used: counted.used, limit: counted.limit } };
  if (idempotencyKey) await store.saveResponse(requestId, answer);
  return answer;
}
