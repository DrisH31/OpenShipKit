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
import { ABANDONED_ERROR, DataError, DEFAULT_LIMIT, MAX_LIMIT, type DataStore } from "@/core/data";
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
      it("keeps an organisation's subscription and its seats apart from personal ones", async () => {
        const buyer = await newUser();
        const org = await store.orgs.create({ name: "Paying", slug: uniq("pay-"), ownerId: buyer.id });
        const personal = await store.billing.upsertSubscription(subscription(buyer.id));
        const forOrg = await store.billing.upsertSubscription({ ...subscription(buyer.id), orgId: org.id, seats: 5 });
        expect(personal).toMatchObject({ orgId: null, seats: null });
        expect(forOrg).toMatchObject({ orgId: org.id, seats: 5 });

        const ids = async (q: { orgId?: string | null }) => (await store.billing.listSubscriptions({ userId: buyer.id, ...q })).items.map((s) => s.id).sort();
        expect(await ids({})).toEqual([personal.id, forOrg.id].sort());
        expect(await ids({ orgId: null })).toEqual([personal.id]);
        expect(await ids({ orgId: org.id })).toEqual([forOrg.id]);
        expect((await store.billing.listSubscriptions({ orgId: "not-an-id" })).items).toEqual([]);

        // Seats change with the subscription; deleting the organisation leaves its subscription bound to it,
        // never turned into the buyer's personal plan.
        expect(await store.billing.upsertSubscription({ ...subscription(buyer.id), providerSubscriptionId: forOrg.providerSubscriptionId, orgId: org.id, seats: 8 })).toMatchObject({ seats: 8 });
        await store.orgs.delete(org.id);
        expect(await ids({ orgId: null })).toEqual([personal.id]);
      });

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
        // requestCancel: a compare-and-set; only one of two at once gets the row.
        const live = await store.billing.upsertSubscription({ ...input, status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: "2099-01-01T00:00:00.000Z" });
        const counts = await store.billing.countRenewingByProvider();
        expect(counts.polar ?? 0).toBeGreaterThanOrEqual(1);
        const [a, b] = await Promise.all([store.billing.requestCancel("polar", input.providerSubscriptionId), store.billing.requestCancel("polar", input.providerSubscriptionId)]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        expect((a ?? b)).toMatchObject({ id: live.id, cancelAtPeriodEnd: false });
        expect((await store.billing.getSubscription("polar", input.providerSubscriptionId))?.cancelAtPeriodEnd).toBe(true);
        expect(await store.billing.requestCancel("polar", "no_such_sub")).toBeNull();
        expect((await store.billing.countRenewingByProvider()).polar ?? 0).toBe((counts.polar ?? 0) - 1);
        const started = await store.billing.upsertSubscription({ ...input, currentPeriodStart: "2026-10-31T00:00:00.000Z" });
        expect(started.currentPeriodStart).toBe("2026-10-31T00:00:00.000Z");
        expect((await store.billing.getSubscription("polar", input.providerSubscriptionId))?.currentPeriodStart).toBe("2026-10-31T00:00:00.000Z");
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
        expect(again.chargedBack).toBe(false);
        const back = await store.billing.recordPurchase({ userId: u.id, provider: "polar", providerOrderId: order, planKey: "lifetime", amountCents: 29900, currency: "usd", refunded: true, chargedBack: true });
        expect(back.chargedBack).toBe(true);

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

    // ------------------------------------------------------------ usage
    describe("usage", () => {
      const at = (iso: string) => new Date(iso).toISOString();
      it("records, sums a metric over [from, to), totals every metric, and keeps subjects apart", async () => {
        const u = await newUser();
        const me = { type: "user" as const, id: u.id };
        const other = { type: "org" as const, id: u.id }; // same id, different subject type
        await store.usage.record({ subject: me, metric: "api_calls", quantity: 3, occurredAt: at("2026-11-01T00:00:00Z") });
        await store.usage.record({ subject: me, metric: "api_calls", quantity: 4, occurredAt: at("2026-11-15T12:00:00Z") });
        await store.usage.record({ subject: me, metric: "api_calls", quantity: 100, occurredAt: at("2026-12-01T00:00:00Z") }); // next period
        await store.usage.record({ subject: me, metric: "emails", quantity: 2, occurredAt: at("2026-11-02T00:00:00Z") });
        await store.usage.record({ subject: other, metric: "api_calls", quantity: 50, occurredAt: at("2026-11-02T00:00:00Z") });
        expect(await store.usage.sum(me, "api_calls", at("2026-11-01T00:00:00Z"), at("2026-12-01T00:00:00Z"))).toBe(7);
        expect(await store.usage.totals(me, at("2026-11-01T00:00:00Z"), at("2026-12-01T00:00:00Z"))).toEqual({ api_calls: 7, emails: 2 });
        expect(await store.usage.sum(other, "api_calls", at("2026-11-01T00:00:00Z"), at("2026-12-01T00:00:00Z"))).toBe(50);
        expect(await store.usage.sum(me, "nothing", at("2026-11-01T00:00:00Z"), at("2026-12-01T00:00:00Z"))).toBe(0);
      });

      it("records once per key per subject, and refuses a negative or fractional quantity", async () => {
        const me = { type: "user" as const, id: (await newUser()).id };
        const first = await store.usage.record({ subject: me, metric: "api_calls", quantity: 1, key: "req_1" });
        const again = await store.usage.record({ subject: me, metric: "api_calls", quantity: 1, key: "req_1" });
        expect(first.created).toBe(true);
        expect(again).toMatchObject({ created: false, event: { id: first.event.id } });
        const now = new Date();
        expect(await store.usage.sum(me, "api_calls", new Date(now.getTime() - 60_000).toISOString(), new Date(now.getTime() + 60_000).toISOString())).toBe(1);
        await expectDataError(store.usage.record({ subject: me, metric: "api_calls", quantity: -1 }), "invalid");
        await expectDataError(store.usage.record({ subject: me, metric: "api_calls", quantity: 1.5 }), "invalid");
      });

      it("a key dedupes per metric: the same key on another metric is another event", async () => {
        const me = { type: "user" as const, id: (await newUser()).id };
        const a = await store.usage.record({ subject: me, metric: "api_calls", quantity: 1, key: "req_9" });
        const b = await store.usage.record({ subject: me, metric: "tokens", quantity: 500, key: "req_9" });
        expect(b.created).toBe(true);
        expect(b.event.id).not.toBe(a.event.id);
        expect(b.event).toMatchObject({ metric: "tokens", quantity: 500 });
      });

      it("consume records only within the limit, atomically under concurrency", async () => {
        const me = { type: "user" as const, id: (await newUser()).id };
        const [from, to] = [at("2026-11-01T00:00:00Z"), at("2026-12-01T00:00:00Z")];
        const occurredAt = at("2026-11-10T00:00:00Z");
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => store.usage.consume({ subject: me, metric: "api_calls", quantity: 1, key: `k${i}`, occurredAt, limit: 5, from, to })),
        );
        expect(results.filter((r) => r.event)).toHaveLength(5);
        expect(results.filter((r) => !r.event).every((r) => r.used === 5)).toBe(true);
        expect(await store.usage.sum(me, "api_calls", from, to)).toBe(5);
        // A key already recorded comes back, over the limit or not.
        const again = await store.usage.consume({ subject: me, metric: "api_calls", quantity: 1, key: "k0", occurredAt, limit: 5, from, to });
        const k0 = results.find((r) => r.event?.key === "k0");
        if (k0?.event) expect(again).toMatchObject({ created: false, event: { id: k0.event.id } });
      });

      it("keeps an outbox of events to report: pending until marked, listed by when they were recorded", async () => {
        const me = { type: "user" as const, id: (await newUser()).id };
        const before = new Date(Date.now() - 1000).toISOString();
        const pending = await store.usage.record({ subject: me, metric: "api_calls", quantity: 2, report: true });
        const plain = await store.usage.record({ subject: me, metric: "api_calls", quantity: 2 });
        expect(pending.event).toMatchObject({ reportPending: true, reportedAt: null });
        expect(plain.event.reportPending).toBe(false);
        const after = new Date(Date.now() + 60_000).toISOString();
        const listed = (await store.usage.listPendingReports(before, after, 500)).map((e) => e.id);
        expect(listed).toContain(pending.event.id);
        expect(listed).not.toContain(plain.event.id);
        expect(await store.usage.listPendingReports(after, new Date(Date.now() + 120_000).toISOString(), 500)).toEqual([]);
        // One already queued is left out: it's on its way.
        const queued = await store.usage.record({ subject: me, metric: "api_calls", quantity: 1, report: true });
        await store.jobs.enqueue({ kind: "usage.report", payload: { eventId: queued.event.id }, sensitive: false, maxAttempts: 3, key: `usage:${queued.event.id}` });
        expect((await store.usage.listPendingReports(before, after, 500)).map((e) => e.id)).not.toContain(queued.event.id);

        await store.usage.settleReport(pending.event.id, { sentAt: new Date().toISOString() });
        expect(await store.usage.get(pending.event.id)).toMatchObject({ reportPending: false, reportedAt: expect.any(String), reportSkipped: null });
        expect((await store.usage.listPendingReports(before, after, 500)).map((e) => e.id)).not.toContain(pending.event.id);
        // Settled with nothing to send: not pending, and never "reported".
        const free = await store.usage.record({ subject: me, metric: "api_calls", quantity: 1, report: true });
        await store.usage.settleReport(free.event.id, { skipped: "no_customer" });
        expect(await store.usage.get(free.event.id)).toMatchObject({ reportPending: false, reportedAt: null, reportSkipped: "no_customer" });

        // An event whose job failed for good is listed again, unless it failed since failedSince.
        const failedOne = await store.usage.record({ subject: me, metric: "api_calls", quantity: 1, report: true });
        const { job } = await store.jobs.enqueue({ kind: "usage.report", payload: { eventId: failedOne.event.id }, sensitive: false, maxAttempts: 1, key: `usage:${failedOne.event.id}` });
        const [claimed] = (await store.jobs.claim({ limit: 50, leaseMs: 60_000 })).filter((j) => j.id === job.id);
        await store.jobs.fail(claimed.id, claimed.attempts, { error: "refused", retryAt: null });
        expect((await store.usage.listPendingReports(before, after, 500)).map((e) => e.id)).toContain(failedOne.event.id);
        expect((await store.usage.listPendingReports(before, after, 500, { failedSince: before })).map((e) => e.id)).not.toContain(failedOne.event.id);

        // Counted while pending; expired when older than the window, and never "reported".
        expect(await store.usage.countPendingReports(after)).toBeGreaterThanOrEqual(1);
        expect(await store.usage.expirePendingReports(after)).toBeGreaterThanOrEqual(1);
        expect(await store.usage.get(failedOne.event.id)).toMatchObject({ reportPending: false, reportedAt: null, reportSkipped: "expired" });
        expect(await store.usage.countPendingReports(after)).toBe(0);
        expect(await store.usage.get("00000000-0000-4000-8000-000000000000")).toBeNull();
      });

      it("stores a plan's limits", async () => {
        const saved = await store.plans.upsert({ ...plan(uniq("lim-")), limits: { api_calls: 1000, seats: 5 } });
        expect(saved.limits).toEqual({ api_calls: 1000, seats: 5 });
        expect((await store.plans.getByKey(saved.key))?.limits).toEqual({ api_calls: 1000, seats: 5 });
        expect((await store.plans.upsert(plan(uniq("nolim-")))).limits).toEqual({});
      });
    });

    // ------------------------------------------------------------ organisations
    describe("organisations", () => {
      const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
      const hash = () => uniq("hash-");

      it("creates an organisation with its creator as owner, and keeps slugs unique", async () => {
        const owner = await newUser();
        const slug = uniq("acme-");
        const org = await store.orgs.create({ name: "Acme", slug, ownerId: owner.id });
        expect(org).toMatchObject({ name: "Acme", slug, createdBy: owner.id });
        expect(await store.orgs.getBySlug(slug)).toEqual(org);
        expect(await store.orgs.get(org.id)).toEqual(org);
        expect(await store.orgs.listForUser(owner.id)).toEqual([{ org, role: "owner" }]);
        expect(await store.orgs.getMember(org.id, owner.id)).toMatchObject({ role: "owner", email: owner.email, name: owner.name });
        await expectDataError(store.orgs.create({ name: "Other", slug, ownerId: owner.id }), "conflict");
        await expectDataError(store.orgs.create({ name: "Ghost", slug: uniq("g-"), ownerId: "00000000-0000-4000-8000-000000000000" }), "invalid");
        // A failed create leaves nothing behind (no organisation without its owner, or the reverse).
        expect(await store.orgs.listForUser(owner.id)).toHaveLength(1);
      });

      it("renames, refuses a taken slug, lists with member counts and search, and treats a bad id as a miss", async () => {
        const owner = await newUser();
        const a = await store.orgs.create({ name: "Alpha", slug: uniq("alpha-"), ownerId: owner.id });
        await tick();
        const b = await store.orgs.create({ name: "Beta Works", slug: uniq("beta-"), ownerId: owner.id });
        expect(await store.orgs.update(a.id, { name: "Alpha Two" })).toMatchObject({ name: "Alpha Two", slug: a.slug });
        await expectDataError(store.orgs.update(a.id, { slug: b.slug }), "conflict");
        await expectDataError(store.orgs.update("00000000-0000-4000-8000-000000000000", { name: "x" }), "not_found");
        const found = await store.orgs.list({ search: "beta works" });
        expect(found.items.map((o) => o.id)).toEqual([b.id]);
        expect(found.items[0].members).toBe(1);
        expect((await store.orgs.list({ limit: 1 })).items[0].id).toBe(b.id); // newest first
        expect(await store.orgs.get("nope")).toBeNull();
      });

      it("adds members, orders them owner > admin > member, changes roles and removes them", async () => {
        const [owner, a, b] = [await newUser(), await newUser(), await newUser()];
        const org = await store.orgs.create({ name: "Team", slug: uniq("team-"), ownerId: owner.id });
        await tick();
        await store.orgs.addMember(org.id, a.id, "member");
        await tick();
        await store.orgs.addMember(org.id, b.id, "admin");
        await expectDataError(store.orgs.addMember(org.id, a.id, "admin"), "conflict");
        expect((await store.orgs.listMembers(org.id)).map((m) => [m.userId, m.role])).toEqual([
          [owner.id, "owner"],
          [b.id, "admin"],
          [a.id, "member"],
        ]);
        expect(await store.orgs.countMembers(org.id)).toBe(3);
        expect(await store.orgs.setMemberRole(org.id, a.id, "admin")).toMatchObject({ role: "admin", email: a.email });
        await expectDataError(store.orgs.setMemberRole(org.id, "00000000-0000-4000-8000-000000000000", "admin"), "not_found");
        expect(await store.orgs.removeMember(org.id, a.id)).toBe(true);
        expect(await store.orgs.removeMember(org.id, a.id)).toBe(false);
        expect(await store.orgs.getMember(org.id, a.id)).toBeNull();
        expect(await store.orgs.listForUser(b.id)).toEqual([{ org, role: "admin" }]);
      });

      it("keeps one open invitation per address, finds it by token hash, lists pending ones, and revokes once", async () => {
        const owner = await newUser();
        const org = await store.orgs.create({ name: "Inv", slug: uniq("inv-"), ownerId: owner.id });
        const tokenHash = hash();
        const inv = await store.orgs.createInvitation({ orgId: org.id, email: "New.Person@Example.com", role: "member", tokenHash, invitedBy: owner.id, expiresAt: days(7) });
        expect(inv).toMatchObject({ orgId: org.id, email: "new.person@example.com", role: "member", invitedBy: owner.id, acceptedAt: null, revokedAt: null });
        expect(inv).not.toHaveProperty("tokenHash");
        await expectDataError(store.orgs.createInvitation({ orgId: org.id, email: "new.person@example.com", role: "admin", tokenHash: hash(), invitedBy: owner.id, expiresAt: days(7) }), "conflict");
        expect(await store.orgs.findInvitationByTokenHash(tokenHash)).toEqual(inv);
        expect(await store.orgs.findInvitationByTokenHash("unknown")).toBeNull();
        expect((await store.orgs.listInvitations(org.id)).map((i) => i.id)).toEqual([inv.id]);

        const revoked = await store.orgs.revokeInvitation(inv.id);
        expect(revoked?.revokedAt).not.toBeNull();
        expect(await store.orgs.revokeInvitation(inv.id)).toBeNull();
        expect(await store.orgs.listInvitations(org.id)).toEqual([]);
        expect((await store.orgs.listInvitations(org.id, { all: true })).map((i) => i.id)).toEqual([inv.id]);
        // Revoking frees the address.
        await store.orgs.createInvitation({ orgId: org.id, email: "new.person@example.com", role: "member", tokenHash: hash(), invitedBy: null, expiresAt: days(7) });
      });

      it("accepts an invitation atomically, once, and never an expired one", async () => {
        const [owner, joiner, already] = [await newUser(), await newUser(), await newUser()];
        const org = await store.orgs.create({ name: "Acc", slug: uniq("acc-"), ownerId: owner.id });
        const inv = await store.orgs.createInvitation({ orgId: org.id, email: joiner.email, role: "admin", tokenHash: hash(), invitedBy: owner.id, expiresAt: days(7) });
        const accepted = await store.orgs.acceptInvitation(inv.id, joiner.id);
        expect(accepted?.member).toMatchObject({ orgId: org.id, userId: joiner.id, role: "admin" });
        expect(accepted?.invitation.acceptedAt).not.toBeNull();
        expect(await store.orgs.acceptInvitation(inv.id, joiner.id)).toBeNull();

        // Accepting for someone who is already a member fails as a whole: the invitation stays open.
        await store.orgs.addMember(org.id, already.id, "member");
        const second = await store.orgs.createInvitation({ orgId: org.id, email: already.email, role: "member", tokenHash: hash(), invitedBy: owner.id, expiresAt: days(7) });
        await expectDataError(store.orgs.acceptInvitation(second.id, already.id), "conflict");
        expect((await store.orgs.getInvitation(second.id))?.acceptedAt).toBeNull();

        const expired = await store.orgs.createInvitation({ orgId: org.id, email: uniq("late") + "@example.com", role: "member", tokenHash: hash(), invitedBy: owner.id, expiresAt: days(-1) });
        expect(await store.orgs.acceptInvitation(expired.id, (await newUser()).id)).toBeNull();
        // Revoking closes an expired one too, which frees its address for a new invitation.
        expect((await store.orgs.revokeInvitation(expired.id))?.revokedAt).not.toBeNull();
        await store.orgs.createInvitation({ orgId: org.id, email: expired.email, role: "member", tokenHash: hash(), invitedBy: owner.id, expiresAt: days(7) });
      });

      it("checks the seat limit in the same step as the write, so concurrent invitations can't overshoot", async () => {
        const owner = await newUser();
        const org = await store.orgs.create({ name: "Seats", slug: uniq("seats-"), ownerId: owner.id });
        const results = await Promise.allSettled(
          [0, 1, 2, 3, 4].map((i) =>
            store.orgs.createInvitation({ orgId: org.id, email: `seat${i}-${uniq("e")}@example.com`, role: "member", tokenHash: hash(), invitedBy: owner.id, expiresAt: days(7), seatLimit: 3 }),
          ),
        );
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2); // owner + 2 open invitations = 3
        for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ name: "DataError", code: "limit" });

        // Joining adds nobody; it's refused only when the team is already over a (reduced) limit.
        const open = await store.orgs.listInvitations(org.id);
        const joiner = await newUser({ email: open[0].email });
        await expectDataError(store.orgs.acceptInvitation(open[0].id, joiner.id, { seatLimit: 2 }), "limit");
        expect((await store.orgs.acceptInvitation(open[0].id, joiner.id, { seatLimit: 3 }))?.member.userId).toBe(joiner.id);
      });

      it("deleting an organisation takes its members and invitations; deleting a user takes their memberships", async () => {
        const [owner, member] = [await newUser(), await newUser()];
        const org = await store.orgs.create({ name: "Del", slug: uniq("del-"), ownerId: owner.id });
        await store.orgs.addMember(org.id, member.id, "member");
        const inv = await store.orgs.createInvitation({ orgId: org.id, email: "x@example.com", role: "member", tokenHash: hash(), invitedBy: owner.id, expiresAt: days(7) });

        await store.users.delete(owner.id);
        expect((await store.orgs.get(org.id))?.createdBy).toBeNull();
        expect((await store.orgs.getInvitation(inv.id))?.invitedBy).toBeNull();
        expect((await store.orgs.listMembers(org.id)).map((m) => m.userId)).toEqual([member.id]);

        expect((await store.orgs.delete(org.id))?.id).toBe(org.id);
        expect(await store.orgs.delete(org.id)).toBeNull();
        expect(await store.orgs.listForUser(member.id)).toEqual([]);
        expect(await store.orgs.getInvitation(inv.id)).toBeNull();
      });
    });

    // ------------------------------------------------------------ jobs
    describe("jobs", () => {
      const soon = (ms: number) => new Date(Date.now() + ms).toISOString();
      const LEASE = 60_000;

      it("enqueues with defaults, claims once, and a second claim finds nothing", async () => {
        const { job, created } = await store.jobs.enqueue({ kind: "test.a", payload: { n: 1 } });
        expect(created).toBe(true);
        expect(job).toMatchObject({ kind: "test.a", payload: { n: 1 }, status: "queued", attempts: 0, maxAttempts: 5, lockedUntil: null, key: null, sensitive: false, finishedAt: null });

        const [claimed, ...rest] = await store.jobs.claim({ limit: 10, leaseMs: LEASE });
        expect(rest).toEqual([]);
        expect(claimed).toMatchObject({ id: job.id, status: "running", attempts: 1 });
        expect(Date.parse(claimed.lockedUntil!)).toBeGreaterThan(Date.now() + LEASE / 2);
        expect(await store.jobs.claim({ limit: 10, leaseMs: LEASE })).toEqual([]);
      });

      it("claims only due jobs, oldest runAt first, up to the limit", async () => {
        const later = await store.jobs.enqueue({ kind: "test.b", payload: null, runAt: soon(60_000) });
        const second = await store.jobs.enqueue({ kind: "test.b", payload: 2, runAt: soon(-1_000) });
        const first = await store.jobs.enqueue({ kind: "test.b", payload: 1, runAt: soon(-5_000) });
        const third = await store.jobs.enqueue({ kind: "test.b", payload: 3 });

        expect((await store.jobs.claim({ limit: 2, leaseMs: LEASE })).map((j) => j.id)).toEqual([first.job.id, second.job.id]);
        expect((await store.jobs.claim({ limit: 5, leaseMs: LEASE })).map((j) => j.id)).toEqual([third.job.id]);
        expect((await store.jobs.get(later.job.id))?.status).toBe("queued");
      });

      it("completes a claim once, deleting a sensitive payload and keeping an ordinary one, and refuses a stale attempt", async () => {
        const { job } = await store.jobs.enqueue({ kind: "test.c", payload: { link: "https://example.com/reset?t=1" }, sensitive: true });
        const plain = await store.jobs.enqueue({ kind: "test.c", payload: { n: 1 } });
        const [claimed, other] = await store.jobs.claim({ limit: 2, leaseMs: LEASE });
        expect(await store.jobs.complete(job.id, claimed.attempts + 1)).toBe(false);
        expect(await store.jobs.complete(job.id, claimed.attempts)).toBe(true);
        expect(await store.jobs.complete(plain.job.id, other.attempts)).toBe(true);
        expect((await store.jobs.get(plain.job.id))?.payload).toEqual({ n: 1 });
        expect(await store.jobs.complete(job.id, claimed.attempts)).toBe(false);
        const done = await store.jobs.get(job.id);
        expect(done).toMatchObject({ status: "succeeded", payload: null, lockedUntil: null });
        expect(done?.finishedAt).not.toBeNull();
      });

      it("retries a failure at retryAt until maxAttempts, then fails it and drops a sensitive payload", async () => {
        const { job } = await store.jobs.enqueue({ kind: "test.d", payload: { secret: 1 }, maxAttempts: 2, sensitive: true });
        let [claimed] = await store.jobs.claim({ limit: 1, leaseMs: LEASE });
        const retryAt = soon(-10);
        const first = await store.jobs.fail(job.id, claimed.attempts, { error: "boom 1", retryAt });
        expect(first).toMatchObject({ status: "queued", attempts: 1, lastError: "boom 1", payload: { secret: 1 }, lockedUntil: null, finishedAt: null });
        expect(first?.runAt).toBe(new Date(retryAt).toISOString());

        [claimed] = await store.jobs.claim({ limit: 1, leaseMs: LEASE });
        expect(claimed.attempts).toBe(2);
        const last = await store.jobs.fail(job.id, claimed.attempts, { error: "boom 2", retryAt: soon(1_000) });
        expect(last).toMatchObject({ status: "failed", attempts: 2, lastError: "boom 2", payload: null });
        expect(last?.finishedAt).not.toBeNull();
        expect(await store.jobs.fail(job.id, claimed.attempts, { error: "again", retryAt: null })).toBeNull();
        // Its payload is gone, so there is nothing to retry.
        expect(await store.jobs.retry(job.id)).toBeNull();
      });

      it("fails at once when there's no retryAt, and retry() requeues a failed job from scratch", async () => {
        const { job } = await store.jobs.enqueue({ kind: "test.e", payload: { keep: true } });
        const [claimed] = await store.jobs.claim({ limit: 1, leaseMs: LEASE });
        expect(await store.jobs.fail(job.id, claimed.attempts, { error: "permanent", retryAt: null })).toMatchObject({ status: "failed", payload: { keep: true } });
        expect(await store.jobs.retry(job.id)).toMatchObject({ status: "queued", attempts: 0, finishedAt: null, lastError: "permanent" });
        expect(await store.jobs.retry(job.id)).toBeNull(); // only a failed job
        expect((await store.jobs.claim({ limit: 1, leaseMs: LEASE }))[0]?.id).toBe(job.id);
      });

      it("takes over a running job whose lease expired, and the first worker's outcome no longer counts", async () => {
        const { job } = await store.jobs.enqueue({ kind: "test.f", payload: null });
        const [first] = await store.jobs.claim({ limit: 1, leaseMs: 1 });
        await tick(30);
        const [second] = await store.jobs.claim({ limit: 1, leaseMs: LEASE });
        expect(second).toMatchObject({ id: job.id, attempts: 2, status: "running" });
        expect(await store.jobs.complete(job.id, first.attempts)).toBe(false);
        expect(await store.jobs.fail(job.id, first.attempts, { error: "late", retryAt: null })).toBeNull();
        expect(await store.jobs.complete(job.id, second.attempts)).toBe(true);
      });

      it("doesn't retake a job whose last attempt's lease ran out: failAbandoned() ends it, payload and all", async () => {
        const { job } = await store.jobs.enqueue({ kind: "test.k", payload: { link: "x" }, maxAttempts: 2, sensitive: true });
        await store.jobs.claim({ limit: 1, leaseMs: 1 });
        await tick(30);
        expect((await store.jobs.claim({ limit: 1, leaseMs: 1 }))[0]?.attempts).toBe(2); // one attempt left: taken over
        await tick(30);
        expect(await store.jobs.claim({ limit: 1, leaseMs: LEASE })).toEqual([]); // none left: not retaken
        const [ended, ...more] = await store.jobs.failAbandoned();
        expect(more).toEqual([]);
        expect(ended).toMatchObject({ id: job.id, status: "failed", attempts: 2, lastError: ABANDONED_ERROR, payload: null, lockedUntil: null });
        expect(await store.jobs.failAbandoned()).toEqual([]);
      });

      it("leaves a running job alone in failAbandoned() while its lease holds or it has attempts left", async () => {
        // Distinct runAts fix the claim order: the last-attempt job gets the long lease, the other the short one.
        await store.jobs.enqueue({ kind: "test.l", payload: null, maxAttempts: 1, runAt: soon(-2_000) });
        await store.jobs.enqueue({ kind: "test.l", payload: null, maxAttempts: 3, runAt: soon(-1_000) });
        expect((await store.jobs.claim({ limit: 1, leaseMs: LEASE }))[0]?.maxAttempts).toBe(1);
        expect((await store.jobs.claim({ limit: 1, leaseMs: 1 }))[0]?.maxAttempts).toBe(3);
        await tick(30);
        expect(await store.jobs.failAbandoned()).toEqual([]);
      });

      it("dedupes by key while a job is unfinished, and frees the key once it finishes", async () => {
        const key = uniq("job-key-");
        const a = await store.jobs.enqueue({ kind: "test.g", payload: 1, key });
        const b = await store.jobs.enqueue({ kind: "test.g", payload: 2, key });
        expect(b).toMatchObject({ created: false, job: { id: a.job.id, payload: 1 } });
        const [claimed] = await store.jobs.claim({ limit: 1, leaseMs: LEASE });
        expect((await store.jobs.enqueue({ kind: "test.g", payload: 3, key })).created).toBe(false); // running still holds it
        await store.jobs.complete(claimed.id, claimed.attempts);
        const c = await store.jobs.enqueue({ kind: "test.g", payload: 4, key });
        expect(c.created).toBe(true);
        expect(c.job.id).not.toBe(a.job.id);
      });

      it("never hands the same job to two concurrent claims", async () => {
        const ids = new Set<string>();
        for (let i = 0; i < 6; i++) ids.add((await store.jobs.enqueue({ kind: "test.h", payload: i })).job.id);
        const batches = await Promise.all([1, 2, 3].map(() => store.jobs.claim({ limit: 3, leaseMs: LEASE })));
        const claimed = batches.flat().map((j) => j.id);
        expect(new Set(claimed).size).toBe(claimed.length);
        expect(claimed.length).toBe(6);
        expect(claimed.every((id) => ids.has(id))).toBe(true);
      });

      it("counts by status with the oldest due job, lists newest first, and prunes finished jobs", async () => {
        const old = await store.jobs.enqueue({ kind: "test.i", payload: null, runAt: soon(-60_000) });
        await tick();
        await store.jobs.enqueue({ kind: "test.i", payload: null, runAt: soon(60_000) });
        await tick();
        const done = await store.jobs.enqueue({ kind: "test.i", payload: null, runAt: soon(-120_000) });
        const [claimed] = await store.jobs.claim({ limit: 1, leaseMs: LEASE });
        expect(claimed.id).toBe(done.job.id);
        await store.jobs.complete(claimed.id, claimed.attempts);

        const counts = await store.jobs.counts();
        expect(counts).toMatchObject({ queued: 2, running: 0, succeeded: 1, failed: 0 });
        expect(counts.oldestDueAt).toBe(old.job.runAt);

        const page = await store.jobs.list({ limit: 2 });
        expect(page.items.map((j) => j.id)[0]).toBe(done.job.id);
        expect(page.nextCursor).not.toBeNull();
        expect((await store.jobs.list({ status: "succeeded" })).items.map((j) => j.id)).toEqual([done.job.id]);

        expect(await store.jobs.prune(soon(-60_000))).toBe(0);
        expect(await store.jobs.prune(soon(1_000))).toBe(1);
        expect(await store.jobs.get(done.job.id)).toBeNull();
        expect((await store.jobs.counts()).queued).toBe(2);
      });

      it("refuses a bad maxAttempts and a bad date, and treats an unknown id as a miss", async () => {
        await expectDataError(store.jobs.enqueue({ kind: "test.j", payload: null, maxAttempts: 0 }), "invalid");
        await expectDataError(store.jobs.enqueue({ kind: "test.j", payload: null, runAt: "not a date" }), "invalid");
        expect(await store.jobs.get("00000000-0000-4000-8000-000000000000")).toBeNull();
        expect(await store.jobs.get("nope")).toBeNull();
        expect(await store.jobs.complete("nope", 1)).toBe(false);
        expect(await store.jobs.retry("nope")).toBeNull();
      });
    });
  });
}


// ---------------------------------------------------------------- SQL-only behaviour

/** Every app table (not the auth_* ones), for truncating between tests. */
export const APP_TABLES = ["users", "content", "posts", "plans", "subscriptions", "purchases", "billing_customers", "webhook_events", "feedback", "subscribers", "agent_keys", "audit_log", "jobs", "org_invitations", "org_members", "orgs", "usage_events"] as const;

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

    it("reports the newest applied migration: the one this code expects, once migrated", async () => {
      const { EXPECTED_MIGRATION, schemaState } = await import("@/server/schema-version");
      const applied = await store().appliedMigration();
      expect(applied).toBe(EXPECTED_MIGRATION);
      expect(schemaState(applied)).toBe("current");
    });

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
