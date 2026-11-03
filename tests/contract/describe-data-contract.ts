//
// The DataStore contract (src/core/data.ts) as a reusable suite. Every
// adapter runs it: tests/data-contract.test.ts calls describeDataContract for
// the memory store, the embedded PGlite database and (with
// TEST_DATABASE_URL) a real Postgres server. A new adapter passes when this
// suite passes on it.
//
//   describeDataContract(name, makeStore, hooks)   the whole contract
//   describePostgresBehaviour(name, getDb)         what only the SQL adapter promises
//                                                  (bad dates, foreign keys, racing sign-ins)
//   truncateAppTables(db)                          reset a Postgres between tests
//
// Tests are written to pass on a store that already holds seed rows (the
// memory store boots with SEED): they filter by unique tags, keys and emails
// and compare stats as deltas. Where order matters they wait a few ms between
// writes so timestamps differ.
//

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPostgresStore } from "@/adapters/data/postgres";
import type { Db } from "@/adapters/data/postgres/db";
import { DataError, DEFAULT_LIMIT, MAX_LIMIT, type DataStore } from "@/core/data";
import { PAST_DUE_GRACE_DAYS, type Identity, type PlanInput, type PostInput, type SubscriptionUpsert, type User } from "@/core/types";

/** Wait a few ms so the next write gets a later timestamp. */
export const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

let seq = 0;
/** A token unique to this run, for filters that must not see other rows. */
export const uniq = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A Better Auth identity with a unique id and email. */
export function identity(overrides: Partial<Identity> = {}): Identity {
  const id = uniq("u");
  return {
    provider: "better-auth",
    providerUserId: id,
    email: `${id}@example.com`,
    name: `Name ${id}`,
    image: null,
    emailVerified: true,
    ...overrides,
  };
}

/** A plan input with sensible defaults. */
export function plan(key: string, overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    key,
    name: `Plan ${key}`,
    description: "A plan",
    features: ["One", "Two"],
    prices: [{ interval: "month", amountCents: 1200, currency: "usd", polarProductId: "prod_test" }],
    highlighted: false,
    contactSales: false,
    ctaLabel: "Buy",
    trialDays: null,
    active: true,
    sortOrder: 0,
    ...overrides,
  };
}

/** A Polar subscription for `userId` with a unique provider id. */
export function subscription(userId: string, overrides: Partial<SubscriptionUpsert> = {}): SubscriptionUpsert {
  return {
    userId,
    provider: "polar",
    providerSubscriptionId: uniq("sub_"),
    providerCustomerId: "cus_1",
    planKey: "pro",
    interval: "month",
    status: "active",
    currentPeriodEnd: "2030-01-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

/** Assert that `promise` rejects with DataError(code). */
export async function expectDataError(promise: Promise<unknown>, code: DataError["code"]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected DataError("${code}")`).toBeInstanceOf(DataError);
  expect((error as DataError).code).toBe(code);
}

/** Follow nextCursor to the end; fails if a page repeats a row. */
export async function collect<T extends { id: string }>(fetch: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const pages: T[][] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page: { items: T[]; nextCursor: string | null } = await fetch(cursor);
    pages.push(page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const all = pages.flat();
  expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
  return { pages, all };
}

/** Suite-level setup/teardown (connect, migrate, close). */
export interface ContractHooks {
  /** Before the suite (connect, migrate). */
  setup?: () => Promise<void>;
  /** After the suite (close). */
  teardown?: () => Promise<void>;
}

/**
 * Run the whole DataStore contract against stores made by `makeStore`
 * (called before each test). `name` labels the suite; the store's own `id`
 * must be one of the DataProviderIds.
 */
export function describeDataContract(name: string, makeStore: () => Promise<DataStore> | DataStore, hooks: ContractHooks = {}) {
  describe(`DataStore contract: ${name}`, () => {
    let store: DataStore;
    if (hooks.setup) beforeAll(hooks.setup, 60_000);
    if (hooks.teardown) afterAll(hooks.teardown);
    beforeEach(async () => {
      store = await makeStore();
    });

    const newUser = async (overrides: Partial<Identity> = {}, makeAdmin = false): Promise<User> =>
      store.users.upsertFromIdentity(identity(overrides), { makeAdmin });

    it("reports health", async () => {
      const h = await store.health();
      expect(h.ok).toBe(true);
      expect(["postgres", "memory"]).toContain(store.id);
    });

    // ------------------------------------------------------------ users
    describe("users", () => {
      it("creates on first sign-in and refreshes on later ones", async () => {
        const who = identity({ email: "Mixed.Case@Example.COM" });
        const first = await store.users.upsertFromIdentity(who, { makeAdmin: false });
        expect(first).toMatchObject({ email: "mixed.case@example.com", role: "user", banned: false, authProvider: "better-auth", authProviderUserId: who.providerUserId });
        expect(typeof first.id).toBe("string");
        expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
        expect(first.lastSeenAt).not.toBeNull();

        await tick();
        const again = await store.users.upsertFromIdentity({ ...who, name: "New Name", image: "https://img.test/a.png" }, { makeAdmin: false });
        expect(again.id).toBe(first.id);
        // The stored name wins (it may have been edited in settings); the image refreshes.
        expect(again.name).toBe(first.name);
        expect(again.image).toBe("https://img.test/a.png");
        expect(again.createdAt).toBe(first.createdAt);
        expect(Date.parse(again.lastSeenAt!)).toBeGreaterThan(Date.parse(first.lastSeenAt!));

        // A null name or image from the identity keeps the one we have.
        const third = await store.users.upsertFromIdentity({ ...who, name: null, image: null }, { makeAdmin: false });
        expect(third.name).toBe(first.name);
        expect(third.image).toBe("https://img.test/a.png");

        // An empty stored name is filled from the identity.
        await store.users.update(first.id, { name: null });
        const fourth = await store.users.upsertFromIdentity({ ...who, name: "Filled" }, { makeAdmin: false });
        expect(fourth.name).toBe("Filled");
      });

      it("makeAdmin promotes and never demotes", async () => {
        const who = identity();
        expect((await store.users.upsertFromIdentity(who, { makeAdmin: true })).role).toBe("admin");
        expect((await store.users.upsertFromIdentity(who, { makeAdmin: false })).role).toBe("admin");
      });

      it("links a new auth identity to the existing row with the same email", async () => {
        const email = `${uniq("same")}@person.test`;
        const first = await newUser({ email });
        const newId = uniq("ba_");
        const other = await store.users.upsertFromIdentity(identity({ providerUserId: newId, email: email.toUpperCase() }), { makeAdmin: false });
        expect(other.id).toBe(first.id);
        expect(other.authProvider).toBe("better-auth");
        expect(other.authProviderUserId).toBe(newId);
        expect((await store.users.list({ search: email })).items).toHaveLength(1);
      });

      it("returns null for missing users", async () => {
        expect(await store.users.getById("00000000-0000-4000-8000-000000000000")).toBeNull();
        expect(await store.users.getById("not-an-id")).toBeNull();
        expect(await store.users.getByEmail("nobody@nowhere.test")).toBeNull();
      });

      it("finds by id and by email, case-insensitively", async () => {
        const u = await newUser();
        expect((await store.users.getById(u.id))?.email).toBe(u.email);
        expect((await store.users.getByEmail(u.email.toUpperCase()))?.id).toBe(u.id);
      });

      it("reads many by id at once, skipping unknown ids and duplicates", async () => {
        const a = await newUser();
        const b = await newUser();
        const found = await store.users.getManyByIds([b.id, "00000000-0000-4000-8000-000000000000", a.id, "not-an-id", b.id]);
        expect(found.map((u) => u.id).sort()).toEqual([a.id, b.id].sort());
        expect(found.find((u) => u.id === a.id)).toEqual(await store.users.getById(a.id));
        expect(await store.users.getManyByIds([])).toEqual([]);
      });

      it("lists newest first, filters by role and search, and paginates", async () => {
        const tag = uniq("srch");
        const made: User[] = [];
        for (let i = 0; i < 5; i++) {
          made.push(await newUser({ email: `${tag}-${i}@example.com`, name: i === 2 ? `Ada ${tag.toUpperCase()}` : `User ${i}` }, i === 4));
          await tick();
        }
        const { pages, all } = await collect((cursor) => store.users.list({ search: tag, limit: 2, cursor }));
        expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
        expect(all.map((u) => u.id)).toEqual(made.map((u) => u.id).reverse());

        const byName = await store.users.list({ search: `ada ${tag}` });
        expect(byName.items.map((u) => u.id)).toEqual([made[2].id]);

        const admins = await store.users.list({ search: tag, role: "admin" });
        expect(admins.items.map((u) => u.id)).toEqual([made[4].id]);

        // LIKE wildcards in the search are literal characters.
        expect((await store.users.list({ search: `${tag}%` })).items).toHaveLength(0);
        expect((await store.users.list({ search: "_" })).items.every((u) => u.email.includes("_") || (u.name ?? "").includes("_"))).toBe(true);
      });

      it("updates role, ban and name; missing → not_found", async () => {
        const u = await newUser();
        const updated = await store.users.update(u.id, { role: "admin", banned: true, name: "Renamed" });
        expect(updated).toMatchObject({ id: u.id, role: "admin", banned: true, name: "Renamed", email: u.email });
        expect((await store.users.getById(u.id))?.banned).toBe(true);
        await expectDataError(store.users.update("00000000-0000-4000-8000-000000000000", { banned: true }), "not_found");
        await expectDataError(store.users.update("not-an-id", { banned: true }), "not_found");
      });

      it("deletes, keeping their feedback anonymised", async () => {
        const u = await newUser();
        const f = await store.feedback.create({ userId: u.id, kind: "bug", message: "It broke" });
        await store.users.delete(u.id);
        expect(await store.users.getById(u.id)).toBeNull();
        expect((await store.feedback.getById(f.id))?.userId).toBeNull();
        await store.users.delete(u.id); // deleting twice is a no-op
      });

      it("cascades a delete to the user's subscriptions, purchases and customer ids", async () => {
        const u = await newUser();
        const keep = await newUser();
        const s = await store.billing.upsertSubscription(subscription(u.id));
        const kept = await store.billing.upsertSubscription(subscription(keep.id));
        await store.billing.recordPurchase({ userId: u.id, provider: "polar", providerOrderId: uniq("ord_"), planKey: null, amountCents: 100, currency: "usd", refunded: false });
        const cus = uniq("cus_");
        await store.billing.setCustomerId(u.id, "polar", cus);
        await store.users.delete(u.id);
        expect(await store.billing.getSubscription("polar", s.providerSubscriptionId)).toBeNull();
        expect((await store.billing.listSubscriptions({ userId: u.id })).items).toEqual([]);
        expect((await store.billing.listPurchases({ userId: u.id })).items).toEqual([]);
        expect(await store.billing.getCustomerId(u.id, "polar")).toBeNull();
        expect(await store.billing.findUserIdByCustomerId("polar", cus)).toBeNull();
        expect((await store.billing.getSubscription("polar", kept.providerSubscriptionId))?.id).toBe(kept.id);
      });
    });

    // ------------------------------------------------------------ content
    describe("content", () => {
      it("gets, sets, overwrites, lists and deletes JSON values", async () => {
        const key = uniq("key_");
        expect(await store.content.get(key)).toBeNull();
        const value = { title: "Hello", items: [1, "two", { three: true }], nested: { empty: null } };
        const set = await store.content.set(key, value);
        expect(set.key).toBe(key);
        expect(set.value).toEqual(value);
        expect(Number.isNaN(Date.parse(set.updatedAt))).toBe(false);
        expect((await store.content.get(key))?.value).toEqual(value);

        await store.content.set(key, { title: "Changed" });
        expect((await store.content.get(key))?.value).toEqual({ title: "Changed" });
        expect((await store.content.all()).filter((c) => c.key === key)).toHaveLength(1);

        await store.content.delete(key);
        expect(await store.content.get(key)).toBeNull();
        await store.content.delete(key);
      });
    });

    // ------------------------------------------------------------ posts
    describe("posts", () => {
      const post = (overrides: Partial<PostInput> = {}): PostInput => ({ kind: "post", slug: uniq("slug-"), title: "A title", ...overrides });

      it("creates with defaults and stamps publishedAt when published", async () => {
        const draft = await store.posts.create(post());
        expect(draft).toMatchObject({ description: "", body: "", coverImage: null, coverAlt: null, tags: [], status: "draft", listed: true, authorName: null, seoTitle: null, seoDescription: null, publishedAt: null });
        expect(draft.createdAt).toBe(draft.updatedAt);

        const live = await store.posts.create(post({ status: "published", tags: ["a", "b"] }));
        expect(live.publishedAt).not.toBeNull();
        expect(live.tags).toEqual(["a", "b"]);

        const dated = await store.posts.create(post({ status: "published", publishedAt: "2024-05-01T10:00:00.000Z" }));
        expect(dated.publishedAt).toBe("2024-05-01T10:00:00.000Z");
      });

      it("keeps an explicit id and timestamps (seed and audit restore); a taken id → conflict", async () => {
        const id = randomUUID();
        const createdAt = "2024-01-02T03:04:05.006Z";
        const updatedAt = "2024-02-03T04:05:06.007Z";
        const restored = await store.posts.create(post({ id, createdAt, updatedAt, status: "published", publishedAt: "2024-01-10T00:00:00.000Z" }));
        expect(restored).toMatchObject({ id, createdAt, updatedAt, publishedAt: "2024-01-10T00:00:00.000Z" });
        expect(await store.posts.getById(id)).toMatchObject({ id, createdAt, updatedAt });

        // Only createdAt given (a seeded post): updatedAt is now, not the old date.
        const seeded = await store.posts.create(post({ createdAt }));
        expect(seeded.createdAt).toBe(createdAt);
        expect(Date.parse(seeded.updatedAt)).toBeGreaterThan(Date.now() - 60_000);

        await expectDataError(store.posts.create(post({ id })), "conflict");
      });

      it("enforces unique (kind, slug)", async () => {
        const slug = uniq("dup-");
        await store.posts.create(post({ slug }));
        await expectDataError(store.posts.create(post({ slug })), "conflict");
        const other = await store.posts.create(post({ slug, kind: "changelog" }));
        expect(other.kind).toBe("changelog");
      });

      it("gets by id and slug; missing → null", async () => {
        const p = await store.posts.create(post({ kind: "page" }));
        expect((await store.posts.getById(p.id))?.slug).toBe(p.slug);
        expect((await store.posts.getBySlug("page", p.slug))?.id).toBe(p.id);
        expect(await store.posts.getBySlug("post", p.slug)).toBeNull();
        expect(await store.posts.getById("00000000-0000-4000-8000-000000000000")).toBeNull();
        expect(await store.posts.getById("nope")).toBeNull();
      });

      it("updates fields, clears with null, stamps on publish; missing → not_found; taken slug → conflict", async () => {
        const p = await store.posts.create(post({ coverImage: "/a.png", coverAlt: "A lighthouse at dusk", authorName: "Ann" }));
        expect(p).toMatchObject({ coverImage: "/a.png", coverAlt: "A lighthouse at dusk" });
        expect((await store.posts.getById(p.id))?.coverAlt).toBe("A lighthouse at dusk");
        await tick();
        // A patch without coverAlt keeps it; null clears it.
        const kept = await store.posts.update(p.id, { coverImage: "/b.png" });
        expect(kept).toMatchObject({ coverImage: "/b.png", coverAlt: "A lighthouse at dusk" });
        const u = await store.posts.update(p.id, { title: "New", coverImage: null, coverAlt: null, tags: ["x"] });
        expect(u).toMatchObject({ id: p.id, title: "New", coverImage: null, coverAlt: null, tags: ["x"], authorName: "Ann", slug: p.slug, kind: "post" });
        expect(Date.parse(u.updatedAt)).toBeGreaterThan(Date.parse(p.updatedAt));
        expect(u.createdAt).toBe(p.createdAt);

        const pub = await store.posts.update(p.id, { status: "published" });
        expect(pub.status).toBe("published");
        expect(pub.publishedAt).not.toBeNull();
        const unpub = await store.posts.update(p.id, { status: "draft" });
        expect(unpub.publishedAt).toBe(pub.publishedAt); // unpublishing keeps the original date

        await expectDataError(store.posts.update("00000000-0000-4000-8000-000000000000", { title: "x" }), "not_found");
        const other = await store.posts.create(post());
        await expectDataError(store.posts.update(other.id, { slug: p.slug }), "conflict");
      });

      it("lists published by publishedAt desc, others by updatedAt desc, with filters", async () => {
        const tag = uniq("t");
        const old = await store.posts.create(post({ status: "published", tags: [tag], publishedAt: "2020-01-01T00:00:00.000Z", title: "Old one", body: "needle in here" }));
        const mid = await store.posts.create(post({ status: "published", tags: [tag, "other"], publishedAt: "2022-01-01T00:00:00.000Z" }));
        const recent = await store.posts.create(post({ status: "published", tags: [tag], publishedAt: "2021-01-01T00:00:00.000Z" }));
        const draftA = await store.posts.create(post({ tags: [tag] }));
        await tick();
        const draftB = await store.posts.create(post({ tags: [tag] }));
        const log = await store.posts.create(post({ kind: "changelog", status: "published", tags: [tag] }));

        const published = await store.posts.list({ kind: "post", status: "published", tag });
        expect(published.items.map((p) => p.id)).toEqual([mid.id, recent.id, old.id]);
        expect(published.nextCursor).toBeNull();

        await tick();
        await store.posts.update(draftA.id, { title: "Touched" });
        const drafts = await store.posts.list({ kind: "post", status: "draft", tag });
        expect(drafts.items.map((p) => p.id)).toEqual([draftA.id, draftB.id]);

        expect((await store.posts.list({ tag })).items).toHaveLength(6);
        expect((await store.posts.list({ kind: "changelog", tag })).items.map((p) => p.id)).toEqual([log.id]);
        expect((await store.posts.list({ tag, search: "NEEDLE" })).items.map((p) => p.id)).toEqual([old.id]);
        expect((await store.posts.list({ tag, search: "old ONE" })).items.map((p) => p.id)).toEqual([old.id]);
        expect((await store.posts.list({ tag, search: "100%" })).items).toHaveLength(0);
      });

      it("paginates across pages without gaps or repeats", async () => {
        const tag = uniq("pg");
        const ids: string[] = [];
        for (let i = 0; i < 7; i++) {
          ids.push((await store.posts.create(post({ status: "published", tags: [tag], publishedAt: new Date(Date.UTC(2023, 0, i + 1)).toISOString() }))).id);
        }
        const { pages, all } = await collect((cursor) => store.posts.list({ status: "published", tag, limit: 3, cursor }));
        expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
        expect(all.map((p) => p.id)).toEqual([...ids].reverse());

        const drafts = await collect((cursor) => store.posts.list({ tag, limit: 2, cursor }));
        expect(drafts.all).toHaveLength(7);
      });

      it("counts tags on published posts of a kind", async () => {
        const a = uniq("tagA");
        const b = uniq("tagB");
        await store.posts.create(post({ status: "published", tags: [a, b] }));
        await store.posts.create(post({ status: "published", tags: [b] }));
        await store.posts.create(post({ tags: [a, b] })); // draft: not counted
        await store.posts.create(post({ kind: "changelog", status: "published", tags: [a] })); // other kind
        await store.posts.create(post({ status: "published", listed: false, tags: [a, b] })); // unlisted: on no tag page
        const tags = (await store.posts.tags("post")).filter((t) => t.tag === a || t.tag === b);
        expect(tags).toEqual([
          { tag: b, count: 2 },
          { tag: a, count: 1 },
        ]);
      });

      it("stores listed (default true), patches it alone, and filters lists by it", async () => {
        const tag = uniq("ls");
        const shown = await store.posts.create(post({ status: "published", tags: [tag], publishedAt: "2023-03-01T00:00:00.000Z" }));
        const hidden = await store.posts.create(post({ status: "published", listed: false, tags: [tag], publishedAt: "2023-03-02T00:00:00.000Z" }));
        expect(shown.listed).toBe(true);
        expect(hidden.listed).toBe(false);
        expect((await store.posts.getById(hidden.id))?.listed).toBe(false);

        // listed and status are different questions: unlisting leaves the post published, and the reverse.
        await tick();
        const unlisted = await store.posts.update(shown.id, { listed: false });
        expect(unlisted).toMatchObject({ listed: false, status: "published", publishedAt: shown.publishedAt, title: shown.title });
        const relisted = await store.posts.update(shown.id, { listed: true });
        expect(relisted.listed).toBe(true);
        const unpublished = await store.posts.update(hidden.id, { status: "draft" });
        expect(unpublished.listed).toBe(false);
        // A patch without `listed` keeps it.
        expect((await store.posts.update(hidden.id, { title: "Renamed" })).listed).toBe(false);
        await store.posts.update(hidden.id, { status: "published" });

        const ids = async (listed?: boolean) => (await store.posts.list({ status: "published", tag, ...(listed === undefined ? {} : { listed }) })).items.map((p) => p.id);
        expect(await ids()).toEqual([hidden.id, shown.id]);
        expect(await ids(true)).toEqual([shown.id]);
        expect(await ids(false)).toEqual([hidden.id]);
        // The filter composes with pagination: no listed row is dropped at a page boundary.
        const { all } = await collect((cursor) => store.posts.list({ status: "published", listed: true, tag, limit: 1, cursor }));
        expect(all.map((p) => p.id)).toEqual([shown.id]);
      });

      it("deletes", async () => {
        const p = await store.posts.create(post());
        await store.posts.delete(p.id);
        expect(await store.posts.getById(p.id)).toBeNull();
        await store.posts.delete(p.id);
      });
    });

    // ------------------------------------------------------------ plans
    describe("plans", () => {
      it("upserts by key, keeps the id, lists by sortOrder, filters active, deletes", async () => {
        const k = uniq("plan");
        const first = await store.plans.upsert(plan(`${k}-b`, { sortOrder: 102 }));
        expect(first).toMatchObject(plan(`${k}-b`, { sortOrder: 102 }));
        expect(typeof first.id).toBe("string");
        await store.plans.upsert(plan(`${k}-a`, { sortOrder: 101, active: false }));
        await store.plans.upsert(plan(`${k}-c`, { sortOrder: 100, highlighted: true, trialDays: 7 }));

        await tick();
        const replaced = await store.plans.upsert(plan(`${k}-b`, { sortOrder: 102, name: "Renamed", features: [], prices: [] }));
        expect(replaced.id).toBe(first.id);
        expect(replaced).toMatchObject({ name: "Renamed", features: [], prices: [] });
        expect(Date.parse(replaced.updatedAt)).toBeGreaterThanOrEqual(Date.parse(first.updatedAt));

        const mine = (list: { key: string }[]) => list.map((p) => p.key).filter((key) => key.startsWith(k));
        expect(mine(await store.plans.list())).toEqual([`${k}-c`, `${k}-a`, `${k}-b`]);
        expect(mine(await store.plans.list({ activeOnly: true }))).toEqual([`${k}-c`, `${k}-b`]);
        expect((await store.plans.getByKey(`${k}-c`))?.trialDays).toBe(7);
        expect(await store.plans.getByKey(`${k}-zzz`)).toBeNull();

        await store.plans.delete(`${k}-c`);
        expect(await store.plans.getByKey(`${k}-c`)).toBeNull();
      });
    });

    // ------------------------------------------------------------ billing
    describe("billing", () => {
      it("upserts subscriptions by (provider, providerSubscriptionId)", async () => {
        const u = await newUser();
        const input = subscription(u.id);
        const created = await store.billing.upsertSubscription(input);
        expect(created).toMatchObject(input);
        await tick();
        const updated = await store.billing.upsertSubscription({ ...input, status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: null });
        expect(updated.id).toBe(created.id);
        expect(updated.createdAt).toBe(created.createdAt);
        expect(updated).toMatchObject({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: null });
        expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));

        expect((await store.billing.getSubscription("polar", input.providerSubscriptionId))?.status).toBe("canceled");
        expect(await store.billing.getSubscription("polar", uniq("sub_missing_"))).toBeNull();
      });

      it("lists subscriptions newest-updated first, by user and status, paginated", async () => {
        const u = await newUser();
        const other = await newUser();
        const a = await store.billing.upsertSubscription(subscription(u.id));
        await tick();
        const b = await store.billing.upsertSubscription(subscription(u.id, { status: "past_due" }));
        await tick();
        await store.billing.upsertSubscription(subscription(other.id));
        await tick();
        await store.billing.upsertSubscription({ ...subscription(u.id), providerSubscriptionId: a.providerSubscriptionId, status: "trialing" });

        const mine = await store.billing.listSubscriptions({ userId: u.id });
        expect(mine.items.map((s) => s.id)).toEqual([a.id, b.id]);
        expect((await store.billing.listSubscriptions({ userId: u.id, status: "past_due" })).items.map((s) => s.id)).toEqual([b.id]);
        const paged = await collect((cursor) => store.billing.listSubscriptions({ userId: u.id, limit: 1, cursor }));
        expect(paged.pages.map((p) => p.length)).toEqual([1, 1]);
        expect((await store.billing.listSubscriptions({ userId: "00000000-0000-4000-8000-000000000000" })).items).toEqual([]);
      });

      it("records purchases idempotently and updates the refund flag", async () => {
        const u = await newUser();
        const order = uniq("ord_");
        const p = await store.billing.recordPurchase({ userId: u.id, provider: "polar", providerOrderId: order, planKey: "lifetime", amountCents: 29900, currency: "usd", refunded: false });
        expect(p).toMatchObject({ userId: u.id, provider: "polar", providerOrderId: order, amountCents: 29900, refunded: false });
        const again = await store.billing.recordPurchase({ userId: u.id, provider: "polar", providerOrderId: order, planKey: "lifetime", amountCents: 29900, currency: "usd", refunded: true });
        expect(again.id).toBe(p.id);
        expect(again.createdAt).toBe(p.createdAt);
        expect(again.refunded).toBe(true);

        await tick();
        const second = await store.billing.recordPurchase({ userId: u.id, provider: "polar", providerOrderId: uniq("ord_"), planKey: null, amountCents: 100, currency: "eur", refunded: false });
        const list = await store.billing.listPurchases({ userId: u.id });
        expect(list.items.map((x) => x.id)).toEqual([second.id, p.id]);
        const paged = await collect((cursor) => store.billing.listPurchases({ userId: u.id, limit: 1, cursor }));
        expect(paged.all).toHaveLength(2);
      });

      it("stores one customer id per (user, provider) and finds the user back", async () => {
        const u = await newUser();
        const v = await newUser();
        const cus = uniq("cus_");
        expect(await store.billing.getCustomerId(u.id, "polar")).toBeNull();
        await store.billing.setCustomerId(u.id, "polar", cus);
        expect(await store.billing.getCustomerId(u.id, "polar")).toBe(cus);
        expect(await store.billing.getCustomerId(v.id, "polar")).toBeNull();
        expect(await store.billing.findUserIdByCustomerId("polar", cus)).toBe(u.id);

        await store.billing.setCustomerId(u.id, "polar", `${cus}-2`);
        expect(await store.billing.getCustomerId(u.id, "polar")).toBe(`${cus}-2`);
        expect(await store.billing.findUserIdByCustomerId("polar", `${cus}-2`)).toBe(u.id);

        const vCus = uniq("cus_");
        await store.billing.setCustomerId(v.id, "polar", vCus);
        expect(await store.billing.findUserIdByCustomerId("polar", vCus)).toBe(v.id);
        expect(await store.billing.getCustomerId(u.id, "polar")).toBe(`${cus}-2`);
        expect(await store.billing.findUserIdByCustomerId("polar", "cus_missing")).toBeNull();
      });

      it("claims a webhook event exactly once, even under concurrent deliveries", async () => {
        const evt = uniq("evt_");
        expect(await store.billing.claimWebhookEvent("polar", evt)).toBe(true);
        expect(await store.billing.claimWebhookEvent("polar", evt)).toBe(false);

        const racing = uniq("evt_");
        const results = await Promise.all(Array.from({ length: 8 }, () => store.billing.claimWebhookEvent("polar", racing)));
        expect(results.filter(Boolean)).toHaveLength(1);
      });
    });

    // ------------------------------------------------------------ feedback
    describe("feedback", () => {
      it("creates with defaults, gets, filters, updates; missing → null / not_found", async () => {
        const u = await newUser();
        const a = await store.feedback.create({ userId: u.id, kind: "bug", title: "Broken", message: "The button" });
        expect(a).toMatchObject({ userId: u.id, kind: "bug", title: "Broken", message: "The button", status: "new", adminNote: null, email: null, name: null });
        await tick();
        const b = await store.feedback.create({ kind: "contact", email: "x@y.test", name: "X", message: "Hello" });
        expect(b.userId).toBeNull();

        expect((await store.feedback.getById(a.id))?.message).toBe("The button");
        expect(await store.feedback.getById("00000000-0000-4000-8000-000000000000")).toBeNull();
        expect((await store.feedback.list({ userId: u.id })).items.map((f) => f.id)).toEqual([a.id]);
        const contact = (await store.feedback.list({ kind: "contact" })).items.map((f) => f.id);
        expect(contact).toContain(b.id);
        expect(contact).not.toContain(a.id);

        await tick();
        const updated = await store.feedback.update(a.id, { status: "planned", adminNote: "Next sprint" });
        expect(updated).toMatchObject({ id: a.id, status: "planned", adminNote: "Next sprint", message: "The button" });
        expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(a.updatedAt));
        expect((await store.feedback.update(a.id, { adminNote: null })).adminNote).toBeNull();
        expect((await store.feedback.update(a.id, {})).status).toBe("planned");
        expect((await store.feedback.list({ status: "planned", userId: u.id })).items).toHaveLength(1);
        expect((await store.feedback.list({ status: "new", userId: u.id })).items).toHaveLength(0);

        await expectDataError(store.feedback.update("00000000-0000-4000-8000-000000000000", { status: "done" }), "not_found");
      });

      it("lists newest first across pages", async () => {
        const u = await newUser();
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          ids.push((await store.feedback.create({ userId: u.id, kind: "general", message: `m${i}` })).id);
          await tick();
        }
        const { pages, all } = await collect((cursor) => store.feedback.list({ userId: u.id, limit: 2, cursor }));
        expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
        expect(all.map((f) => f.id)).toEqual(ids.reverse());
      });
    });

    // ------------------------------------------------------------ subscribers
    describe("subscribers", () => {
      it("adds idempotently and unsubscribes; adding again never undoes an unsubscribe", async () => {
        const email = `${uniq("Sub")}@Example.com`;
        const first = await store.subscribers.add(email, "footer");
        expect(first.created).toBe(true);
        expect(first.subscriber).toMatchObject({ email: email.toLowerCase(), source: "footer", status: "subscribed" });

        const again = await store.subscribers.add(email.toLowerCase(), "blog");
        expect(again.created).toBe(false);
        expect(again.subscriber.id).toBe(first.subscriber.id);

        const off = await store.subscribers.unsubscribe(email.toUpperCase());
        expect(off?.status).toBe("unsubscribed");
        expect(off?.id).toBe(first.subscriber.id);

        // add() is reachable from the public newsletter form: anyone can type
        // anyone's address, so it must not flip an opt-out back on.
        const back = await store.subscribers.add(email, "footer");
        expect(back.created).toBe(false);
        expect(back.subscriber).toMatchObject({ id: first.subscriber.id, status: "unsubscribed", source: "footer" });

        expect(await store.subscribers.unsubscribe("nobody@nowhere.test")).toBeNull();
      });

      it("lists newest first, filtered by status and search, paginated", async () => {
        const tag = uniq("list");
        const emails = [0, 1, 2, 3].map((i) => `${tag}-${i}@example.com`);
        for (const e of emails) {
          await store.subscribers.add(e, null);
          await tick();
        }
        await store.subscribers.unsubscribe(emails[1]);
        const { pages, all } = await collect((cursor) => store.subscribers.list({ search: tag, limit: 3, cursor }));
        expect(pages.map((p) => p.length)).toEqual([3, 1]);
        expect(all.map((s) => s.email)).toEqual([...emails].reverse());
        expect((await store.subscribers.list({ search: tag, status: "unsubscribed" })).items.map((s) => s.email)).toEqual([emails[1]]);
        expect((await store.subscribers.list({ search: tag.toUpperCase(), status: "subscribed" })).items).toHaveLength(3);
      });
    });

    // ------------------------------------------------------------ agent keys
    describe("agent keys", () => {
      it("creates without exposing the hash, finds active keys, touches, revokes once", async () => {
        const hash = uniq("hash");
        const key = await store.agentKeys.create({ name: "CI", scope: "write", keyHash: hash, hint: "abc123" });
        expect(key).toMatchObject({ name: "CI", scope: "write", hint: "abc123", lastUsedAt: null, revokedAt: null });
        expect("keyHash" in key).toBe(false);

        const found = await store.agentKeys.findActiveByHash(hash);
        expect(found?.id).toBe(key.id);
        expect(found && "keyHash" in found).toBe(false);
        expect(await store.agentKeys.findActiveByHash("nope")).toBeNull();

        await store.agentKeys.touch(key.id);
        expect((await store.agentKeys.list()).find((k) => k.id === key.id)?.lastUsedAt).not.toBeNull();

        const revoked = await store.agentKeys.revoke(key.id);
        expect(revoked?.revokedAt).not.toBeNull();
        expect(await store.agentKeys.findActiveByHash(hash)).toBeNull();
        await tick();
        expect((await store.agentKeys.revoke(key.id))?.revokedAt).toBe(revoked?.revokedAt);
        expect(await store.agentKeys.revoke("00000000-0000-4000-8000-000000000000")).toBeNull();
      });

      it("lists newest first and never includes hashes", async () => {
        const a = await store.agentKeys.create({ name: "A", scope: "read", keyHash: uniq("h"), hint: "aaaaaa" });
        await tick();
        const b = await store.agentKeys.create({ name: "B", scope: "admin", keyHash: uniq("h"), hint: "bbbbbb" });
        const list = await store.agentKeys.list();
        const ids = list.map((k) => k.id);
        expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
        expect(list.every((k) => !("keyHash" in k))).toBe(true);
      });

      it("rejects a duplicate key hash", async () => {
        const hash = uniq("hash");
        await store.agentKeys.create({ name: "One", scope: "read", keyHash: hash, hint: "111111" });
        await expectDataError(store.agentKeys.create({ name: "Two", scope: "read", keyHash: hash, hint: "222222" }), "conflict");
      });

      it("records who minted a key, and keeps the row with no creator once that user is deleted", async () => {
        const admin = await newUser({}, true);
        const minted = await store.agentKeys.create({ name: "Laptop", scope: "admin", keyHash: uniq("h"), hint: "cccccc", createdBy: admin.id });
        expect(minted.createdBy).toBe(admin.id);
        const cli = await store.agentKeys.create({ name: "CLI", scope: "read", keyHash: uniq("h"), hint: "dddddd" });
        expect(cli.createdBy).toBeNull();
        expect((await store.agentKeys.list()).find((k) => k.id === minted.id)?.createdBy).toBe(admin.id);

        await expectDataError(store.agentKeys.create({ name: "Ghost", scope: "read", keyHash: uniq("h"), hint: "eeeeee", createdBy: "00000000-0000-4000-8000-000000000000" }), "invalid");
        await expectDataError(store.agentKeys.create({ name: "Bad", scope: "read", keyHash: uniq("h"), hint: "ffffff", createdBy: "not-a-uuid" }), "invalid");

        await store.users.delete(admin.id);
        expect((await store.agentKeys.list()).find((k) => k.id === minted.id)).toMatchObject({ id: minted.id, createdBy: null });
      });
    });

    // ------------------------------------------------------------ audit
    describe("audit", () => {
      it("records with before/after, gets by id, filters and paginates", async () => {
        const entity = uniq("ent");
        const actor = { type: "agent" as const, id: "k1", label: "agent:CI" };
        const e1 = await store.audit.record({ actor, action: `${entity}.create`, entity, entityId: "a", before: null, after: { title: "x", list: [1, 2] } });
        expect(e1).toMatchObject({ actor, action: `${entity}.create`, entity, entityId: "a", before: null, after: { title: "x", list: [1, 2] } });
        await tick();
        const e2 = await store.audit.record({ actor: { type: "system", id: null, label: "webhook:polar" }, action: `${entity}.update`, entity, entityId: "a", before: { title: "x" }, after: "plain string" });
        await tick();
        const e3 = await store.audit.record({ actor, action: `${entity}.delete`, entity, entityId: "b", before: 42, after: null });

        expect(await store.audit.getById(e2.id)).toEqual(e2);
        expect(await store.audit.getById("00000000-0000-4000-8000-000000000000")).toBeNull();
        expect((await store.audit.getById(e3.id))?.before).toBe(42);

        expect((await store.audit.list({ entity })).items.map((e) => e.id)).toEqual([e3.id, e2.id, e1.id]);
        expect((await store.audit.list({ entity, entityId: "a" })).items.map((e) => e.id)).toEqual([e2.id, e1.id]);
        const { pages } = await collect((cursor) => store.audit.list({ entity, limit: 2, cursor }));
        expect(pages.map((p) => p.length)).toEqual([2, 1]);
      });

      it("defaults the page size to 50 and caps it at 200", async () => {
        const entity = uniq("bulk");
        for (let i = 0; i < MAX_LIMIT + 5; i++) {
          await store.audit.record({ actor: { type: "system", id: null, label: "test" }, action: "bulk.add", entity, entityId: String(i), before: null, after: i });
        }
        const def = await store.audit.list({ entity });
        expect(def.items).toHaveLength(DEFAULT_LIMIT);
        expect(def.nextCursor).not.toBeNull();
        const big = await store.audit.list({ entity, limit: 10_000 });
        expect(big.items).toHaveLength(MAX_LIMIT);
        const rest = await store.audit.list({ entity, limit: 10_000, cursor: big.nextCursor });
        expect(rest.items).toHaveLength(5);
        expect(rest.nextCursor).toBeNull();
        const silly = await store.audit.list({ entity, limit: 0 });
        expect(silly.items).toHaveLength(DEFAULT_LIMIT);
      }, 60_000);

      it("rejects a malformed cursor instead of restarting from page one", async () => {
        // Restarting silently would make an agent paging through results loop forever.
        await expectDataError(store.audit.list({ cursor: "garbage" }), "invalid");
        await expectDataError(store.users.list({ cursor: "!!" }), "invalid");
      });
    });

    // ------------------------------------------------------------ stats
    it("computes stats", async () => {
      const base = await store.stats();
      const u = await newUser();
      await newUser({}, true);
      await store.subscribers.add(`${uniq("s")}@example.com`, null);
      const gone = `${uniq("s")}@example.com`;
      await store.subscribers.add(gone, null);
      await store.subscribers.unsubscribe(gone);
      await store.billing.upsertSubscription(subscription(u.id, { status: "active" }));
      await store.billing.upsertSubscription(subscription(u.id, { status: "trialing" }));
      await store.billing.upsertSubscription(subscription(u.id, { status: "canceled" }));
      await store.billing.recordPurchase({ userId: u.id, provider: "polar", providerOrderId: uniq("o"), planKey: null, amountCents: 1, currency: "usd", refunded: false });
      await store.billing.recordPurchase({ userId: u.id, provider: "polar", providerOrderId: uniq("o"), planKey: null, amountCents: 1, currency: "usd", refunded: true });
      await store.posts.create({ kind: "post", slug: uniq("s-"), title: "P", status: "published" });
      await store.posts.create({ kind: "changelog", slug: uniq("s-"), title: "D" });
      await store.posts.create({ kind: "page", slug: uniq("s-"), title: "D2" });
      const f = await store.feedback.create({ kind: "bug", message: "a" });
      await store.feedback.create({ kind: "feature", message: "b" });
      const closed = await store.feedback.create({ kind: "general", message: "c" });
      await store.feedback.update(f.id, { status: "in_progress" });
      await store.feedback.update(closed.id, { status: "done" });

      expect(await store.stats()).toEqual({
        users: base.users + 2,
        admins: base.admins + 1,
        subscribers: base.subscribers + 1,
        activeSubscriptions: base.activeSubscriptions + 2,
        purchases: base.purchases + 1,
        publishedPosts: base.publishedPosts + 1,
        draftPosts: base.draftPosts + 2,
        openFeedback: base.openFeedback + 2,
      });
    });

    it("counts new accounts and subscribers per UTC day", async () => {
      const now = new Date();
      const base = await store.growth(30, now);
      expect(base.days).toHaveLength(30);
      expect(base.days[29]).toBe(now.toISOString().slice(0, 10));
      expect([...base.days].sort()).toEqual(base.days);
      expect(base.users).toHaveLength(30);
      expect(base.subscribers).toHaveLength(30);

      await newUser();
      await newUser();
      await store.subscribers.add(`${uniq("g")}@example.com`, null);
      const gone = `${uniq("g")}@example.com`;
      await store.subscribers.add(gone, null);
      await store.subscribers.unsubscribe(gone); // counts only while subscribed

      const after = await store.growth(30, now);
      expect(after.users[29]).toBe(base.users[29] + 2);
      expect(after.subscribers[29]).toBe(base.subscribers[29] + 1);
      expect(after.users.slice(0, 29)).toEqual(base.users.slice(0, 29));
      // The span is clamped to 1–90 days.
      expect((await store.growth(0, now)).days).toHaveLength(1);
      expect((await store.growth(500, now)).days).toHaveLength(90);
    });

    it("counts only subscriptions that still grant access", async () => {
      const base = await store.stats();
      const u = await newUser();
      const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
      const add = (status: "active" | "trialing" | "past_due", currentPeriodEnd: string | null) =>
        store.billing.upsertSubscription(subscription(u.id, { status, currentPeriodEnd }));
      await add("active", null); // counts: no period end
      await add("active", daysAgo(-30)); // counts: period ahead
      await add("active", daysAgo(1)); // lapsed
      await add("trialing", daysAgo(1)); // lapsed
      await add("past_due", daysAgo(PAST_DUE_GRACE_DAYS - 1)); // counts: inside the grace
      await add("past_due", daysAgo(PAST_DUE_GRACE_DAYS + 1)); // beyond the grace
      expect((await store.stats()).activeSubscriptions).toBe(base.activeSubscriptions + 3);
    });
  });
}


// ---------------------------------------------------------------- SQL-only behaviour

/** Every app table (not the auth_* ones), for truncating between tests. */
export const APP_TABLES = ["users", "content", "posts", "plans", "subscriptions", "purchases", "billing_customers", "webhook_events", "feedback", "subscribers", "agent_keys", "audit_log"] as const;

/** Empty every app table. For a throwaway test database only. */
export async function truncateAppTables(db: Db): Promise<void> {
  await db.execute(sql.raw(`truncate table ${APP_TABLES.map((t) => `"${t}"`).join(", ")} cascade`));
}

/**
 * What the Postgres adapter promises beyond the shared contract, because the
 * database enforces it: real dates, foreign keys, and one row per identity
 * when first sign-ins race. Runs on any Drizzle client over the migrated
 * schema (a server or PGlite).
 */
export function describePostgresBehaviour(name: string, getDb: () => Db) {
  describe(`postgres-only behaviour: ${name}`, () => {
    const store = () => createPostgresStore({ db: getDb() });

    it("rejects an invalid date instead of storing garbage", async () => {
      await expectDataError(store().posts.create({ kind: "post", slug: uniq("bad-"), title: "T", publishedAt: "not a date" }), "invalid");
    });

    it("rejects billing rows for a user that doesn't exist", async () => {
      await expectDataError(store().billing.upsertSubscription(subscription("00000000-0000-4000-8000-000000000000")), "invalid");
    });

    it("survives concurrent first sign-ins for one identity", async () => {
      const who = identity();
      const users = await Promise.all(Array.from({ length: 4 }, () => store().users.upsertFromIdentity(who, { makeAdmin: false })));
      expect(new Set(users.map((u) => u.id)).size).toBe(1);
    });

    it("doesn't write on a repeat sign-in until lastSeenAt is stale", async () => {
      const who = identity();
      const first = await store().users.upsertFromIdentity(who, { makeAdmin: false });
      await tick();
      // Nothing new and seen moments ago: the row is returned as is.
      expect(await store().users.upsertFromIdentity(who, { makeAdmin: false })).toEqual(first);
      // An hour later the same sign-in refreshes lastSeenAt.
      await getDb().execute(sql`update users set last_seen_at = now() - interval '1 hour' where id = ${first.id}`);
      const later = await store().users.upsertFromIdentity(who, { makeAdmin: false });
      expect(Date.parse(later.lastSeenAt!)).toBeGreaterThan(Date.now() - 60_000);
      // A role changed elsewhere isn't reverted by a sign-in that read the old row.
      await store().users.update(first.id, { role: "admin" });
      expect((await store().users.upsertFromIdentity(who, { makeAdmin: false })).role).toBe("admin");
    });

  });
}
