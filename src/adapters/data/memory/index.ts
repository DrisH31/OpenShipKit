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
import { ABANDONED_ERROR, DataError, clampGrowthDays, clampLimit, type DataStore, type PaidProvider, type UsageInput } from "@/core/data";
import type {
  AgentKey,
  AuditEntry,
  ContentEntry,
  Feedback,
  Job,
  JobCounts,
  Page,
  Plan,
  Post,
  Purchase,
  Subscriber,
  Subscription,
  UsageEvent,
  UsageSubject,
  User,
} from "@/core/types";
import { grantsAccess, growthDays, isRenewing } from "@/core/types";
import { SEED } from "@/content/seed";
import { invitationState, type Org, type OrgInvitation, type OrgMember, type OrgRole } from "@/core/orgs";

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
  jobs: Map<string, Job>;
  orgs: Map<string, Org>;
  /** `${orgId}:${userId}` → membership (role and when it began). */
  orgMembers: Map<string, { orgId: string; userId: string; role: OrgRole; joinedAt: string }>;
  invitations: Map<string, OrgInvitation & { tokenHash: string }>;
  usage: UsageEvent[];
}

const now = () => new Date().toISOString();

const UNFINISHED = new Set<Job["status"]>(["queued", "running"]);

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
    jobs: new Map(),
    orgs: new Map(),
    orgMembers: new Map(),
    invitations: new Map(),
    usage: [],
  };
  const stamp = now();
  for (const p of SEED.plans) {
    const id = randomUUID();
    t.plans.set(p.key, { ...clone(p), limits: clone(p.limits ?? {}), id, updatedAt: stamp });
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

  /** A membership joined to its account, like the Postgres store's join. */
  const memberOf = (m: { orgId: string; userId: string; role: OrgRole; joinedAt: string } | undefined): OrgMember | null => {
    const u = m ? t.users.get(m.userId) : undefined;
    return m && u ? { orgId: m.orgId, userId: m.userId, role: m.role, email: u.email, name: u.name, joinedAt: m.joinedAt } : null;
  };
  const seatsUsed = (orgId: string) =>
    [...t.orgMembers.values()].filter((m) => m.orgId === orgId).length +
    [...t.invitations.values()].filter((i) => i.orgId === orgId && invitationState(i) === "pending").length;
  // ---- usage helpers (shared by record and consume)
  const createdAtOf = new Map<string, string>();
  const sameSubject = (a: UsageSubject, b: UsageSubject) => a.type === b.type && a.id === b.id;
  const sumOf = (subject: UsageSubject, metric: string, from: string, to: string) => {
    const lo = new Date(from).toISOString();
    const hi = new Date(to).toISOString();
    return t.usage.filter((e) => sameSubject(e.subject, subject) && e.metric === metric && e.occurredAt >= lo && e.occurredAt < hi).reduce((n, e) => n + e.quantity, 0);
  };
  const findKeyed = ({ subject, metric, key }: UsageInput) => (key ? t.usage.find((e) => e.key === key && e.metric === metric && sameSubject(e.subject, subject)) : undefined);
  const validUsage = ({ quantity, occurredAt }: UsageInput) => {
    if (!Number.isInteger(quantity) || quantity < 0) throw new DataError("invalid", "quantity must be a whole number of at least 0");
    if (occurredAt !== undefined && Number.isNaN(Date.parse(occurredAt))) throw new DataError("invalid", `occurredAt is not a valid date: "${occurredAt}"`);
  };
  const recordUsage = (input: UsageInput): { event: UsageEvent; created: boolean } => {
    const seen = findKeyed(input);
    if (seen) return { event: clone(seen), created: false };
    validUsage(input);
    const { subject, metric, quantity, key = null, occurredAt, report = false } = input;
    const event: UsageEvent = { id: randomUUID(), subject: { ...subject }, metric, quantity, key, occurredAt: occurredAt ? new Date(occurredAt).toISOString() : now(), reportPending: report, reportedAt: null };
    t.usage.push(event);
    createdAtOf.set(event.id, now());
    return { event: clone(event), created: true };
  };
  const publicInvitation = ({ tokenHash: _hash, ...rest }: OrgInvitation & { tokenHash: string }): OrgInvitation => clone(rest); // eslint-disable-line @typescript-eslint/no-unused-vars

  const store: DataStore = {
    id: "memory",
    async appliedMigration() {
      return null; // in memory: no migrations to be behind on
    },
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
        for (const [k, m] of t.orgMembers) if (m.userId === id) t.orgMembers.delete(k);
        for (const o of t.orgs.values()) if (o.createdBy === id) o.createdBy = null;
        for (const i of t.invitations.values()) if (i.invitedBy === id) i.invitedBy = null;
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
        const plan: Plan = { ...clone(input), limits: clone(input.limits ?? {}), id: existing?.id ?? randomUUID(), updatedAt: now() };
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
        const sub: Subscription = {
          ...input,
          currentPeriodStart: input.currentPeriodStart ?? null,
          orgId: input.orgId ?? null,
          seats: input.seats ?? null,
          id: existing?.id ?? randomUUID(),
          createdAt: existing?.createdAt ?? stamp,
          updatedAt: stamp,
        };
        t.subscriptions.set(id, sub);
        return clone(sub);
      },
      async countRenewingByProvider() {
        const out: Partial<Record<PaidProvider, number>> = {};
        for (const s of t.subscriptions.values()) if (isRenewing(s)) out[s.provider] = (out[s.provider] ?? 0) + 1;
        return out;
      },
      async requestCancel(provider, providerSubscriptionId) {
        const s = t.subscriptions.get(`${provider}:${providerSubscriptionId}`);
        if (!s || s.cancelAtPeriodEnd) return null;
        const before = clone(s);
        s.cancelAtPeriodEnd = true;
        s.updatedAt = now();
        return before;
      },
      async getSubscription(provider, providerSubscriptionId) {
        const s = t.subscriptions.get(`${provider}:${providerSubscriptionId}`);
        return s ? clone(s) : null;
      },
      async listSubscriptions({ userId, orgId, status, limit, cursor }) {
        const rows = [...t.subscriptions.values()]
          .filter((s) => !userId || s.userId === userId)
          .filter((s) => orgId === undefined || s.orgId === orgId)
          .filter((s) => !status || s.status === status)
          .sort(byDesc((s) => s.updatedAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async recordPurchase(input) {
        const id = `${input.provider}:${input.providerOrderId}`;
        const existing = t.purchases.get(id);
        const purchase: Purchase = { ...input, chargedBack: input.chargedBack ?? false, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now() };
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

    usage: {
      async record(input) {
        return recordUsage(input);
      },
      async consume({ limit, from, to, ...input }) {
        // One synchronous stretch (no await between the sum and the insert): atomic on one event loop.
        const existing = findKeyed(input);
        if (existing) return { event: clone(existing), created: false, used: sumOf(input.subject, input.metric, from, to) };
        validUsage(input);
        const used = sumOf(input.subject, input.metric, from, to);
        if (used + input.quantity > limit) return { event: null, created: false, used };
        return { ...recordUsage(input), used };
      },
      async get(id) {
        const e = t.usage.find((x) => x.id === id);
        return e ? clone(e) : null;
      },
      async listPendingReports(after, before, limit) {
        const lo = new Date(after).toISOString();
        const hi = new Date(before).toISOString();
        return t.usage
          .filter((e) => {
            const at = createdAtOf.get(e.id) ?? e.occurredAt;
            const queued = [...t.jobs.values()].some((j) => j.key === `usage:${e.id}` && (j.status === "queued" || j.status === "running"));
            return e.reportPending && at >= lo && at < hi && !queued;
          })
          .slice(0, limit)
          .map(clone);
      },
      async settleReport(id, reportedAt) {
        const e = t.usage.find((x) => x.id === id);
        if (e) {
          e.reportPending = false;
          e.reportedAt = reportedAt ? new Date(reportedAt).toISOString() : null;
        }
      },
      async sum(subject, metric, from, to) {
        return sumOf(subject, metric, from, to);
      },
      async totals(subject, from, to) {
        const out: Record<string, number> = {};
        for (const e of t.usage) {
          if (e.subject.type !== subject.type || e.subject.id !== subject.id) continue;
          if (e.occurredAt < new Date(from).toISOString() || e.occurredAt >= new Date(to).toISOString()) continue;
          out[e.metric] = (out[e.metric] ?? 0) + e.quantity;
        }
        return out;
      },
    },

    orgs: {
      async create({ name, slug, ownerId }) {
        if (!t.users.has(ownerId)) throw new DataError("invalid", `No user ${ownerId}`);
        if ([...t.orgs.values()].some((o) => o.slug === slug)) throw new DataError("conflict", "organisation: a row with the same unique key already exists");
        const stamp = now();
        const org: Org = { id: randomUUID(), name, slug, createdBy: ownerId, createdAt: stamp, updatedAt: stamp };
        t.orgs.set(org.id, org);
        t.orgMembers.set(`${org.id}:${ownerId}`, { orgId: org.id, userId: ownerId, role: "owner", joinedAt: stamp });
        return clone(org);
      },
      async get(id) {
        const o = t.orgs.get(id);
        return o ? clone(o) : null;
      },
      async getBySlug(slug) {
        const o = [...t.orgs.values()].find((x) => x.slug === slug);
        return o ? clone(o) : null;
      },
      async update(id, patch) {
        const o = t.orgs.get(id);
        if (!o) throw new DataError("not_found", `No organisation ${id}`);
        if (patch.slug !== undefined && [...t.orgs.values()].some((x) => x.slug === patch.slug && x.id !== id)) {
          throw new DataError("conflict", "organisation: a row with the same unique key already exists");
        }
        Object.assign(o, { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.slug !== undefined ? { slug: patch.slug } : {}), updatedAt: now() });
        return clone(o);
      },
      async delete(id) {
        const o = t.orgs.get(id);
        if (!o) return null;
        t.orgs.delete(id);
        for (const [k, m] of t.orgMembers) if (m.orgId === id) t.orgMembers.delete(k);
        for (const [k, i] of t.invitations) if (i.orgId === id) t.invitations.delete(k);
        return clone(o);
      },
      async list({ search, limit, cursor }) {
        const q = search?.trim().toLowerCase();
        const rows = [...t.orgs.values()]
          .filter((o) => !q || o.name.toLowerCase().includes(q) || o.slug.includes(q))
          .sort(byDesc((o) => o.createdAt))
          .map((o) => ({ ...clone(o), members: [...t.orgMembers.values()].filter((m) => m.orgId === o.id).length }));
        return paginate(rows, limit, cursor);
      },
      async listForUser(userId) {
        return [...t.orgMembers.values()]
          .filter((m) => m.userId === userId && t.orgs.has(m.orgId))
          .sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : a.orgId < b.orgId ? -1 : 1))
          .map((m) => ({ org: clone(t.orgs.get(m.orgId)!), role: m.role }));
      },
      async getMember(orgId, userId) {
        return memberOf(t.orgMembers.get(`${orgId}:${userId}`));
      },
      async listMembers(orgId) {
        const rank: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 };
        return [...t.orgMembers.values()]
          .filter((m) => m.orgId === orgId)
          .sort((a, b) => rank[a.role] - rank[b.role] || (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : a.userId < b.userId ? -1 : 1))
          .map((m) => memberOf(m)!)
          .filter(Boolean);
      },
      async countMembers(orgId) {
        return [...t.orgMembers.values()].filter((m) => m.orgId === orgId).length;
      },
      async addMember(orgId, userId, role) {
        if (!t.orgs.has(orgId) || !t.users.has(userId)) throw new DataError("invalid", "No such organisation or user");
        const k = `${orgId}:${userId}`;
        if (t.orgMembers.has(k)) throw new DataError("conflict", "membership: a row with the same unique key already exists");
        t.orgMembers.set(k, { orgId, userId, role, joinedAt: now() });
        return memberOf(t.orgMembers.get(k))!;
      },
      async setMemberRole(orgId, userId, role) {
        const m = t.orgMembers.get(`${orgId}:${userId}`);
        if (!m) throw new DataError("not_found", "No such membership");
        m.role = role;
        return memberOf(m)!;
      },
      async removeMember(orgId, userId) {
        return t.orgMembers.delete(`${orgId}:${userId}`);
      },
      async createInvitation({ orgId, email, role, tokenHash, invitedBy, expiresAt, seatLimit = null }) {
        if (!t.orgs.has(orgId)) throw new DataError("invalid", `No organisation ${orgId}`);
        if (invitedBy !== null && !t.users.has(invitedBy)) throw new DataError("invalid", `No user ${invitedBy}`);
        if (Number.isNaN(Date.parse(expiresAt))) throw new DataError("invalid", `expiresAt is not a valid date: "${expiresAt}"`);
        const e = email.trim().toLowerCase();
        const all = [...t.invitations.values()];
        if (all.some((i) => i.tokenHash === tokenHash) || all.some((i) => i.orgId === orgId && i.email === e && !i.acceptedAt && !i.revokedAt)) {
          throw new DataError("conflict", "invitation: a row with the same unique key already exists");
        }
        // No await between this check and the insert: one process, so it's atomic here.
        if (seatLimit !== null && seatsUsed(orgId) + 1 > seatLimit) throw new DataError("limit", `All ${seatLimit} seats are in use.`);
        const inv = { id: randomUUID(), orgId, email: e, role, tokenHash, invitedBy, createdAt: now(), expiresAt: new Date(expiresAt).toISOString(), acceptedAt: null, revokedAt: null };
        t.invitations.set(inv.id, inv);
        return publicInvitation(inv);
      },
      async getInvitation(id) {
        const i = t.invitations.get(id);
        return i ? publicInvitation(i) : null;
      },
      async findInvitationByTokenHash(tokenHash) {
        const i = [...t.invitations.values()].find((x) => x.tokenHash === tokenHash);
        return i ? publicInvitation(i) : null;
      },
      async listInvitations(orgId, opts = {}) {
        return [...t.invitations.values()]
          .filter((i) => i.orgId === orgId && (opts.all || invitationState(i) === "pending"))
          .sort(byDesc((i) => i.createdAt))
          .map(publicInvitation);
      },
      async revokeInvitation(id) {
        const i = t.invitations.get(id);
        if (!i || i.acceptedAt || i.revokedAt) return null;
        i.revokedAt = now();
        return publicInvitation(i);
      },
      async acceptInvitation(id, userId, opts = {}) {
        const i = t.invitations.get(id);
        if (!i || invitationState(i) !== "pending") return null;
        const seatLimit = opts.seatLimit ?? null;
        if (seatLimit !== null && seatsUsed(i.orgId) > seatLimit) throw new DataError("limit", `All ${seatLimit} seats are in use.`);
        const k = `${i.orgId}:${userId}`;
        if (!t.users.has(userId)) throw new DataError("invalid", `No user ${userId}`);
        if (t.orgMembers.has(k)) throw new DataError("conflict", "membership: a row with the same unique key already exists");
        const stamp = now();
        i.acceptedAt = stamp;
        t.orgMembers.set(k, { orgId: i.orgId, userId, role: i.role, joinedAt: stamp });
        return { invitation: publicInvitation(i), member: memberOf(t.orgMembers.get(k))! };
      },
    },

    jobs: {
      async enqueue({ kind, payload, runAt, maxAttempts = 5, key = null, sensitive = false }) {
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new DataError("invalid", "maxAttempts must be a whole number of at least 1");
        if (runAt !== undefined && Number.isNaN(Date.parse(runAt))) throw new DataError("invalid", `runAt is not a valid date: "${runAt}"`);
        if (key !== null) {
          const holder = [...t.jobs.values()].find((j) => j.key === key && UNFINISHED.has(j.status));
          if (holder) return { job: clone(holder), created: false };
        }
        const stamp = now();
        const job: Job = {
          id: randomUUID(),
          kind,
          payload: payload === undefined ? null : clone(payload),
          status: "queued",
          attempts: 0,
          maxAttempts,
          runAt: runAt ? new Date(runAt).toISOString() : stamp,
          lockedUntil: null,
          lastError: null,
          key,
          sensitive,
          createdAt: stamp,
          updatedAt: stamp,
          finishedAt: null,
        };
        t.jobs.set(job.id, job);
        return { job: clone(job), created: true };
      },
      async claim({ limit, leaseMs }) {
        const at = Date.now();
        const due = [...t.jobs.values()]
          .filter(
            (j) =>
              (j.status === "queued" && Date.parse(j.runAt) <= at) ||
              (j.status === "running" && j.lockedUntil !== null && Date.parse(j.lockedUntil) < at && j.attempts < j.maxAttempts),
          )
          .sort((a, b) => (a.runAt < b.runAt ? -1 : a.runAt > b.runAt ? 1 : a.id < b.id ? -1 : 1))
          .slice(0, Math.max(1, Math.min(Math.floor(limit), 50)));
        const stamp = new Date(at).toISOString();
        for (const j of due) {
          j.status = "running";
          j.attempts += 1;
          j.lockedUntil = new Date(at + Math.max(1, leaseMs)).toISOString();
          j.updatedAt = stamp;
        }
        return due.map(clone);
      },
      async failAbandoned() {
        const at = Date.now();
        const stamp = new Date(at).toISOString();
        const ended: Job[] = [];
        for (const j of t.jobs.values()) {
          if (j.status !== "running" || j.lockedUntil === null || Date.parse(j.lockedUntil) >= at || j.attempts < j.maxAttempts) continue;
          Object.assign(j, { status: "failed", lockedUntil: null, lastError: ABANDONED_ERROR, finishedAt: stamp, updatedAt: stamp });
          if (j.sensitive) j.payload = null;
          ended.push(clone(j));
        }
        return ended;
      },
      async complete(id, attempt) {
        const j = t.jobs.get(id);
        if (!j || j.status !== "running" || j.attempts !== attempt) return false;
        const stamp = now();
        Object.assign(j, { status: "succeeded", lockedUntil: null, finishedAt: stamp, updatedAt: stamp });
        if (j.sensitive) j.payload = null;
        return true;
      },
      async fail(id, attempt, { error, retryAt }) {
        const j = t.jobs.get(id);
        if (!j || j.status !== "running" || j.attempts !== attempt) return null;
        if (retryAt !== null && Number.isNaN(Date.parse(retryAt))) throw new DataError("invalid", `retryAt is not a valid date: "${retryAt}"`);
        const again = retryAt !== null && j.attempts < j.maxAttempts;
        const stamp = now();
        j.status = again ? "queued" : "failed";
        if (again) j.runAt = new Date(retryAt).toISOString();
        j.lockedUntil = null;
        j.lastError = error.slice(0, 2_000);
        j.finishedAt = again ? null : stamp;
        j.updatedAt = stamp;
        if (j.sensitive && !again) j.payload = null;
        return clone(j);
      },
      async retry(id) {
        const j = t.jobs.get(id);
        if (!j || j.status !== "failed" || j.sensitive) return null;
        const stamp = now();
        Object.assign(j, { status: "queued", attempts: 0, runAt: stamp, lockedUntil: null, finishedAt: null, updatedAt: stamp });
        return clone(j);
      },
      async get(id) {
        const j = t.jobs.get(id);
        return j ? clone(j) : null;
      },
      async list({ status, limit, cursor }) {
        const rows = [...t.jobs.values()].filter((j) => !status || j.status === status).sort(byDesc((j) => j.createdAt));
        return paginate(rows.map(clone), limit, cursor);
      },
      async counts() {
        const counts: JobCounts = { queued: 0, running: 0, succeeded: 0, failed: 0, oldestDueAt: null };
        const at = Date.now();
        for (const j of t.jobs.values()) {
          counts[j.status] += 1;
          if (j.status === "queued" && Date.parse(j.runAt) <= at && (counts.oldestDueAt === null || j.runAt < counts.oldestDueAt)) counts.oldestDueAt = j.runAt;
        }
        return counts;
      },
      async prune(finishedBefore) {
        const before = Date.parse(finishedBefore);
        if (Number.isNaN(before)) throw new DataError("invalid", `finishedBefore is not a valid date: "${finishedBefore}"`);
        let n = 0;
        for (const [id, j] of t.jobs) {
          if ((j.status === "succeeded" || j.status === "failed") && j.finishedAt && Date.parse(j.finishedAt) < before) {
            t.jobs.delete(id);
            n += 1;
          }
        }
        return n;
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
