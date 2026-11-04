//
// The usage-billed API example (examples/usage-api): the key store on memory
// and on Postgres (PGlite), and the API through its real route handler: keys,
// the plan's api_calls limit held exactly, idempotent retries, and metered
// billing through the kit's outbox.
//

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import { createPostgresStore } from "@/adapters/data/postgres";
import { drizzleOverPglite } from "@/adapters/data/postgres/db";
import { migrateEmbedded } from "@/adapters/data/postgres/embedded";
import { TEST_DATABASE_URL, connectExample } from "./postgres";
import type { DataStore } from "@/core/data";
import type { PlanInput, User } from "@/core/types";
import { createMemoryApiKeyStore, type ApiKeyStore } from "../../examples/usage-api/store";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
const meter = vi.hoisted(() => ({ reports: [] as unknown[] }));
vi.mock("@/server/billing", () => ({
  getBilling: async () => ({ id: "stripe", label: "Stripe", hasPortal: true, reportUsage: async (r: unknown) => void meter.reports.push(r) }),
}));

const { createPostgresApiKeyStore } = await import("../../examples/usage-api/store-postgres");

// ---------------------------------------------------------------- the store contract

function describeContract(name: string, make: () => Promise<{ store: ApiKeyStore; users: [string, string] }>) {
  describe(`api key store: ${name}`, () => {
    it("finds a live key by its hash only, lists a person's own, revokes once", async () => {
      const { store: s, users: [a, b] } = await make();
      const k = await s.create({ userId: a, name: "CI", prefix: "uk_abcde", hash: `h-${crypto.randomUUID()}` });
      const hash = `h-other-${crypto.randomUUID()}`;
      await s.create({ userId: b, name: "Theirs", prefix: "uk_zzzzz", hash });
      expect((await s.list(a)).map((x) => x.name)).toEqual(["CI"]);
      expect(await s.revoke(b, k.id)).toBe(false); // not theirs
      expect(await s.revoke(a, k.id)).toBe(true);
      expect(await s.revoke(a, k.id)).toBe(false); // already revoked
      expect((await s.list(a))[0].revokedAt).not.toBeNull();
      expect(await s.findActiveByHash(hash)).toMatchObject({ userId: b });
    });

    it("claims an Idempotency-Key once per window, takes back an unanswered one after its lease with the same id", async () => {
      const { store: s, users: [a] } = await make();
      const k = await s.create({ userId: a, name: "CI", prefix: "uk_abcde", hash: `h-${crypto.randomUUID()}` });
      const claim = (bodyHash: string, o: { windowMs?: number; leaseMs?: number } = {}) =>
        s.claimRequest({ apiKeyId: k.id, key: "i1", bodyHash, windowMs: o.windowMs ?? 86_400_000, leaseMs: o.leaseMs ?? 60_000 });
      const first = await claim("b1");
      expect(first.claimed).toBe(true);
      // Leased: another claim (same or other body) gets it back as it is.
      expect(await claim("b2")).toMatchObject({ claimed: false, request: { id: first.request.id, bodyHash: "b1", response: null } });
      expect((await claim("b1")).claimed).toBe(false);
      // The lease over (a zero lease here), same body: taken back with the SAME id; another body isn't.
      expect(await claim("b2", { leaseMs: 0 })).toMatchObject({ claimed: false });
      expect(await claim("b1", { leaseMs: 0 })).toMatchObject({ claimed: true, request: { id: first.request.id } });
      // A renewed lease holds off a takeover for its length again (the work is still running).
      await s.renewLease(first.request.id);
      expect((await claim("b1", { leaseMs: 60_000 })).claimed).toBe(false);
      // Answered: replayed, whatever the lease.
      await s.saveResponse(first.request.id, { result: "A" });
      expect(await claim("b1", { leaseMs: 0 })).toMatchObject({ claimed: false, request: { response: { result: "A" } } });
      // Past the window (a zero window here), the key is a new request with a new id.
      const later = await claim("b9", { windowMs: 0 });
      expect(later).toMatchObject({ claimed: true, request: { bodyHash: "b9", response: null } });
      expect(later.request.id).not.toBe(first.request.id);
      // Given back, it's claimed afresh; pruning deletes what's past the window.
      await s.releaseRequest(later.request.id);
      expect((await claim("b3")).claimed).toBe(true);
      expect(await s.pruneRequests(k.id, 0)).toBeGreaterThanOrEqual(1);
    });
  });
}

describeContract("memory", async () => ({ store: createMemoryApiKeyStore(), users: [crypto.randomUUID(), crypto.randomUUID()] }));

describe("api key store on postgres (PGlite)", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzleOverPglite>;
  beforeAll(async () => {
    client = new PGlite();
    await migrateEmbedded(client);
    const statements = readFileSync(fileURLToPath(new URL("../../examples/usage-api/migration.sql", import.meta.url)), "utf8").split("--> statement-breakpoint");
    for (let i = 0; i < 2; i++) for (const s of statements) await client.exec(s);
    db = drizzleOverPglite(client);
  }, 60_000);
  afterAll(async () => {
    await client?.close();
  });
  describeContract("postgres", async () => {
    const users = createPostgresStore({ db }).users;
    const make = async () =>
      (await users.upsertFromIdentity({ provider: "better-auth", providerUserId: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, name: null, image: null, emailVerified: true }, { makeAdmin: false })).id;
    return { store: createPostgresApiKeyStore({ db }), users: [await make(), await make()] };
  });
});

describe.skipIf(!TEST_DATABASE_URL)("api key store on a Postgres server (TEST_DATABASE_URL)", () => {
  let handle: Awaited<ReturnType<typeof connectExample>>;
  beforeAll(async () => {
    handle = await connectExample("usage-api");
  }, 60_000);
  afterAll(async () => {
    await handle?.close();
  });
  describeContract("postgres server", async () => {
    const users = createPostgresStore({ db: handle.db }).users;
    const make = async () =>
      (await users.upsertFromIdentity({ provider: "better-auth", providerUserId: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, name: null, image: null, emailVerified: true }, { makeAdmin: false })).id;
    return { store: createPostgresApiKeyStore({ db: handle.db }), users: [await make(), await make()] };
  });
});

// ---------------------------------------------------------------- the API

describe("the usage-billed API", () => {
  const svc = () => import("../../examples/usage-api/service");
  const route = () => import("../../examples/usage-api/routes/call");
  let user: User;
  const plan = (key: string, over: Partial<PlanInput> = {}): PlanInput => ({
    key, name: key, description: "", features: [], prices: [], highlighted: false, contactSales: false, ctaLabel: "Go", trialDays: null, active: true, sortOrder: 1, ...over,
  });
  const call = async (key: string, body: unknown, idem?: string) =>
    (await route()).POST(
      new Request("https://example.com/api/v1/shout", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(idem ? { "idempotency-key": idem } : {}) },
        body: JSON.stringify(body),
      }),
    );

  beforeEach(async () => {
    vi.stubEnv("DATA_PROVIDER", "memory");
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv("BILLING_METERED_METRICS", "api_calls");
    store = createMemoryStore({ fresh: true });
    meter.reports = [];
    for (const p of await store.plans.list({})) await store.plans.delete(p.key);
    await store.plans.upsert(plan("free", { sortOrder: 0, limits: { api_calls: 3 } }));
    user = await store.users.upsertFromIdentity({ provider: "better-auth", providerUserId: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, name: null, image: null, emailVerified: true }, { makeAdmin: false });
  });

  it("a minted key calls the API; the key is shown once and stored only as a hash", async () => {
    const { mintApiKey, listApiKeys } = await svc();
    const { key, apiKey } = await mintApiKey(user, { name: "CI" });
    expect(key).toMatch(/^uk_[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(await listApiKeys(user))).not.toContain(key.slice(8));
    expect(apiKey.prefix).toBe(key.slice(0, 8));
    const res = await call(key, { text: "hello" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "HELLO", usage: { used: 1, limit: 3 } });
  });

  it("no key, a wrong key or a revoked key is 401", async () => {
    const { mintApiKey, revokeApiKey } = await svc();
    const { key, apiKey } = await mintApiKey(user, { name: "CI" });
    expect((await call("uk_" + "x".repeat(43), { text: "a" })).status).toBe(401);
    await revokeApiKey(user, apiKey.id);
    expect((await call(key, { text: "a" })).status).toBe(401);
    const bare = await (await route()).POST(new Request("https://example.com/api/v1/shout", { method: "POST", body: "{}" }));
    expect(bare.status).toBe(401);
  });

  it("an Idempotency-Key replays the first answer, refuses another body, and is never free work", async () => {
    const { mintApiKey } = await svc();
    const { key } = await mintApiKey(user, { name: "CI" });
    const first = await call(key, { text: "a" }, "req-1");
    expect(await first.json()).toEqual({ result: "A", usage: { used: 1, limit: 3 } });
    const again = await call(key, { text: "a" }, "req-1");
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await again.json()).toEqual({ result: "A", usage: { used: 1, limit: 3 } }); // replayed, not re-run
    // The review's exploit: reuse the key with new bodies once the limit is reached.
    await call(key, { text: "b" }, "req-2");
    await call(key, { text: "c" }, "req-3");
    expect((await call(key, { text: "d" }, "req-4")).status).toBe(429);
    for (let i = 0; i < 5; i++) {
      const r = await call(key, { text: `free-${i}` }, "req-1");
      expect(r.status).toBe(422);
    }
    expect(await store.usage.sum({ type: "user", id: user.id }, "api_calls", "2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z")).toBe(3);
    // A refused call gives its key back: after an upgrade the same key works.
    await store.plans.upsert(plan("free", { sortOrder: 0, limits: { api_calls: 10 } }));
    expect((await call(key, { text: "d" }, "req-4")).status).toBe(200);
  });

  it("a call that fails after it was counted is never charged twice: the retry after the lease reuses its id", async () => {
    const { mintApiKey, getApiKeyStore } = await svc();
    const { key } = await mintApiKey(user, { name: "CI" });
    const apiStore = await getApiKeyStore();
    const save = vi.spyOn(apiStore, "saveResponse").mockRejectedValueOnce(new Error("disk full"));
    await expect(call(key, { text: "a" }, "crash-1")).rejects.toThrow("disk full");
    save.mockRestore();
    // Within the lease: still being answered.
    expect((await call(key, { text: "a" }, "crash-1")).status).toBe(409);
    // After it: taken back with the same id; the usage already recorded is deduplicated.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    try {
      const retry = await call(key, { text: "a" }, "crash-1");
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ result: "A", usage: { used: 1 } });
    } finally {
      vi.useRealTimers();
    }
    expect(await store.usage.sum({ type: "user", id: user.id }, "api_calls", "2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z")).toBe(1);
  });

  it("a failure after the usage was committed (queueing its report) keeps the key: one event, one meter report", async () => {
    const { mintApiKey } = await svc();
    const { runDueJobs } = await import("@/server/jobs");
    const { sweepUsageReports } = await import("@/server/services/usage");
    await store.billing.setCustomerId(user.id, "stripe", "cus_api");
    const { key } = await mintApiKey(user, { name: "CI" });
    const enqueue = vi.spyOn(store.jobs, "enqueue").mockRejectedValueOnce(new Error("db blip"));
    await expect(call(key, { text: "a" }, "outbox-1")).rejects.toThrow("db blip");
    enqueue.mockRestore();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    try {
      expect(await (await call(key, { text: "a" }, "outbox-1")).json()).toMatchObject({ usage: { used: 1 } });
      await sweepUsageReports(Date.now() + 10 * 60_000);
      await runDueJobs();
    } finally {
      vi.useRealTimers();
    }
    expect(await store.usage.sum({ type: "user", id: user.id }, "api_calls", "2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z")).toBe(1);
    expect(meter.reports).toHaveLength(1);
  });

  it("refuses an Idempotency-Key over 200 characters instead of cutting it", async () => {
    const { mintApiKey } = await svc();
    const { key } = await mintApiKey(user, { name: "CI" });
    expect((await call(key, { text: "a" }, "k".repeat(201))).status).toBe(400);
  });

  it("holds the plan's limit exactly under concurrency", async () => {
    const { mintApiKey } = await svc();
    const { key } = await mintApiKey(user, { name: "CI" });
    expect((await call(key, { text: "a" }, "req-1")).status).toBe(200);
    const statuses = await Promise.all(Array.from({ length: 6 }, (_, i) => call(key, { text: "b" }, `burst-${i}`).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(2); // 3 allowed, 1 already used
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
  });

  it("with a metered price, every counted call is reported to the provider's meter", async () => {
    const { mintApiKey } = await svc();
    const { runDueJobs } = await import("@/server/jobs");
    await store.billing.setCustomerId(user.id, "stripe", "cus_api");
    const { key } = await mintApiKey(user, { name: "CI" });
    await call(key, { text: "a" }, "m-1");
    await call(key, { text: "b" }, "m-2");
    await runDueJobs();
    expect(meter.reports).toEqual([
      expect.objectContaining({ customerId: "cus_api", metric: "api_calls", quantity: 1 }),
      expect.objectContaining({ customerId: "cus_api", metric: "api_calls", quantity: 1 }),
    ]);
  });

  it("refuses bad input and a banned person's key", async () => {
    const { mintApiKey } = await svc();
    const { key } = await mintApiKey(user, { name: "CI" });
    expect((await call(key, { nope: 1 })).status).toBe(400);
    await store.users.update(user.id, { banned: true });
    expect((await call(key, { text: "a" })).status).toBe(401);
  });
});
