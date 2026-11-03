//
// Foundation tests: the default content passes its schemas, and the services
// layer validates, audits and restores — run against a fresh memory store.
//

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_KEYS, CONTENT_KEY_LIST } from "@/core/content";
import { planSchema, postCreateSchema } from "@/core/schemas";
import type { DataStore } from "@/core/data";
import type { Actor, Identity } from "@/core/types";
import type { BillingProvider } from "@/core/billing";
import { BANNED_MESSAGE, isProtectedPath, safeRedirect, signInNotice } from "@/core/auth";
import { htmlLang, openGraphLocale, siteSchema } from "@/core/content";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { SEED } from "@/content/seed";
import { createMemoryStore } from "@/adapters/data/memory";
import { slugify } from "@/shared/slug";
import { PAST_DUE_GRACE_DAYS, grantsAccess } from "@/core/types";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
// The signed-in identity: `identity` is what a (possibly cached) session says,
// `fresh` what the session store says when asked to skip the cache.
const authState = vi.hoisted(() => ({
  identity: null as Identity | null,
  fresh: undefined as Identity | null | undefined,
  revoked: [] as string[],
  profiles: [] as { id: string; name: string | null }[],
}));
vi.mock("@/server/auth", () => ({
  getAuth: async () => ({
    id: "better-auth",
    urls: { signIn: "/sign-in", signUp: "/sign-up", account: "/dashboard/settings" },
    deleteIdentity: undefined,
    getIdentity: async (opts?: { fresh?: boolean }) =>
      opts?.fresh && authState.fresh !== undefined ? authState.fresh : authState.identity,
    revokeSessions: async (id: string) => {
      authState.revoked.push(id);
    },
    // Like Better Auth: the provider's name changes, so the next identity carries it.
    updateProfile: async (id: string, patch: { name: string | null }) => {
      authState.profiles.push({ id, ...patch });
      if (authState.identity?.providerUserId === id) authState.identity = { ...authState.identity, name: patch.name };
    },
  }),
}));
const billingState = vi.hoisted(() => ({ provider: null as BillingProvider | null }));
vi.mock("@/server/billing", () => ({ getBilling: async () => billingState.provider }));
// React's cache() is a request-scoped memo; in tests run the function each time.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const actor: Actor = { type: "user", id: "u1", label: "admin@example.com" };

beforeEach(() => {
  store = createMemoryStore({ fresh: true });
  authState.identity = null;
  authState.fresh = undefined;
  authState.revoked = [];
  authState.profiles = [];
  billingState.provider = null;
  vi.unstubAllEnvs();
});

function identity(id: string, email: string, extra: Partial<Identity> = {}): Identity {
  return { provider: "better-auth", providerUserId: id, email, name: null, image: null, emailVerified: true, ...extra };
}

/** Create an app user directly in the store. */
async function makeUser(id: string, email: string, admin = false) {
  return store.users.upsertFromIdentity(identity(id, email), { makeAdmin: admin });
}

/** A Polar-style subscription row for `userId`. */
async function subscribe(userId: string, planKey: string, extra: { cancelAtPeriodEnd?: boolean } = {}) {
  return store.billing.upsertSubscription({
    userId,
    provider: "polar",
    providerSubscriptionId: `sub_${userId}_${planKey}`,
    providerCustomerId: "cus_1",
    planKey,
    interval: "month",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
    cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? false,
  });
}

describe("default content and seed", () => {
  it.each(CONTENT_KEY_LIST)("default %s passes its schema", (key) => {
    const result = CONTENT_KEYS[key].schema.safeParse(DEFAULT_CONTENT[key]);
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
  });

  it("every seed plan and post is valid input", () => {
    for (const plan of SEED.plans) expect(planSchema.safeParse(plan).success, plan.key).toBe(true);
    for (const post of SEED.posts) expect(postCreateSchema.safeParse(post).success, post.slug).toBe(true);
    const keys = SEED.posts.map((p) => `${p.kind}/${p.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("content service", () => {
  it("falls back to defaults, merges, audits and restores", async () => {
    const { getContent, updateContent } = await import("@/server/services/content");
    const { restoreAuditEntry, listAudit } = await import("@/server/services/audit");

    expect((await getContent("hero")).title).toBe(DEFAULT_CONTENT.hero.title);

    await updateContent("hero", { title: "A new headline" }, actor, "merge");
    const hero = await getContent("hero");
    expect(hero.title).toBe("A new headline");
    expect(hero.subtitle).toBe(DEFAULT_CONTENT.hero.subtitle);

    const audit = await listAudit({ entity: "content" });
    expect(audit.items[0]).toMatchObject({ action: "content.update", entityId: "hero", before: null });

    await restoreAuditEntry(audit.items[0].id, actor);
    expect((await getContent("hero")).title).toBe(DEFAULT_CONTENT.hero.title);
  });

  it("rejects invalid values with readable issues and unknown keys", async () => {
    const { updateContent } = await import("@/server/services/content");
    await expect(updateContent("hero", { title: "" }, actor, "merge")).rejects.toMatchObject({ code: "invalid" });
    await expect(updateContent("nope", {}, actor)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("content outage", () => {
  it("a failed read throws instead of serving the defaults (a renamed site must not show another product)", async () => {
    const { getContent } = await import("@/server/services/content");
    store.content.all = async () => {
      throw new Error("connection refused");
    };
    await expect(getContent("site")).rejects.toThrow("connection refused");
  });
});

describe("posts service", () => {
  it("derives slugs, refuses duplicates, stamps publishedAt and undoes a create", async () => {
    const { createPost, setPostStatus } = await import("@/server/services/posts");
    const { restoreAuditEntry, listAudit } = await import("@/server/services/audit");

    const post = await createPost({ title: "Hello, World! 2026" }, actor);
    expect(post.slug).toBe("hello-world-2026");
    expect(post.status).toBe("draft");
    expect(post.publishedAt).toBeNull();
    await expect(createPost({ title: "Hello world 2026" }, actor)).rejects.toMatchObject({ code: "conflict" });

    const published = await setPostStatus(post.id, "published", actor);
    expect(published.publishedAt).not.toBeNull();

    const created = (await listAudit({ entity: "post", entityId: post.id })).items.find((e) => e.action === "post.create");
    await restoreAuditEntry(created!.id, actor);
    expect(await store.posts.getById(post.id)).toBeNull();
  });
});

describe("post updates are partial", () => {
  it("publishing keeps the body, tags and description (no defaults leak into updates)", async () => {
    const { createPost, setPostStatus, updatePost } = await import("@/server/services/posts");
    const post = await createPost({ title: "Keep me", body: "The body", tags: ["a"], description: "Summary" }, actor);
    const published = await setPostStatus(post.id, "published", actor);
    expect(published).toMatchObject({ body: "The body", tags: ["a"], description: "Summary", status: "published" });
    const retitled = await updatePost(post.id, { title: "New title" }, actor);
    expect(retitled).toMatchObject({ title: "New title", body: "The body", tags: ["a"], description: "Summary" });
  });
});

describe("users service", () => {
  it("never demotes or bans the last admin", async () => {
    const { setUserRole, setUserBanned } = await import("@/server/services/users");
    const admin = await store.users.upsertFromIdentity(
      { provider: "better-auth", providerUserId: "a", email: "Admin@Example.com", name: "A", image: null, emailVerified: true },
      { makeAdmin: true },
    );
    expect(admin.email).toBe("admin@example.com");
    await expect(setUserRole(admin.id, "user", actor)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserBanned(admin.id, true, { type: "agent", id: "k", label: "agent" })).rejects.toMatchObject({ code: "forbidden" });

    const other = await store.users.upsertFromIdentity(
      { provider: "better-auth", providerUserId: "b", email: "b@example.com", name: null, image: null, emailVerified: true },
      { makeAdmin: false },
    );
    await setUserRole(other.id, "admin", actor);
    await expect(setUserRole(admin.id, "user", actor)).resolves.toMatchObject({ role: "user" });
  });
});

describe("agent keys", () => {
  it("mints, authenticates by hash, and stops working when revoked", async () => {
    const { mintAgentKey, authenticateAgentKey, revokeAgentKey, scopeAllows } = await import("@/server/services/agent-keys");
    // Minted as the CLI does: `actor` names no stored user, and a key's creator must exist.
    const { key, agentKey } = await mintAgentKey("Claude Code", "write", { type: "system", id: null, label: "cli" });
    expect(key.startsWith("osk_")).toBe(true);
    expect(agentKey.hint).toBe(key.slice(-6));
    expect((await authenticateAgentKey(key))?.id).toBe(agentKey.id);
    expect(await authenticateAgentKey("osk_wrong")).toBeNull();
    expect(await authenticateAgentKey(undefined)).toBeNull();
    await revokeAgentKey(agentKey.id, actor);
    expect(await authenticateAgentKey(key)).toBeNull();
    expect(scopeAllows("admin", "write")).toBe(true);
    expect(scopeAllows("read", "write")).toBe(false);
  });

  it("ends the keys an admin minted when that admin is demoted, banned or deleted", async () => {
    const { mintAgentKey, authenticateAgentKey, agentActor } = await import("@/server/services/agent-keys");
    const { setUserRole, setUserBanned, deleteUser } = await import("@/server/services/users");
    const person = (id: string) =>
      store.users.upsertFromIdentity(
        { provider: "better-auth", providerUserId: id, email: `${id}@example.com`, name: null, image: null, emailVerified: true },
        { makeAdmin: true },
      );
    const [keeper, demoted, banned, deleted] = await Promise.all(["keeper", "demoted", "banned", "deleted"].map(person));
    const as = (u: { id: string; email: string }): Actor => ({ type: "user", id: u.id, label: u.email });

    const own = await mintAgentKey("Keeper", "admin", as(keeper));
    expect(own.agentKey.createdBy).toBe(keeper.id);
    const cli = await mintAgentKey("CLI", "admin", { type: "system", id: null, label: "cli" });
    expect(cli.agentKey.createdBy).toBeNull();

    const d = await mintAgentKey("D", "admin", as(demoted));
    // A key minted by a key belongs to the same person, so it can't outlive them either.
    const child = await mintAgentKey("Child", "admin", agentActor(d.agentKey));
    expect(child.agentKey.createdBy).toBe(demoted.id);
    await setUserRole(demoted.id, "user", as(keeper));
    expect(await authenticateAgentKey(d.key)).toBeNull();
    expect(await authenticateAgentKey(child.key)).toBeNull();

    const b = await mintAgentKey("B", "write", as(banned));
    await setUserBanned(banned.id, true, as(keeper));
    expect(await authenticateAgentKey(b.key)).toBeNull();

    const x = await mintAgentKey("X", "read", as(deleted));
    await deleteUser(deleted.id, as(keeper));
    expect(await authenticateAgentKey(x.key)).toBeNull();
    expect((await store.agentKeys.list()).find((k) => k.id === x.agentKey.id)).toMatchObject({ createdBy: null });

    // Nobody else's keys are touched, and each revocation is audited.
    expect((await authenticateAgentKey(own.key))?.id).toBe(own.agentKey.id);
    expect((await authenticateAgentKey(cli.key))?.id).toBe(cli.agentKey.id);
    const audit = await store.audit.list({ entity: "agent_key", limit: 50 });
    expect(audit.items.filter((e) => e.action === "agent_key.revoke")).toHaveLength(4);
  });
});

describe("user upsert", () => {
  it("keeps a name edited in settings when the identity signs in again", async () => {
    const who = { provider: "better-auth" as const, providerUserId: "n1", email: "n@example.com", name: "From sign-up", image: null, emailVerified: true };
    const user = await store.users.upsertFromIdentity(who, { makeAdmin: false });
    await store.users.update(user.id, { name: "Edited" });
    expect((await store.users.upsertFromIdentity(who, { makeAdmin: false })).name).toBe("Edited");
  });
});

describe("pure helpers", () => {
  it("safeRedirect only allows same-origin paths", () => {
    expect(safeRedirect("/dashboard/billing")).toBe("/dashboard/billing");
    expect(safeRedirect("/dashboard/billing?tab=plans#top")).toBe("/dashboard/billing?tab=plans#top");
    expect(safeRedirect("https://evil.example")).toBe("/dashboard");
    expect(safeRedirect("//evil.example")).toBe("/dashboard");
    expect(safeRedirect("/\\evil.example")).toBe("/dashboard");
    expect(safeRedirect("\\evil.example")).toBe("/dashboard");
    expect(safeRedirect(null, "/")).toBe("/");
  });

  it.each([
    ["tab", "/\t/evil.example/login"],
    ["newline", "/\n/evil.example"],
    ["carriage return", "/\r/evil.example"],
    ["decoded %09", decodeURIComponent("/%09/evil.example")],
    ["NUL", "/\u0000/evil.example"],
    ["DEL", "/\u007f/evil.example"],
    ["dot-segment to //", "/..//evil.example"],
    ["javascript:", "javascript:alert(1)"],
  ])("safeRedirect refuses a %s bypass", (_name, target) => {
    expect(safeRedirect(target)).toBe("/dashboard");
    // What a browser would do with whatever came back: it must stay on the site.
    expect(new URL(safeRedirect(target), "https://mysite.example").origin).toBe("https://mysite.example");
  });

  it("isProtectedPath matches prefixes exactly", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/admin/users")).toBe(true);
    expect(isProtectedPath("/administrator")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
  });

  it("slugify", () => {
    expect(slugify("  Crème brûlée — the 2nd!  ")).toBe("creme-brulee-the-2nd");
    expect(slugify("---")).toBe("");
  });
});

describe("seed runs once", () => {
  it("adds the starter rows once, keeps deletions across re-runs, and --force adds them back", async () => {
    const { seedDatabase } = await import("@/server/seed");
    // The memory store seeds itself; start from an empty one like a new Postgres.
    for (const plan of await store.plans.list()) await store.plans.delete(plan.key);
    for (const post of (await store.posts.list({ limit: 200 })).items) await store.posts.delete(post.id);

    const first = await seedDatabase(store);
    expect(first).toMatchObject({ plans: SEED.plans.length, posts: SEED.posts.length, alreadySeeded: false });

    const welcome = SEED.posts[0];
    const seeded = await store.posts.getBySlug(welcome.kind, welcome.slug);
    // The content's own date, not the install time.
    expect(seeded?.updatedAt).toBe(welcome.publishedAt);
    await store.posts.delete(seeded!.id);
    await store.plans.delete(SEED.plans[0].key);

    // The next deploy runs the seed again: what the owner deleted stays deleted.
    expect(await seedDatabase(store)).toMatchObject({ plans: 0, posts: 0, alreadySeeded: true });
    expect(await store.posts.getBySlug(welcome.kind, welcome.slug)).toBeNull();
    expect(await store.plans.getByKey(SEED.plans[0].key)).toBeNull();

    expect(await seedDatabase(store, undefined, { force: true })).toMatchObject({ plans: 1, posts: 1, alreadySeeded: false });
    expect(await store.posts.getBySlug(welcome.kind, welcome.slug)).not.toBeNull();
  });

  it("treats a database that already has content as seeded", async () => {
    const { seedDatabase } = await import("@/server/seed");
    expect(await seedDatabase(store)).toMatchObject({ plans: 0, posts: 0, alreadySeeded: true });
    expect((await store.audit.list({ entity: "seed" })).items).toHaveLength(1);
  });
});

describe("last usable admin", () => {
  it("banned admins don't count: ban the other admin, then demoting, banning or deleting yourself is refused", async () => {
    const { setUserBanned, setUserRole, deleteUser } = await import("@/server/services/users");
    const a = await makeUser("a", "a@example.com", true);
    const b = await makeUser("b", "b@example.com", true);
    const asA: Actor = { type: "user", id: a.id, label: a.email };
    await setUserBanned(b.id, true, asA);
    expect(authState.revoked).toEqual(["b"]); // the ban ended b's sessions
    await expect(setUserRole(a.id, "user", asA)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserBanned(a.id, true, { type: "agent", id: "k", label: "agent" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteUser(a.id, asA)).rejects.toMatchObject({ code: "forbidden" });
    // A banned admin can be removed: it was never usable.
    await expect(deleteUser(b.id, asA)).resolves.toBeUndefined();
    expect((await store.users.getById(a.id))?.role).toBe("admin");
  });

  it("refuses to demote an ADMIN_EMAILS address, which would be promoted again on the next request", async () => {
    vi.stubEnv("ADMIN_EMAILS", "a@example.com");
    const { setUserRole } = await import("@/server/services/users");
    const a = await makeUser("a", "a@example.com", true);
    await makeUser("b", "b@example.com", true);
    await expect(setUserRole(a.id, "user", actor)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("ADMIN_EMAILS") });
  });
});

describe("deleting an account with a paid plan", () => {
  it("is refused while a subscription would keep renewing, and allowed once it is set to cancel", async () => {
    const { deleteUser, deleteOwnAccount } = await import("@/server/services/users");
    const u = await makeUser("p", "p@example.com");
    await subscribe(u.id, "pro");
    await expect(deleteOwnAccount(u)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("Billing") });
    await expect(deleteUser(u.id, actor)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("Polar") });
    await subscribe(u.id, "pro", { cancelAtPeriodEnd: true });
    await expect(deleteOwnAccount(u)).resolves.toBeUndefined();
    expect(await store.users.getById(u.id)).toBeNull();
  });
});

describe("plans that customers pay for", () => {
  it("can't be deleted or lose a Polar product id, but can be set inactive", async () => {
    const { deletePlan, patchPlan } = await import("@/server/services/plans");
    const { restoreAuditEntry, listAudit } = await import("@/server/services/audit");
    const plan = (await store.plans.list()).find((p) => p.prices.length > 0)!;
    const priced = plan.prices.map((p, i) => ({ ...p, polarProductId: `prod_${i}` }));
    await patchPlan(plan.key, { prices: priced }, actor); // filling in ids is always allowed
    const u = await makeUser("p", "p@example.com");
    await subscribe(u.id, plan.key);

    await expect(deletePlan(plan.key, actor)).rejects.toMatchObject({ code: "conflict" });
    await expect(patchPlan(plan.key, { prices: priced.map((p) => ({ ...p, polarProductId: "prod_other" })) }, actor)).rejects.toMatchObject({
      code: "conflict",
    });
    // Undoing the edit that set the ids would drop them too.
    const setIds = (await listAudit({ entity: "plan", entityId: plan.key })).items.find((e) => e.action === "plan.update")!;
    await expect(restoreAuditEntry(setIds.id, actor)).rejects.toMatchObject({ code: "conflict" });
    await expect(patchPlan(plan.key, { active: false }, actor)).resolves.toMatchObject({ active: false });
  });
});

describe("plan inheritance survives admin edits", () => {
  const plan = (key: string, name: string, features: string[] = []) => ({
    key,
    name,
    description: "",
    features,
    prices: [],
    highlighted: false,
    contactSales: false,
    ctaLabel: "Get started",
    trialDays: null,
    active: true,
    sortOrder: 0,
  });

  it("rewrites “Everything in <Plan>” when that plan is renamed, and on an undo", async () => {
    const { upsertPlan, patchPlan, listPlans } = await import("@/server/services/plans");
    const { restoreAuditEntry, listAudit } = await import("@/server/services/audit");
    const { planCovers, renameInInheritance } = await import("@/core/plans");
    expect(renameInInheritance("everything in gold, plus", "Gold", "Gold Plus")).toBe("everything in Gold Plus, plus");
    expect(renameInInheritance("Everything in Golden", "Gold", "X")).toBe("Everything in Golden");

    await upsertPlan(plan("gold", "Gold"), actor);
    await upsertPlan(plan("forever", "Forever", ["Everything in Gold, plus", "Priority support"]), actor);
    await patchPlan("gold", { name: "Gold Plus" }, actor);
    const forever = (await listPlans()).find((p) => p.key === "forever")!;
    expect(forever.features).toEqual(["Everything in Gold Plus, plus", "Priority support"]);
    expect(planCovers("forever", "gold", await listPlans())).toBe(true);
    const rewrite = (await listAudit({ entity: "plan", entityId: "forever" })).items.find((e) => e.action === "plan.update");
    expect(rewrite).toBeDefined();

    // Undoing the rename puts the old name back, and the line follows it.
    const rename = (await listAudit({ entity: "plan", entityId: "gold" })).items.find((e) => e.action === "plan.update")!;
    await restoreAuditEntry(rename.id, actor);
    expect(planCovers("forever", "gold", await listPlans())).toBe(true);
    expect((await listPlans()).find((p) => p.key === "forever")!.features[0]).toBe("Everything in Gold, plus");
  });

  it("refuses a second plan with the same name, and deleting a plan another includes", async () => {
    const { upsertPlan, deletePlan, patchPlan } = await import("@/server/services/plans");
    await upsertPlan(plan("gold", "Gold"), actor);
    await expect(upsertPlan(plan("gold2", "gold"), actor)).rejects.toMatchObject({ code: "conflict", details: [{ path: "name" }] });
    await upsertPlan(plan("forever", "Forever", ["Everything in Gold"]), actor);
    await expect(deletePlan("gold", actor)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("Forever") });
    await patchPlan("forever", { features: [] }, actor);
    await expect(deletePlan("gold", actor)).resolves.toBeUndefined();
  });
});

describe("one-time checkout", () => {
  it("refuses a second purchase of the same plan and a purchase on top of a live subscription", async () => {
    const createCheckout = vi.fn(async () => ({ url: "https://polar.example/checkout" }));
    billingState.provider = { id: "polar", label: "Polar", createCheckout, createPortal: vi.fn(), handleWebhook: vi.fn() };
    const { startCheckout } = await import("@/server/services/billing");
    const { upsertPlan } = await import("@/server/services/plans");
    const lifetime = await upsertPlan(
      {
        key: "forever",
        name: "Forever",
        description: "",
        features: [],
        prices: [{ interval: "one_time", amountCents: 9900, currency: "usd", polarProductId: "prod_forever" }],
        highlighted: false,
        contactSales: false,
        ctaLabel: "Buy",
        trialDays: null,
        active: true,
        sortOrder: 9,
      },
      actor,
    );
    const owner = await makeUser("o", "o@example.com");
    await expect(startCheckout(owner, lifetime.key, "one_time")).resolves.toBe("https://polar.example/checkout");
    await store.billing.recordPurchase({
      userId: owner.id,
      provider: "polar",
      providerOrderId: "ord_1",
      planKey: lifetime.key,
      amountCents: 9900,
      currency: "usd",
      refunded: false,
    });
    await expect(startCheckout(owner, lifetime.key, "one_time")).rejects.toMatchObject({ code: "conflict" });

    const subscriber = await makeUser("s", "s@example.com");
    await subscribe(subscriber.id, "pro");
    await expect(startCheckout(subscriber, lifetime.key, "one_time")).rejects.toMatchObject({ code: "conflict" });
    expect(createCheckout).toHaveBeenCalledTimes(1);
  });
});

describe("audit restore of posts", () => {
  it("re-creates a deleted post with its id, and reports a slug clash as a conflict", async () => {
    const { createPost, deletePost } = await import("@/server/services/posts");
    const { restoreAuditEntry, listAudit } = await import("@/server/services/audit");
    const post = await createPost({ title: "Restore me" }, actor);
    await deletePost(post.id, actor);
    const deleted = (await listAudit({ entity: "post", entityId: post.id })).items.find((e) => e.action === "post.delete")!;
    await expect(restoreAuditEntry(deleted.id, actor)).resolves.toMatchObject({ entityId: post.id });
    expect((await store.posts.getById(post.id))?.createdAt).toBe(post.createdAt);

    await deletePost(post.id, actor);
    await createPost({ title: "Restore me" }, actor); // takes the slug
    const again = (await listAudit({ entity: "post", entityId: post.id })).items.find((e) => e.action === "post.delete")!;
    await expect(restoreAuditEntry(again.id, actor)).rejects.toMatchObject({ name: "ServiceError", code: "conflict" });
  });
});

describe("session", () => {
  it("reads without writing when nothing changed, and refreshes lastSeenAt only when stale", async () => {
    const { getCurrentUser } = await import("@/server/session");
    authState.identity = identity("r", "r@example.com");
    const first = await getCurrentUser();
    expect(first?.email).toBe("r@example.com");
    const upsert = vi.spyOn(store.users, "upsertFromIdentity");
    expect((await getCurrentUser())?.id).toBe(first!.id);
    expect(upsert).not.toHaveBeenCalled();

    vi.useFakeTimers({ now: Date.now() + 6 * 60_000 });
    try {
      await getCurrentUser();
      expect(upsert).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never creates a user from a cached session the session store no longer has", async () => {
    const { getCurrentUser } = await import("@/server/session");
    authState.identity = identity("ghost", "ghost@example.com");
    authState.fresh = null; // deleted on another device a moment ago
    expect(await getCurrentUser()).toBeNull();
    expect(await store.users.getByEmail("ghost@example.com")).toBeNull();
  });

  it("ADMIN_EMAILS promotes only a verified address in production, and audits the promotion", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv("NODE_ENV", "production");
    const { getCurrentUser } = await import("@/server/session");
    authState.identity = identity("owner", "owner@example.com", { emailVerified: false });
    expect((await getCurrentUser())?.role).toBe("user");

    authState.identity = identity("owner", "owner@example.com", { emailVerified: true });
    expect((await getCurrentUser())?.role).toBe("admin");
    const audit = await store.audit.list({ entity: "user" });
    expect(audit.items.map((e) => e.action).sort()).toEqual(["user.create", "user.promote"]);
  });

  it("sends a banned person to sign-in with a reason", async () => {
    const { requireUser } = await import("@/server/session");
    const u = await makeUser("x", "x@example.com");
    await store.users.update(u.id, { banned: true });
    authState.identity = identity("x", "x@example.com");
    await expect(requireUser("/dashboard")).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in?redirect=%2Fdashboard&error=banned") });
    expect(authState.revoked).toEqual(["x"]); // a session the ban didn't end is ended now
    expect(signInNotice("banned")).toBe(BANNED_MESSAGE);
    expect(signInNotice(undefined)).toBeUndefined();
    expect(signInNotice("<script>")).toBeUndefined();
  });

  it("answers the auth adapter's ban check from the app's own table", async () => {
    const { isBanned } = await import("@/server/services/bans");
    const u = await makeUser("y", "y@example.com");
    expect(await isBanned("y@example.com")).toBe(false);
    expect(await isBanned("nobody@example.com")).toBe(false);
    await store.users.update(u.id, { banned: true });
    expect(await isBanned(" Y@Example.com ")).toBe(true);
  });
});

describe("requirePlan", () => {
  it("redirects a free user to pricing and lets a subscriber through", async () => {
    const { requirePlan } = await import("@/server/services/billing");
    const u = await makeUser("f", "f@example.com");
    await expect(requirePlan(u, ["pro"])).rejects.toMatchObject({ digest: expect.stringContaining("/pricing") });
    await subscribe(u.id, "pro");
    await expect(requirePlan(u, ["pro"])).resolves.toBeUndefined();
  });
});

describe("rate-limit keys", () => {
  it("buckets IPv6 by /64 and unwraps IPv4-mapped addresses", async () => {
    const { normalizeIp } = await import("@/server/rate-limit");
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("[2001:db8:1:2::ffff]:443")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:0db8:0001:0002::1%eth0")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
  });

  it("evicts old windows instead of wiping everyone's when full", async () => {
    const { rateLimit } = await import("@/server/rate-limit");
    for (let i = 0; i < 3; i++) rateLimit("victim", 3, 60_000);
    expect(rateLimit("victim", 3, 60_000).ok).toBe(false);
    for (let i = 0; i < 10_000; i++) rateLimit(`flood:${i}`, 3, 60_000);
    // The victim's window is among the oldest, so it may be evicted, but a fresh flood can't reset everyone at once:
    // the newest keys keep their counts.
    for (let i = 0; i < 3; i++) rateLimit("flood:9999", 3, 60_000);
    expect(rateLimit("flood:9999", 3, 60_000).ok).toBe(false);
  });
});

describe("site locale", () => {
  it("accepts BCP 47 tags only and derives og:locale", () => {
    expect(siteSchema.shape.locale.safeParse("en-GB").success).toBe(true);
    expect(siteSchema.shape.locale.safeParse("en_US").success).toBe(false);
    expect(htmlLang("en-gb")).toBe("en-GB");
    expect(htmlLang("en_US")).toBe("en");
    expect(openGraphLocale("en")).toBe("en_US");
    expect(openGraphLocale("pt-BR")).toBe("pt_BR");
    expect(openGraphLocale("de")).toBe("de_DE");
  });
});

describe("own profile", () => {
  it("writes the name to the auth provider too, so a cleared name stays cleared", async () => {
    const { getCurrentUser } = await import("@/server/session");
    const { updateOwnProfile } = await import("@/server/services/users");
    authState.identity = identity("named", "named@example.com", { name: "Ada Lovelace" });
    const user = (await getCurrentUser())!;
    expect(user.name).toBe("Ada Lovelace");

    await updateOwnProfile(user, { name: "   " });
    expect(authState.profiles).toEqual([{ id: "named", name: null }]);
    expect((await store.users.getById(user.id))?.name).toBeNull();
    // Later requests (lastSeenAt stale, so the row is rewritten) don't fill the old name back in.
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000 });
    try {
      expect((await getCurrentUser())?.name).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a cleared or edited name even when the auth provider still reports the sign-up name", async () => {
    const { getCurrentUser } = await import("@/server/session");
    const { updateOwnProfile } = await import("@/server/services/users");
    const signUp = identity("stale", "stale@example.com", { name: "Ada Lovelace" });
    authState.identity = signUp;
    const user = (await getCurrentUser())!;

    await updateOwnProfile(user, { name: "" });
    authState.identity = signUp; // a provider that didn't take the edit
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000 });
    try {
      expect((await getCurrentUser())?.name).toBeNull();
      await updateOwnProfile((await getCurrentUser())!, { name: "Countess" });
      authState.identity = signUp;
      vi.setSystemTime(Date.now() + 6 * 60_000);
      expect((await getCurrentUser())?.name).toBe("Countess");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("contact form", () => {
  it("keeps the email a signed-in visitor typed, and uses the account email only when the field was empty", async () => {
    const { submitFeedback } = await import("@/server/services/community");
    const user = await makeUser("contact", "account@example.com");
    const typed = await submitFeedback({ kind: "contact", message: "Please reply here", email: "reply-here@example.org" }, user);
    expect(typed).toMatchObject({ email: "reply-here@example.org", userId: user.id });
    const empty = await submitFeedback({ kind: "contact", message: "No address typed" }, user);
    expect(empty).toMatchObject({ email: "account@example.com", userId: user.id });
  });
});

describe("newsletter signup", () => {
  it("never re-subscribes an address that unsubscribed", async () => {
    const { subscribe, unsubscribe } = await import("@/server/services/community");
    const first = await subscribe("Reader@Example.com", "footer");
    expect(first).toMatchObject({ created: true, subscriber: { email: "reader@example.com", status: "subscribed" } });
    await unsubscribe("reader@example.com", actor);
    const again = await subscribe("reader@example.com", "footer");
    expect(again).toMatchObject({ created: false, subscriber: { id: first.subscriber.id, status: "unsubscribed" } });
  });
});

describe("emails by user id", () => {
  it("reads many users in one call, leaving out unknown ids", async () => {
    const { emailsByUserId } = await import("@/server/services/users");
    const a = await makeUser("many-a", "a@example.com");
    const b = await makeUser("many-b", "b@example.com");
    const getManyByIds = vi.spyOn(store.users, "getManyByIds");
    expect(await emailsByUserId([a.id, b.id, a.id, "gone", ""])).toEqual({ [a.id]: "a@example.com", [b.id]: "b@example.com" });
    expect(getManyByIds).toHaveBeenCalledTimes(1);
    expect(await emailsByUserId([])).toEqual({});
    expect(getManyByIds).toHaveBeenCalledTimes(1);
  });
});

describe("post cover descriptions", () => {
  it("stores coverAlt, keeps it on a partial update, clears it with null and caps its length", async () => {
    const { createPost, updatePost } = await import("@/server/services/posts");
    const post = await createPost({ title: "Charts", coverImage: "/c.png", coverAlt: "A bar chart of signups by month" }, actor);
    expect(post.coverAlt).toBe("A bar chart of signups by month");
    expect((await createPost({ title: "Plain" }, actor)).coverAlt).toBeNull();
    expect((await updatePost(post.id, { title: "Charts, again" }, actor)).coverAlt).toBe("A bar chart of signups by month");
    expect((await updatePost(post.id, { coverAlt: null }, actor)).coverAlt).toBeNull();
    await expect(updatePost(post.id, { coverAlt: "x".repeat(301) }, actor)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("social profiles in site settings", () => {
  const SAMPLES = [
    "",
    "   ",
    "https://x.com/acme",
    "https://twitter.com/acme/status/1",
    "https://www.youtube.com/@acme",
    "http://github.com/acme",
    "@this_is_far_too_long_for_x",
    "x.com/acme",
    "www.linkedin.com/company/acme",
    "discord.gg/abc123",
    "@acme",
    "acme",
    "acme.dev",
    "@acme.dev",
    "/acme",
    "javascript:alert(1)",
    "https://localhost/acme",
    "two words",
    "ftp://x.com/acme",
    "https://",
  ];

  it("accepts exactly what the footer can link", async () => {
    const { socialHref } = await import("@/components/site/social-links");
    const { isSocialProfile } = await import("@/core/content");
    for (const key of ["x", "github", "linkedin", "youtube", "discord"] as const) {
      for (const value of SAMPLES) {
        const linkable = !value.trim() || socialHref(key, value) !== null;
        expect(isSocialProfile(key, value), `${key}: "${value}"`).toBe(linkable);
        const parsed = siteSchema.shape.social.safeParse({ [key]: value });
        expect(parsed.success, `schema ${key}: "${value}"`).toBe(linkable);
      }
    }
  });

  it("says what to paste instead", () => {
    const linkedin = siteSchema.shape.social.safeParse({ linkedin: "acme" });
    expect(!linkedin.success && linkedin.error.issues[0].message).toMatch(/https:\/\/www\.linkedin\.com\/company\//);
    const github = siteSchema.shape.social.safeParse({ github: "/acme" });
    expect(!github.success && github.error.issues[0].message).toBe("Paste the full https:// profile address, or @handle");
  });

  it("reads a stored value the new rule refuses as that field's default, keeping the rest", async () => {
    const { getContent, getContentState } = await import("@/server/services/content");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await store.content.set("site", { ...DEFAULT_CONTENT.site, name: "Acme", social: { ...DEFAULT_CONTENT.site.social, linkedin: "acme", x: "@acme" } });
      const site = await getContent("site");
      expect(site.name).toBe("Acme");
      expect(site.social).toMatchObject({ linkedin: "", x: "@acme" });
      expect((await getContentState("site")).stored).toBe(true);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe("no scheduled posts", () => {
  it("refuses a published post dated ahead from every path, and leaves drafts and stored dates alone", async () => {
    const { createPost, updatePost } = await import("@/server/services/posts");
    const { restoreAuditEntry, listAudit } = await import("@/server/services/audit");
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString();

    await expect(createPost({ title: "Ahead", status: "published", publishedAt: nextWeek }, actor)).rejects.toMatchObject({
      code: "invalid",
      details: [{ path: "publishedAt" }],
    });
    const draft = await createPost({ title: "Planned", publishedAt: nextWeek }, actor); // a draft may carry any date
    await expect(updatePost(draft.id, { status: "published" }, actor)).rejects.toMatchObject({ code: "invalid" });

    const live = await createPost({ title: "Live", status: "published", publishedAt: lastWeek }, actor);
    await expect(updatePost(live.id, { publishedAt: nextWeek }, actor)).rejects.toMatchObject({ code: "invalid" });
    // A full patch that repeats the stored status and date (the MCP tools send one) is judged on what changes.
    await expect(updatePost(live.id, { title: "Live, renamed", status: "published", publishedAt: live.publishedAt }, actor)).resolves.toMatchObject({
      title: "Live, renamed",
    });

    // A published post dated ahead that predates this rule: a title edit doesn't re-judge its date,
    // but restoring that state from the audit log is refused like any other write.
    await store.posts.update(live.id, { publishedAt: nextWeek });
    await updatePost(live.id, { title: "Live again" }, actor);
    const edit = (await listAudit({ entity: "post", entityId: live.id })).items.find((e) => e.action === "post.update" && (e.after as { title: string }).title === "Live again")!;
    await expect(restoreAuditEntry(edit.id, actor)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("Polar product ids", () => {
  it("are trimmed, and one product can't sell two prices on one plan or across plans", async () => {
    const { patchPlan } = await import("@/server/services/plans");
    const plans = (await store.plans.list()).filter((p) => p.prices.length > 0);
    const [a, b] = plans;
    const ids = (plan: typeof a, ...productIds: string[]) => plan.prices.map((p, i) => ({ ...p, polarProductId: productIds[i] ?? null }));

    expect((await patchPlan(a.key, { prices: ids(a, " prod_a ") }, actor)).prices[0].polarProductId).toBe("prod_a");
    await expect(patchPlan(b.key, { prices: ids(b, "prod_a") }, actor)).rejects.toMatchObject({
      code: "conflict",
      details: [{ path: "prices.0.polarProductId" }],
    });
    if (a.prices.length > 1) {
      await expect(patchPlan(a.key, { prices: ids(a, "prod_a", "prod_a") }, actor)).rejects.toMatchObject({ code: "conflict" });
    }
    // Saving a plan again with its own ids is fine.
    await expect(patchPlan(a.key, { prices: ids(a, "prod_a") }, actor)).resolves.toBeTruthy();
  });
});

describe("memory store matches the Postgres store", () => {
  it("counts only subscriptions that still grant access (the computeEntitlement rule)", async () => {
    const u = await makeUser("subs", "subs@example.com");
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    let n = 0;
    const add = (status: "active" | "trialing" | "past_due", currentPeriodEnd: string | null) =>
      store.billing.upsertSubscription({
        userId: u.id,
        provider: "polar",
        providerSubscriptionId: `sub_${n++}`,
        providerCustomerId: null,
        planKey: "pro",
        interval: "month",
        status,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
      });
    await add("active", null); // counts
    await add("active", daysAgo(-30)); // counts
    await add("active", daysAgo(1)); // lapsed
    await add("trialing", daysAgo(1)); // lapsed
    await add("past_due", daysAgo(PAST_DUE_GRACE_DAYS - 1)); // counts: inside the grace
    await add("past_due", daysAgo(PAST_DUE_GRACE_DAYS + 1)); // beyond the grace
    expect((await store.stats()).activeSubscriptions).toBe(3);
    expect(grantsAccess({ status: "canceled", currentPeriodEnd: null })).toBe(false);
  });

  it("doesn't write on a repeat sign-in until lastSeenAt is stale", async () => {
    const who = identity("seen", "seen@example.com");
    const first = await store.users.upsertFromIdentity(who, { makeAdmin: false });
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.users.upsertFromIdentity(who, { makeAdmin: false })).toEqual(first);
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000 });
    try {
      const later = await store.users.upsertFromIdentity(who, { makeAdmin: false });
      expect(Date.parse(later.lastSeenAt!)).toBeGreaterThan(Date.parse(first.lastSeenAt!));
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------- entitlements and plan inheritance

/** Give every seeded paid price a Polar product id, so checkout can start. */
async function sellSeededPlans() {
  const { patchPlan } = await import("@/server/services/plans");
  for (const plan of (await store.plans.list()).filter((p) => p.prices.length > 0)) {
    await patchPlan(plan.key, { prices: plan.prices.map((p) => ({ ...p, polarProductId: `prod_${plan.key}_${p.interval}` })) }, actor);
  }
}

function fakeCheckout() {
  const createCheckout = vi.fn(async () => ({ url: "https://polar.example/checkout" }));
  billingState.provider = { id: "polar", label: "Polar", createCheckout, createPortal: vi.fn(), handleWebhook: vi.fn() };
  return createCheckout;
}

async function buy(userId: string, planKey: string | null, order = `ord_${userId}_${planKey}`) {
  return store.billing.recordPurchase({ userId, provider: "polar", providerOrderId: order, planKey, amountCents: 29900, currency: "usd", refunded: false });
}

describe("rows with no plan", () => {
  it("grant nothing, and never block a checkout", async () => {
    const { computeEntitlement, hasPlan, startCheckout } = await import("@/server/services/billing");
    const u = await makeUser("np", "np@example.com");
    // A live subscription and a purchase of a Polar product no plan sells (the webhook stores planKey null).
    const sub = await store.billing.upsertSubscription({
      userId: u.id,
      provider: "polar",
      providerSubscriptionId: "sub_other_product",
      providerCustomerId: "cus_np",
      planKey: null,
      interval: "month",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
    });
    const purchase = await buy(u.id, null);
    expect(computeEntitlement([sub], [purchase])).toMatchObject({ source: "free", planKey: null });
    await expect(hasPlan(u.id)).resolves.toBe(false);
    await sellSeededPlans();
    fakeCheckout();
    await expect(startCheckout(u, "pro", "month")).resolves.toBe("https://polar.example/checkout");
    await expect(startCheckout(u, "lifetime", "one_time")).resolves.toBe("https://polar.example/checkout");
  });
});

describe("plan inheritance (Everything in <Plan>)", () => {
  it("lets a Lifetime owner through a Pro gate, and ranks Lifetime above a Pro subscription", async () => {
    const { computeEntitlement, hasPlan, requirePlan } = await import("@/server/services/billing");
    const { planCovers, comparePlanRank } = await import("@/core/plans");
    const plans = await store.plans.list();
    expect(planCovers("lifetime", "pro", plans)).toBe(true);
    expect(planCovers("pro", "lifetime", plans)).toBe(false);
    expect(planCovers("gone", "pro", plans)).toBe(false);
    expect(comparePlanRank("lifetime", "pro", plans)).toBeGreaterThan(0);

    const u = await makeUser("lt", "lt@example.com");
    const lifetime = await buy(u.id, "lifetime");
    await expect(requirePlan(u, ["pro"])).resolves.toBeUndefined();
    await expect(hasPlan(u.id, ["enterprise"])).resolves.toBe(false);
    const pro = await subscribe(u.id, "pro");
    // Without plans: the old order (subscription first). With them: the better plan.
    expect(computeEntitlement([pro], [lifetime])).toMatchObject({ source: "subscription", planKey: "pro" });
    expect(computeEntitlement([pro], [lifetime], new Date(), plans)).toMatchObject({ source: "purchase", planKey: "lifetime" });
  });

  it("refuses to sell a Lifetime owner the Pro they already have", async () => {
    const { startCheckout } = await import("@/server/services/billing");
    await sellSeededPlans();
    const createCheckout = fakeCheckout();
    const u = await makeUser("lo", "lo@example.com");
    await buy(u.id, "lifetime");
    await expect(startCheckout(u, "pro", "month")).rejects.toMatchObject({ code: "conflict", details: { reason: "already_owned" } });
    await expect(startCheckout(u, "pro", "year")).rejects.toMatchObject({ details: { reason: "already_owned" } });
    await expect(startCheckout(u, "lifetime", "one_time")).rejects.toMatchObject({ details: { reason: "already_owned" } });
    expect(createCheckout).not.toHaveBeenCalled();
    // What the pricing and billing pages show instead of those buttons.
    const { getCheckoutGuard } = await import("@/server/services/billing");
    const refuse = await getCheckoutGuard(u.id);
    expect(refuse("pro", "month")).toMatchObject({ reason: "already_owned", label: "Included in your Lifetime plan" });
    expect(refuse("lifetime", "one_time")).toMatchObject({ label: "You own this plan" });
    expect(refuse("enterprise", "month")).toBeNull();
  });
});

describe("one-time purchase for a subscriber", () => {
  it("is refused while the subscription renews, and allowed once it is set to end", async () => {
    const { checkoutRefusal, getCheckoutGuard, startCheckout } = await import("@/server/services/billing");
    await sellSeededPlans();
    fakeCheckout();
    const u = await makeUser("cs", "cs@example.com");
    await subscribe(u.id, "pro");
    await expect(startCheckout(u, "lifetime", "one_time")).rejects.toMatchObject({ details: { reason: "already_subscribed" } });
    expect((await getCheckoutGuard(u.id))("lifetime", "one_time")).toMatchObject({ reason: "already_subscribed" });
    // Cancelled in the portal: still active until the period ends, but no longer renewing.
    await subscribe(u.id, "pro", { cancelAtPeriodEnd: true });
    expect((await getCheckoutGuard(u.id))("lifetime", "one_time")).toBeNull();
    await expect(startCheckout(u, "lifetime", "one_time")).resolves.toBe("https://polar.example/checkout");
    // A second subscription is still refused either way.
    await expect(startCheckout(u, "pro", "year")).rejects.toMatchObject({ details: { reason: "already_subscribed" } });
    expect(checkoutRefusal({ planKey: "pro", interval: "month", subscriptions: [], purchases: [], plans: [] })).toBeNull();
  });
});

describe("audit restore of a plan", () => {
  it("runs the edit checks: a restore can't put one Polar product on two plans", async () => {
    const { patchPlan } = await import("@/server/services/plans");
    const { restoreAuditEntry, listAudit } = await import("@/server/services/audit");
    const [a, b] = (await store.plans.list()).filter((p) => p.prices.length > 0);
    const withId = (plan: typeof a, id: string | null) => plan.prices.map((p, i) => ({ ...p, polarProductId: i === 0 ? id : null }));
    await patchPlan(a.key, { prices: withId(a, "prod_shared") }, actor);
    const gave = (await listAudit({ entity: "plan", entityId: a.key })).items.find((e) => e.action === "plan.update")!;
    await patchPlan(a.key, { description: "moved on" }, actor); // a later edit, so `gave.after` isn't current
    await patchPlan(a.key, { prices: withId(a, null) }, actor); // nobody holds A: the id may move
    await patchPlan(b.key, { prices: withId(b, "prod_shared") }, actor);
    // Restoring the state before a later edit of A would bring prod_shared back onto A.
    const later = (await listAudit({ entity: "plan", entityId: a.key })).items.find((e) => e.action === "plan.update" && e.id !== gave.id && (e.before as { prices: { polarProductId: string | null }[] }).prices[0]?.polarProductId === "prod_shared")!;
    await expect(restoreAuditEntry(later.id, actor)).rejects.toMatchObject({ code: "conflict" });
    expect((await store.plans.getByKey(a.key))!.prices[0].polarProductId).toBeNull();
  });
});

describe("post tags", () => {
  it("are stored as lower-case slugs, without duplicates", () => {
    const parsed = postCreateSchema.parse({ title: "T", tags: ["Getting Started", "getting-started", " Guides ", "Ünïcode Tag", "日本語"] });
    expect(parsed.tags).toEqual(["getting-started", "guides", "ünïcode-tag", "日本語"]);
    expect(postCreateSchema.safeParse({ title: "T", tags: ["!!!"] }).success).toBe(false);
  });

  it("written before normalisation are rewritten once by the seed", async () => {
    const { normalizeStoredTags } = await import("@/server/seed");
    const post = await store.posts.create({ kind: "post", slug: "old-tags", title: "Old", tags: ["Getting Started", "guides", "Guides"] });
    expect(await normalizeStoredTags(store)).toBeGreaterThanOrEqual(1);
    expect((await store.posts.getById(post.id))!.tags).toEqual(["getting-started", "guides"]);
    expect(await normalizeStoredTags(store)).toBe(0);
  });
});

describe("environment rules", () => {
  it("say the same thing the boot check and the server act on", async () => {
    const { resolveDataMode, resolveEmailProvider, weakAuthSecretReason } = await import("@/server/env-rules");
    expect(resolveDataMode({})).toBe("embedded-postgres");
    expect(resolveDataMode({ DATABASE_URL: "postgres://x" })).toBe("postgres");
    expect(resolveDataMode({ DATA_PROVIDER: "memory", DATABASE_URL: "postgres://x" })).toBe("memory");
    expect(resolveEmailProvider({ RESEND_API_KEY: "re_x" })).toBe("resend");
    expect(resolveEmailProvider({ RESEND_API_KEY: "re_x", EMAIL_PROVIDER: "console" })).toBe("console");
    // "smtp" was the example of an unknown provider until ROADMAP 1.5 made it a real one.
    expect(() => resolveEmailProvider({ EMAIL_PROVIDER: "sendgrid" })).toThrow(/EMAIL_PROVIDER/);

    expect(weakAuthSecretReason(undefined)).toMatch(/not set/);
    expect(weakAuthSecretReason("changeme")).toMatch(/placeholder/);
    expect(weakAuthSecretReason("change-me-change-me-change-me-change-me")).toMatch(/placeholder/);
    expect(weakAuthSecretReason("Zx9!kq2")).toMatch(/at least 32/);
    expect(weakAuthSecretReason("a".repeat(40))).toMatch(/random/);
    expect(weakAuthSecretReason("q8Vd0mJ2rX5tL9wB3nH7yK1cF4gP6sZaE0uT2iO8")).toBeNull();
  });
});

describe("Content-Security-Policy", () => {
  it("never lets inline script run without the nonce", async () => {
    const { contentSecurityPolicy, createNonce } = await import("@/core/csp");
    const scriptSrc = (policy: string) => policy.split("; ").find((d) => d.startsWith("script-src "))!;
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(nonce);
    for (const policy of [contentSecurityPolicy({}), contentSecurityPolicy({ nonce }), contentSecurityPolicy({ nonce, dev: true })]) {
      expect(scriptSrc(policy)).not.toContain("'unsafe-inline'");
    }
    expect(scriptSrc(contentSecurityPolicy({ nonce }))).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(scriptSrc(contentSecurityPolicy({}))).toBe("script-src 'self'");
    expect(contentSecurityPolicy({})).not.toContain("unsafe-eval");
  });
});

// ---------------------------------------------------------------- import boundaries (SPEC §2)
// ESLint holds the folder rules (eslint.config.mjs); these need the import graph.

const SRC = join(__dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Runtime imports (type-only ones are erased) of a file, as written. */
function runtimeImports(code: string): string[] {
  const specs: string[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) if (!m[1]) specs.push(m[2]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs;
}

/** A local module's file, or null for a package. */
function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"]) {
    try {
      if (statSync(base + ext).isFile()) return base + ext;
    } catch {
      // try the next extension
    }
  }
  return null;
}

const directive = (code: string, name: string) => new RegExp(`^(?:\\s*//[^\\n]*\\n|\\s*/\\*[\\s\\S]*?\\*/)*\\s*["']${name}["']`).test(code);

describe("import boundaries", () => {
  const files = sourceFiles(SRC);
  const code = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const rel = (f: string) => relative(join(SRC, ".."), f);

  it("client components never reach src/server, src/adapters or a server-only module", () => {
    const serverSide = (f: string) =>
      f.startsWith(join(SRC, "server")) || f.startsWith(join(SRC, "adapters")) || /^\s*import\s+["']server-only["']/m.test(code.get(f) ?? "");
    const problems: string[] = [];
    const clients = files.filter((f) => directive(code.get(f)!, "use client"));
    expect(clients.length).toBeGreaterThan(10); // the directive check itself works
    for (const entry of clients) {
      // Walk what the client bundle would contain. A "use server" module is a boundary: the client gets a reference, not its code.
      const seen = new Set<string>([entry]);
      const queue: string[][] = [[entry]];
      while (queue.length) {
        const chain = queue.shift()!;
        for (const spec of runtimeImports(code.get(chain.at(-1)!) ?? "")) {
          const target = resolveLocal(chain.at(-1)!, spec);
          if (!target || seen.has(target)) continue;
          seen.add(target);
          if (directive(code.get(target) ?? "", "use server")) continue;
          if (serverSide(target)) problems.push([...chain, target].map(rel).join(" → "));
          else queue.push([...chain, target]);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("public pages never reach the auth forms (src/server/auth-ui.ts), not even through import()", () => {
    // The roots every public route renders: the marketing pages, the root layout and the site chrome.
    const marketing = join(SRC, "app", "(marketing)");
    const roots = files.filter(
      (f) =>
        f.startsWith(marketing) ||
        f.startsWith(join(SRC, "components", "site")) ||
        [join(SRC, "app", "layout.tsx"), join(SRC, "app", "not-found.tsx"), join(SRC, "app", "error.tsx")].includes(f),
    );
    expect(roots.length).toBeGreaterThan(5);
    const forbidden = new Set([join(SRC, "server", "auth-ui.ts"), join(SRC, "adapters", "auth", "better-auth", "ui.tsx")]);
    const problems: string[] = [];
    for (const entry of roots) {
      const seen = new Set<string>([entry]);
      const queue: string[][] = [[entry]];
      while (queue.length) {
        const chain = queue.shift()!;
        for (const spec of runtimeImports(code.get(chain.at(-1)!) ?? "")) {
          const target = resolveLocal(chain.at(-1)!, spec);
          if (!target || seen.has(target)) continue;
          seen.add(target);
          if (forbidden.has(target)) problems.push([...chain, target].map(rel).join(" → "));
          // A "use server" module is a boundary: the page gets a reference to its actions, not its imports.
          else if (!directive(code.get(target) ?? "", "use server")) queue.push([...chain, target]);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("imports cn from @/lib/utils, never from the cn package (npm run check:cn)", () => {
    const direct = files.filter((f) => !f.endsWith(join("lib", "utils.ts")) && runtimeImports(code.get(f)!).includes("cn"));
    expect(direct.map(rel)).toEqual([]);
  });
});
