import "server-only";

//
// DATA_PROVIDER=memory — everything in one process's memory, seeded from
// src/content/seed.ts on boot. The reference implementation of the DataStore
// contract and what the unit tests run against. Data is lost on restart and
// each process has its own copy — never use it for real users. (Development
// without DATABASE_URL uses the embedded Postgres instead; see
// src/adapters/data/postgres/db.ts.)
//
// Kept on globalThis so Next's dev-mode module reloading doesn't wipe it.
//

import { randomUUID } from "node:crypto";
import { DataError, clampGrowthDays, clampLimit, type DataStore, type PaidProvider } from "@/core/data";
import type {
  AgentKey,
  AuditEntry,
  ContentEntry,
  Feedback,
  Page,
  Plan,
  Post,
  Purchase,
  Subscriber,
  Subscription,
  User,
} from "@/core/types";
import { grantsAccess, growthDays } from "@/core/types";
import { SEED } from "@/content/seed";

interface Tables {
  users: Map<string, User>;
  content: Map<string, ContentEntry>;
  posts: Map<string, Post>;
  plans: Map<string, Plan>;
  subscriptions: Map<string, Subscription>;
  purchases: Map<string, Purchase>;
  customers: Map<string, string>; // `${provider}:${userId}` → customerId
  webhookEvents: Set<string>;
  feedback: Map<string, Feedback>;
  subscribers: Map<string, Subscriber>;
  agentKeys: Map<string, AgentKey & { keyHash: string }>;
  audit: Map<string, AuditEntry>;
}

const now = () => new Date().toISOString();

/** How stale lastSeenAt may get before a repeat sign-in rewrites it (the Postgres store's LAST_SEEN_RESOLUTION). */
const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;

/** Offset cursors over an already-sorted array. */
function paginate<T>(rows: T[], limit: number | undefined, cursor: string | null | undefined): Page<T> {
  const size = clampLimit(limit);
  if (cursor && !/^\d+$/.test(cursor)) throw new DataError("invalid", "Invalid pagination cursor");
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const items = rows.slice(start, start + size);
  const next = start + size < rows.length ? String(start + size) : null;
  return { items, nextCursor: next };
}

const byDesc = <T>(pick: (t: T) => string | null) => (a: T, b: T) => ((pick(b) ?? "") > (pick(a) ?? "") ? 1 : (pick(b) ?? "") < (pick(a) ?? "") ? -1 : 0);

const clone = <T>(v: T): T => structuredClone(v);

function freshTables(): Tables {
  const t: Tables = {
    users: new Map(),
    content: new Map(),
    posts: new Map(),
    plans: new Map(),
    subscriptions: new Map(),
    purchases: new Map(),
    customers: new Map(),
    webhookEvents: new Set(),
    feedback: new Map(),
    subscribers: new Map(),
    agentKeys: new Map(),
    audit: new Map(),
  };
  const stamp = now();
  for (const p of SEED.plans) {
    const id = randomUUID();
    t.plans.set(p.key, { ...clone(p), id, updatedAt: stamp });
  }
  for (const p of SEED.posts) {
    const id = randomUUID();
    t.posts.set(id, {
      id,
      kind: p.kind,
      slug: p.slug,
      title: p.title,
      description: p.description ?? "",
      body: p.body ?? "",
      coverImage: p.coverImage ?? null,
      coverAlt: p.coverAlt ?? null,
      tags: p.tags ?? [],
      status: p.status ?? "draft",
      listed: p.listed ?? true,
      authorName: p.authorName ?? null,
      seoTitle: p.seoTitle ?? null,
      seoDescription: p.seoDescription ?? null,
      publishedAt: p.publishedAt ?? (p.status === "published" ? stamp : null),
      createdAt: p.publishedAt ?? stamp,
      updatedAt: p.publishedAt ?? stamp,
    });
  }
  return t;
}

/** A store over its own tables. `createMemoryStore()` shares one per process; tests pass `fresh: true`. */
export function createMemoryStore(opts: { fresh?: boolean } = {}): DataStore {
  const g = globalThis as unknown as { __openshipkitMemory?: Tables };
  const t = opts.fresh ? freshTables() : (g.__openshipkitMemory ??= freshTables());

  const findUser = (pred: (u: User) => boolean) => [...t.users.values()].find(pred) ?? null;

  const store: DataStore = {
    id: "memory",
    async health() {
      return { ok: true, detail: "in-memory (demo) — data resets on restart" };
    },

    users: {
      async upsertFromIdentity(identity, { makeAdmin }) {
        const email = identity.email.toLowerCase();
        const existing =
          findUser((u) => u.authProvider === identity.provider && u.authProviderUserId === identity.providerUserId) ??
          findUser((u) => u.email === email);
        const stamp = now();
        if (existing) {
          // Like the Postgres store: no write when the identity brings nothing
          // new and lastSeenAt is fresh (this runs on every signed-in request).
          const changed =
            existing.email !== email ||
            (existing.name === null && identity.name !== null) ||
            (identity.image !== null && identity.image !== existing.image) ||
            existing.authProvider !== identity.provider ||
            existing.authProviderUserId !== identity.providerUserId ||
            (makeAdmin && existing.role !== "admin");
          const fresh = existing.lastSeenAt !== null && Date.now() - Date.parse(existing.lastSeenAt) < LAST_SEEN_RESOLUTION_MS;
          if (!changed && fresh) return clone(existing);
          const next: User = {
            ...existing,
            email,
            name: existing.name ?? identity.name, // a name edited in settings wins over the auth identity
            image: identity.image ?? existing.image,
            authProvider: identity.provider,
            authProviderUserId: identity.providerUserId,
            role: makeAdmin ? "admin" : existing.role,
            lastSeenAt: stamp,
          };
          t.users.set(next.id, next);
          return clone(next);
        }
        const user: User = {
          id: randomUUID(),
          email,
          name: identity.name,
          image: identity.image,
          role: makeAdmin ? "admin" : "user",
          banned: false,
          authProvider: identity.provider,
          authProviderUserId: identity.providerUserId,
          createdAt: stamp,
          lastSeenAt: stamp,
        };
        t.users.set(user.id, user);
        return clone(user);
      },
      async getById(id) {
        const u = t.users.get(id);
        return u ? clone(u) : null;
      },
      async getByEmail(email) {
        const u = findUser((x) => x.email === email.toLowerCase());
        return u ? clone(u) : null;
      },
      async getManyByIds(ids) {
        return [...new Set(ids)].flatMap((id) => {
          const u = t.users.get(id);
          return u ? [clone(u)] : [];
        });
      },
      async list({ search, role, limit, cursor }) {
        const q = search?.toLowerCase();
        const rows = [...t.users.values()]
          .filter((u) => !role || u.role === role)
          .filter((u) => !q || u.email.includes(q) || (u.name ?? "").toLowerCase().includes(q))
          .sort(byDesc((u) => u.createdAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async update(id, patch) {
        const u = t.users.get(id);
        if (!u) throw new DataError("not_found", `No user ${id}`);
        const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const next = { ...u, ...defined };
        t.users.set(id, next);
        return clone(next);
      },
      async delete(id) {
        t.users.delete(id);
        for (const f of t.feedback.values()) if (f.userId === id) f.userId = null;
        for (const [k, s] of t.subscriptions) if (s.userId === id) t.subscriptions.delete(k);
        for (const [k, p] of t.purchases) if (p.userId === id) t.purchases.delete(k);
        for (const k of [...t.customers.keys()]) if (k.endsWith(`:${id}`)) t.customers.delete(k);
        // Like the Postgres foreign key (on delete set null): the key row stays, with no creator.
        for (const k of t.agentKeys.values()) if (k.createdBy === id) k.createdBy = null;
      },
    },

    content: {
      async get(key) {
        const c = t.content.get(key);
        return c ? clone(c) : null;
      },
      async all() {
        return [...t.content.values()].map(clone);
      },
      async set(key, value) {
        const entry: ContentEntry = { key, value: clone(value), updatedAt: now() };
        t.content.set(key, entry);
        return clone(entry);
      },
      async delete(key) {
        t.content.delete(key);
      },
    },

    posts: {
      async list({ kind, status, listed, tag, search, limit, cursor }) {
        const q = search?.toLowerCase();
        const rows = [...t.posts.values()]
          .filter((p) => !kind || p.kind === kind)
          .filter((p) => !status || p.status === status)
          .filter((p) => listed === undefined || p.listed === listed)
          .filter((p) => !tag || p.tags.includes(tag))
          .filter((p) => !q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q))
          .sort(status === "published" ? byDesc((p) => p.publishedAt) : byDesc((p) => p.updatedAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async getById(id) {
        const p = t.posts.get(id);
        return p ? clone(p) : null;
      },
      async getBySlug(kind, slug) {
        const p = [...t.posts.values()].find((x) => x.kind === kind && x.slug === slug);
        return p ? clone(p) : null;
      },
      async create(input) {
        if ([...t.posts.values()].some((p) => p.kind === input.kind && p.slug === input.slug)) {
          throw new DataError("conflict", `A ${input.kind} with slug "${input.slug}" exists`);
        }
        if (input.id && t.posts.has(input.id)) throw new DataError("conflict", `A post with id ${input.id} exists`);
        const stamp = now();
        const status = input.status ?? "draft";
        const post: Post = {
          id: input.id ?? randomUUID(),
          kind: input.kind,
          slug: input.slug,
          title: input.title,
          description: input.description ?? "",
          body: input.body ?? "",
          coverImage: input.coverImage ?? null,
          coverAlt: input.coverAlt ?? null,
          tags: input.tags ?? [],
          status,
          listed: input.listed ?? true,
          authorName: input.authorName ?? null,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
          publishedAt: input.publishedAt ?? (status === "published" ? stamp : null),
          createdAt: input.createdAt ?? stamp,
          updatedAt: input.updatedAt ?? stamp,
        };
        t.posts.set(post.id, post);
        return clone(post);
      },
      async update(id, patch) {
        const p = t.posts.get(id);
        if (!p) throw new DataError("not_found", `No post ${id}`);
        if (patch.slug && patch.slug !== p.slug && [...t.posts.values()].some((x) => x.id !== id && x.kind === p.kind && x.slug === patch.slug)) {
          throw new DataError("conflict", `Slug "${patch.slug}" is taken`);
        }
        const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const next: Post = { ...p, ...defined, updatedAt: now() };
        if (next.status === "published" && !next.publishedAt) next.publishedAt = next.updatedAt;
        t.posts.set(id, next);
        return clone(next);
      },
      async delete(id) {
        t.posts.delete(id);
      },
      async tags(kind) {
        const counts = new Map<string, number>();
        for (const p of t.posts.values()) {
          if (p.kind !== kind || p.status !== "published" || !p.listed) continue;
          for (const tag of p.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
        return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      },
    },

    plans: {
      async list(opts) {
        return [...t.plans.values()]
          .filter((p) => !opts?.activeOnly || p.active)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
          .map(clone);
      },
      async getByKey(key) {
        const p = t.plans.get(key);
        return p ? clone(p) : null;
      },
      async upsert(input) {
        const existing = t.plans.get(input.key);
        const plan: Plan = { ...clone(input), id: existing?.id ?? randomUUID(), updatedAt: now() };
        t.plans.set(plan.key, plan);
        return clone(plan);
      },
      async delete(key) {
        t.plans.delete(key);
      },
    },

    billing: {
      async upsertSubscription(input) {
        const id = `${input.provider}:${input.providerSubscriptionId}`;
        const existing = t.subscriptions.get(id);
        const stamp = now();
        const sub: Subscription = { ...input, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? stamp, updatedAt: stamp };
        t.subscriptions.set(id, sub);
        return clone(sub);
      },
      async getSubscription(provider, providerSubscriptionId) {
        const s = t.subscriptions.get(`${provider}:${providerSubscriptionId}`);
        return s ? clone(s) : null;
      },
      async listSubscriptions({ userId, status, limit, cursor }) {
        const rows = [...t.subscriptions.values()]
          .filter((s) => !userId || s.userId === userId)
          .filter((s) => !status || s.status === status)
          .sort(byDesc((s) => s.updatedAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async recordPurchase(input) {
        const id = `${input.provider}:${input.providerOrderId}`;
        const existing = t.purchases.get(id);
        const purchase: Purchase = { ...input, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now() };
        t.purchases.set(id, purchase);
        return clone(purchase);
      },
      async listPurchases({ userId, limit, cursor }) {
        const rows = [...t.purchases.values()].filter((p) => !userId || p.userId === userId).sort(byDesc((p) => p.createdAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async getCustomerId(userId, provider) {
        return t.customers.get(`${provider}:${userId}`) ?? null;
      },
      async setCustomerId(userId, provider, customerId) {
        t.customers.set(`${provider}:${userId}`, customerId);
      },
      async findUserIdByCustomerId(provider: PaidProvider, customerId) {
        for (const [k, v] of t.customers) if (v === customerId && k.startsWith(`${provider}:`)) return k.slice(provider.length + 1);
        return null;
      },
      async claimWebhookEvent(provider, eventId) {
        const k = `${provider}:${eventId}`;
        if (t.webhookEvents.has(k)) return false;
        t.webhookEvents.add(k);
        return true;
      },
    },

    feedback: {
      async create(input) {
        const stamp = now();
        const f: Feedback = {
          id: randomUUID(),
          userId: input.userId ?? null,
          email: input.email ?? null,
          name: input.name ?? null,
          kind: input.kind,
          title: input.title ?? null,
          message: input.message,
          status: "new",
          adminNote: null,
          createdAt: stamp,
          updatedAt: stamp,
        };
        t.feedback.set(f.id, f);
        return clone(f);
      },
      async getById(id) {
        const f = t.feedback.get(id);
        return f ? clone(f) : null;
      },
      async list({ status, kind, userId, limit, cursor }) {
        const rows = [...t.feedback.values()]
          .filter((f) => !status || f.status === status)
          .filter((f) => !kind || f.kind === kind)
          .filter((f) => !userId || f.userId === userId)
          .sort(byDesc((f) => f.createdAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async update(id, patch) {
        const f = t.feedback.get(id);
        if (!f) throw new DataError("not_found", `No feedback ${id}`);
        const next: Feedback = {
          ...f,
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote } : {}),
          updatedAt: now(),
        };
        t.feedback.set(id, next);
        return clone(next);
      },
    },

    subscribers: {
      async add(email, source) {
        const e = email.toLowerCase();
        const existing = t.subscribers.get(e);
        // Never undo an unsubscribe: an existing row comes back unchanged.
        if (existing) return { subscriber: clone(existing), created: false };
        const s: Subscriber = { id: randomUUID(), email: e, source, status: "subscribed", createdAt: now() };
        t.subscribers.set(e, s);
        return { subscriber: clone(s), created: true };
      },
      async list({ status, search, limit, cursor }) {
        const q = search?.toLowerCase();
        const rows = [...t.subscribers.values()]
          .filter((s) => !status || s.status === status)
          .filter((s) => !q || s.email.includes(q))
          .sort(byDesc((s) => s.createdAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async unsubscribe(email) {
        const s = t.subscribers.get(email.toLowerCase());
        if (!s) return null;
        s.status = "unsubscribed";
        return clone(s);
      },
    },

    agentKeys: {
      async create({ name, scope, keyHash, hint, createdBy = null }) {
        if (createdBy !== null && !t.users.has(createdBy)) throw new DataError("invalid", `No user ${createdBy}`);
        if ([...t.agentKeys.values()].some((k) => k.keyHash === keyHash)) throw new DataError("conflict", "Duplicate agent key");
        const key = { id: randomUUID(), name, scope, hint, keyHash, createdAt: now(), lastUsedAt: null, revokedAt: null, createdBy };
        t.agentKeys.set(key.id, key);
        const { keyHash: _omit, ...pub } = key; // eslint-disable-line @typescript-eslint/no-unused-vars
        return clone(pub);
      },
      async findActiveByHash(keyHash) {
        const k = [...t.agentKeys.values()].find((x) => x.keyHash === keyHash && !x.revokedAt);
        if (!k) return null;
        const { keyHash: _omit, ...pub } = k; // eslint-disable-line @typescript-eslint/no-unused-vars
        return clone(pub);
      },
      async list() {
        return [...t.agentKeys.values()]
          .sort(byDesc((k) => k.createdAt))
          .map(({ keyHash: _omit, ...pub }) => clone(pub)); // eslint-disable-line @typescript-eslint/no-unused-vars
      },
      async revoke(id) {
        const k = t.agentKeys.get(id);
        if (!k) return null;
        k.revokedAt ??= now();
        const { keyHash: _omit, ...pub } = k; // eslint-disable-line @typescript-eslint/no-unused-vars
        return clone(pub);
      },
      async touch(id) {
        const k = t.agentKeys.get(id);
        if (k) k.lastUsedAt = now();
      },
    },

    audit: {
      async record(entry) {
        const e: AuditEntry = { ...clone(entry), id: randomUUID(), createdAt: now() };
        t.audit.set(e.id, e);
        return clone(e);
      },
      async getById(id) {
        const e = t.audit.get(id);
        return e ? clone(e) : null;
      },
      async list({ entity, entityId, limit, cursor }) {
        const rows = [...t.audit.values()]
          .filter((e) => !entity || e.entity === entity)
          .filter((e) => !entityId || e.entityId === entityId)
          .sort(byDesc((e) => e.createdAt));
        return paginate(rows.map(clone), limit, cursor);
      },
    },

    async stats() {
      const users = [...t.users.values()];
      const posts = [...t.posts.values()];
      return {
        users: users.length,
        admins: users.filter((u) => u.role === "admin").length,
        subscribers: [...t.subscribers.values()].filter((s) => s.status === "subscribed").length,
        activeSubscriptions: [...t.subscriptions.values()].filter((s) => grantsAccess(s)).length,
        purchases: [...t.purchases.values()].filter((p) => !p.refunded).length,
        publishedPosts: posts.filter((p) => p.status === "published").length,
        draftPosts: posts.filter((p) => p.status === "draft").length,
        openFeedback: [...t.feedback.values()].filter((f) => ["new", "planned", "in_progress"].includes(f.status)).length,
      };
    },

    async growth(span, now = new Date()) {
      const days = growthDays(clampGrowthDays(span), now);
      const index = new Map(days.map((d, i) => [d, i]));
      const users = days.map(() => 0);
      const subscribers = days.map(() => 0);
      for (const u of t.users.values()) {
        const i = index.get(u.createdAt.slice(0, 10));
        if (i !== undefined) users[i] += 1;
      }
      for (const sub of t.subscribers.values()) {
        const i = sub.status === "subscribed" ? index.get(sub.createdAt.slice(0, 10)) : undefined;
        if (i !== undefined) subscribers[i] += 1;
      }
      return { days, users, subscribers };
    },
  };

  return store;
}
