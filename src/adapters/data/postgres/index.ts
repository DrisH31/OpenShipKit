import "server-only";

//
// DATA_PROVIDER=postgres — the DataStore over any Postgres (your own server,
// or any managed host) through Drizzle and node-postgres (or the embedded PGlite in development). Tables live in
// ./schema.ts; migrations in /drizzle (`npm run db:migrate`).
//
// Rules this file keeps (the contract is src/core/data.ts):
//  - Lists use keyset pagination: the cursor is an opaque base64url of the
//    last row's (sort timestamp, id), and the next page is `(sort, id) < cursor`
//    in the same order. Stable under inserts, unlike offsets.
//  - Unique violations (SQLSTATE 23505) become DataError("conflict"); bad
//    references and malformed ids become "invalid"; updates of missing rows
//    "not_found". Anything else is a backend failure and is rethrown as is.
//  - Ids are uuids: a lookup with a non-uuid id is a miss (null), never a
//    Postgres cast error.
//  - Time comes from the database (`now()`), so rows written by several app
//    servers sort on one clock.
//

import { and, arrayContains, asc, desc, eq, getTableColumns, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { ABANDONED_ERROR, DataError, clampGrowthDays, clampLimit, type DataStore, type PaidProvider } from "@/core/data";
import {
  ENTITLED_STATUSES,
  PAST_DUE_GRACE_DAYS,
  growthDays,
  type AgentKey,
  type AuditEntry,
  type ContentEntry,
  type Feedback,
  type FeedbackStatus,
  type Growth,
  type Job,
  type JobCounts,
  type JobStatus,
  type Page,
  type Plan,
  type Post,
  type PostInput,
  type Purchase,
  type Stats,
  type Subscriber,
  type Subscription,
  type User,
} from "@/core/types";
import { getDrizzle, type Db } from "./db";
import {
  agentKeys,
  auditLog,
  billingCustomers,
  content,
  feedback,
  jobs,
  orgInvitations,
  orgMembers,
  orgs,
  plans,
  posts,
  purchases,
  subscribers,
  subscriptions,
  users,
  webhookEvents,
} from "./schema";
import type { Org, OrgInvitation, OrgMember, OrgRole } from "@/core/orgs";
import { log } from "@/server/log";

// ---------------------------------------------------------------- helpers

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): v is string => typeof v === "string" && UUID_RE.test(v);

const OPEN_FEEDBACK: FeedbackStatus[] = ["new", "planned", "in_progress"];

/** The most jobs one claim() takes, whatever the caller asks. */
const MAX_CLAIM = 50;
/** A job's lastError is cut to this many characters: a stack can be long, and it is for a person to read. */
const MAX_JOB_ERROR = 2_000;

const now = sql`now()`;

/** How stale users.last_seen_at may get before a sign-in refreshes it — one write per user per window, not per request. */
const LAST_SEEN_RESOLUTION = "5 minutes";

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** An ISO string (or null) from the domain → a Date for a timestamptz column. */
function toDate(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new DataError("invalid", `${field} is not a valid date: "${value}"`);
  return d;
}

/** `%term%` for ILIKE, with the user's own % _ \ matched literally. */
function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** JSON for a NOT NULL jsonb column: a JS null/undefined is stored as JSON null. */
function jsonValue(value: unknown): unknown {
  return value === undefined || value === null ? sql`'null'::jsonb` : value;
}

/** A row patch whose values may also be SQL (e.g. `now()`). */
type Settable<T> = { [K in keyof T]?: T[K] | SQL };

interface Cursor {
  at: string;
  id: string;
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [at, id] = parsed as [unknown, unknown];
      if (typeof at === "string" && !Number.isNaN(Date.parse(at)) && typeof id === "string" && isUuid(id)) return { at, id };
    }
  } catch {
    // fall through
  }
  throw new DataError("invalid", "Invalid pagination cursor");
}

/** The WHERE for "rows after the cursor" in (sort desc, id desc) order. */
function afterCursor(sortCol: PgColumn, idCol: PgColumn, cursor: Cursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${sortCol}, ${idCol}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

/** Rows were fetched with limit + 1; trim to `size` and build the next cursor from the last kept row. */
function toPage<R extends { id: string }, T>(rows: R[], size: number, sortKey: (r: R) => Date, map: (r: R) => T): Page<T> {
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  const nextCursor = rows.length > size && last ? encodeCursor(sortKey(last), last.id) : null;
  return { items: items.map(map), nextCursor };
}

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** Run a write, turning constraint violations into DataErrors. */
async function write<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DataError) throw error;
    switch (pgCode(error)) {
      case "23505":
        throw new DataError("conflict", `${what}: a row with the same unique key already exists`);
      case "23503":
        throw new DataError("invalid", `${what}: refers to a row that doesn't exist`);
      case "22P02":
      case "23502":
      case "23514":
        throw new DataError("invalid", `${what}: a value is missing or out of range`);
      default:
        throw error;
    }
  }
}

// ---------------------------------------------------------------- row → domain

type UserRow = typeof users.$inferSelect;
type PostRow = typeof posts.$inferSelect;
type PlanRow = typeof plans.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;
type PurchaseRow = typeof purchases.$inferSelect;
type FeedbackRow = typeof feedback.$inferSelect;
type SubscriberRow = typeof subscribers.$inferSelect;
type AgentKeyRow = typeof agentKeys.$inferSelect;
type AuditRow = typeof auditLog.$inferSelect;

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  image: r.image,
  role: r.role,
  banned: r.banned,
  authProvider: r.authProvider,
  authProviderUserId: r.authProviderUserId,
  createdAt: iso(r.createdAt),
  lastSeenAt: isoOrNull(r.lastSeenAt),
});

const toPost = (r: PostRow): Post => ({
  id: r.id,
  kind: r.kind,
  slug: r.slug,
  title: r.title,
  description: r.description,
  body: r.body,
  coverImage: r.coverImage,
  coverAlt: r.coverAlt,
  tags: r.tags,
  status: r.status,
  listed: r.listed,
  authorName: r.authorName,
  seoTitle: r.seoTitle,
  seoDescription: r.seoDescription,
  publishedAt: isoOrNull(r.publishedAt),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const toPlan = (r: PlanRow): Plan => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  features: r.features,
  prices: r.prices,
  highlighted: r.highlighted,
  contactSales: r.contactSales,
  ctaLabel: r.ctaLabel,
  trialDays: r.trialDays,
  active: r.active,
  sortOrder: r.sortOrder,
  updatedAt: iso(r.updatedAt),
});

const toSubscription = (r: SubscriptionRow): Subscription => ({
  id: r.id,
  userId: r.userId,
  provider: r.provider,
  providerSubscriptionId: r.providerSubscriptionId,
  providerCustomerId: r.providerCustomerId,
  planKey: r.planKey,
  interval: r.interval,
  status: r.status,
  currentPeriodEnd: isoOrNull(r.currentPeriodEnd),
  cancelAtPeriodEnd: r.cancelAtPeriodEnd,
  orgId: r.orgId,
  seats: r.seats,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const toPurchase = (r: PurchaseRow): Purchase => ({
  id: r.id,
  userId: r.userId,
  provider: r.provider,
  providerOrderId: r.providerOrderId,
  planKey: r.planKey,
  amountCents: r.amountCents,
  currency: r.currency,
  refunded: r.refunded,
  createdAt: iso(r.createdAt),
});

const toFeedback = (r: FeedbackRow): Feedback => ({
  id: r.id,
  userId: r.userId,
  email: r.email,
  name: r.name,
  kind: r.kind,
  title: r.title,
  message: r.message,
  status: r.status,
  adminNote: r.adminNote,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const toSubscriber = (r: SubscriberRow): Subscriber => ({
  id: r.id,
  email: r.email,
  source: r.source,
  status: r.status,
  createdAt: iso(r.createdAt),
});

/**
 * Never returns keyHash. `createdBy` is the minting admin's users.id (null for
 * a CLI-minted key, or once that user is deleted).
 */
const toAgentKey = (r: AgentKeyRow): AgentKey => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  hint: r.hint,
  createdBy: r.createdBy,
  createdAt: iso(r.createdAt),
  lastUsedAt: isoOrNull(r.lastUsedAt),
  revokedAt: isoOrNull(r.revokedAt),
});

type OrgRow = typeof orgs.$inferSelect;
type InvitationRow = typeof orgInvitations.$inferSelect;

const toOrg = (r: OrgRow): Org => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  createdBy: r.createdBy,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const toInvitation = (r: InvitationRow): OrgInvitation => ({
  id: r.id,
  orgId: r.orgId,
  email: r.email,
  role: r.role,
  invitedBy: r.invitedBy,
  createdAt: iso(r.createdAt),
  expiresAt: iso(r.expiresAt),
  acceptedAt: isoOrNull(r.acceptedAt),
  revokedAt: isoOrNull(r.revokedAt),
});

/** A membership joined to its account: what listMembers and getMember return. */
const memberColumns = {
  orgId: orgMembers.orgId,
  userId: orgMembers.userId,
  role: orgMembers.role,
  joinedAt: orgMembers.createdAt,
  email: users.email,
  name: users.name,
};
const toMember = (r: { orgId: string; userId: string; role: OrgRole; joinedAt: Date; email: string; name: string | null }): OrgMember => ({
  orgId: r.orgId,
  userId: r.userId,
  role: r.role,
  email: r.email,
  name: r.name,
  joinedAt: iso(r.joinedAt),
});
/** Owners first, then admins, then members. */
const ROLE_ORDER = sql`case ${orgMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`;
/** Pending: neither accepted nor revoked, and not past its expiry. */
const pendingInvitation = sql`(${orgInvitations.acceptedAt} is null and ${orgInvitations.revokedAt} is null and ${orgInvitations.expiresAt} > now())`;

type JobRow = typeof jobs.$inferSelect;

const toJob = (r: JobRow): Job => ({
  id: r.id,
  kind: r.kind,
  payload: r.payload ?? null,
  status: r.status,
  attempts: r.attempts,
  maxAttempts: r.maxAttempts,
  runAt: iso(r.runAt),
  lockedUntil: isoOrNull(r.lockedUntil),
  lastError: r.lastError,
  key: r.key,
  sensitive: r.sensitive,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
  finishedAt: isoOrNull(r.finishedAt),
});

/** Queued and due, or running with an expired lease (its worker died) and attempts left. */
const dueJob = sql`((${jobs.status} = 'queued' and ${jobs.runAt} <= now()) or (${jobs.status} = 'running' and ${jobs.lockedUntil} < now() and ${jobs.attempts} < ${jobs.maxAttempts}))`;

/** The payload as it should be once the job has ended: gone if it was sensitive. */
const endedPayload = sql`case when ${jobs.sensitive} then null else ${jobs.payload} end`;


const toAudit = (r: AuditRow): AuditEntry => ({
  id: r.id,
  actor: { type: r.actorType, id: r.actorId, label: r.actorLabel },
  action: r.action,
  entity: r.entity,
  entityId: r.entityId,
  before: r.before ?? null,
  after: r.after ?? null,
  createdAt: iso(r.createdAt),
});

/** PostInput/PostPatch fields → column values. Only keys present in `input` are returned. */
function postColumns(input: Partial<PostInput>): Partial<typeof posts.$inferInsert> {
  const out: Partial<typeof posts.$inferInsert> = {};
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.title !== undefined) out.title = input.title;
  if (input.description !== undefined) out.description = input.description;
  if (input.body !== undefined) out.body = input.body;
  if (input.coverImage !== undefined) out.coverImage = input.coverImage;
  if (input.coverAlt !== undefined) out.coverAlt = input.coverAlt;
  if (input.tags !== undefined) out.tags = input.tags;
  if (input.status !== undefined) out.status = input.status;
  if (input.listed !== undefined) out.listed = input.listed;
  if (input.authorName !== undefined) out.authorName = input.authorName;
  if (input.seoTitle !== undefined) out.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) out.seoDescription = input.seoDescription;
  if (input.publishedAt !== undefined) out.publishedAt = toDate(input.publishedAt, "publishedAt");
  return out;
}

// ---------------------------------------------------------------- the store

/**
 * The Postgres DataStore. Uses the shared pool from ./db unless a Drizzle
 * client is passed (tests point one at TEST_DATABASE_URL).
 */
export function createPostgresStore(opts: { db?: Db } = {}): DataStore {
  // Resolved per call so creating the store never reads env or connects.
  const db = (): Db => opts.db ?? getDrizzle();

  const store: DataStore = {
    id: "postgres",

    async health() {
      try {
        const started = Date.now();
        await db().execute(sql`select 1`);
        return { ok: true, detail: `postgres (${Date.now() - started} ms)` };
      } catch (error) {
        const cause = (error as { cause?: { message?: string } }).cause?.message;
        log.error("postgres", "health check failed", cause || pgCode(error) || (error instanceof Error ? error.message : error));
        return { ok: false, detail: `postgres unreachable${pgCode(error) ? ` (${pgCode(error)})` : ""}` };
      }
    },

    // ------------------------------------------------------------ users
    users: {
      async upsertFromIdentity(identity, { makeAdmin }) {
        // Runs on every signed-in request (getCurrentUser), so the common case
        // is one indexed read and no write: no transaction, no row lock. A
        // write happens only when the identity brings something new, or when
        // lastSeenAt is older than LAST_SEEN_RESOLUTION.
        const email = identity.email.trim().toLowerCase();
        const sameIdentity = and(eq(users.authProvider, identity.provider), eq(users.authProviderUserId, identity.providerUserId));
        const attempt = async (): Promise<UserRow> => {
          // Prefer the row for this exact identity; fall back to the email (same person, new provider).
          const [existing] = await db()
            .select()
            .from(users)
            .where(or(sameIdentity, eq(users.email, email)))
            .orderBy(sql`(${users.authProvider} = ${identity.provider} and ${users.authProviderUserId} = ${identity.providerUserId}) desc`)
            .limit(1);
          if (!existing) {
            const [row] = await db()
              .insert(users)
              .values({
                email,
                name: identity.name,
                image: identity.image,
                role: makeAdmin ? "admin" : "user",
                authProvider: identity.provider,
                authProviderUserId: identity.providerUserId,
                lastSeenAt: now,
              })
              .returning();
            return row;
          }
          const changed =
            existing.email !== email ||
            (existing.name === null && identity.name !== null) || // a name edited in settings wins over the auth identity
            (identity.image !== null && identity.image !== existing.image) ||
            existing.authProvider !== identity.provider ||
            existing.authProviderUserId !== identity.providerUserId ||
            (makeAdmin && existing.role !== "admin");
          if (changed) {
            // Fills and promotions are SQL expressions, so a concurrent edit
            // (a name set in settings, a role change by an admin) is never
            // overwritten by the value this request read a moment ago.
            const [row] = await db()
              .update(users)
              .set({
                email,
                name: sql`coalesce(${users.name}, ${identity.name})`,
                ...(identity.image !== null ? { image: identity.image } : {}),
                authProvider: identity.provider,
                authProviderUserId: identity.providerUserId,
                ...(makeAdmin ? { role: "admin" as const } : {}),
                lastSeenAt: now,
              })
              .where(eq(users.id, existing.id))
              .returning();
            // Deleted between the read and the write: sign-in recreates it.
            return row ?? attempt();
          }
          const [touched] = await db()
            .update(users)
            .set({ lastSeenAt: now })
            .where(and(eq(users.id, existing.id), or(isNull(users.lastSeenAt), sql`${users.lastSeenAt} < now() - ${LAST_SEEN_RESOLUTION}::interval`)))
            .returning();
          return touched ?? existing;
        };
        try {
          return toUser(await write("user", attempt));
        } catch (error) {
          // Two first sign-ins racing: the loser's insert conflicts; the retry finds the winner's row.
          if (error instanceof DataError && error.code === "conflict") return toUser(await write("user", attempt));
          throw error;
        }
      },
      async getById(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().select().from(users).where(eq(users.id, id)).limit(1);
        return row ? toUser(row) : null;
      },
      async getByEmail(email) {
        const [row] = await db().select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
        return row ? toUser(row) : null;
      },
      async getManyByIds(ids) {
        // Non-uuids can't match (and would fail the cast), so they're dropped like misses.
        const wanted = [...new Set(ids.filter(isUuid))];
        if (wanted.length === 0) return [];
        const rows = await db().select().from(users).where(inArray(users.id, wanted));
        return rows.map(toUser);
      },
      async list({ search, role, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        const q = search?.trim();
        const rows = await db()
          .select()
          .from(users)
          .where(
            and(
              role ? eq(users.role, role) : undefined,
              q ? or(ilike(users.email, containsPattern(q)), ilike(users.name, containsPattern(q))) : undefined,
              afterCursor(users.createdAt, users.id, c),
            ),
          )
          .orderBy(desc(users.createdAt), desc(users.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.createdAt, toUser);
      },
      async update(id, patch) {
        if (!isUuid(id)) throw new DataError("not_found", `No user ${id}`);
        const set: Partial<typeof users.$inferInsert> = {};
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.role !== undefined) set.role = patch.role;
        if (patch.banned !== undefined) set.banned = patch.banned;
        const [row] =
          Object.keys(set).length > 0
            ? await write("user", () => db().update(users).set(set).where(eq(users.id, id)).returning())
            : await db().select().from(users).where(eq(users.id, id)).limit(1);
        if (!row) throw new DataError("not_found", `No user ${id}`);
        return toUser(row);
      },
      async delete(id) {
        if (!isUuid(id)) return;
        // FKs do the rest: feedback.user_id → NULL; subscriptions, purchases, billing customers → deleted.
        await db().delete(users).where(eq(users.id, id));
      },
    },

    // ------------------------------------------------------------ content
    content: {
      async get(key) {
        const [row] = await db().select().from(content).where(eq(content.key, key)).limit(1);
        return row ? { key: row.key, value: row.value, updatedAt: iso(row.updatedAt) } : null;
      },
      async all() {
        const rows = await db().select().from(content).orderBy(asc(content.key));
        return rows.map((r): ContentEntry => ({ key: r.key, value: r.value, updatedAt: iso(r.updatedAt) }));
      },
      async set(key, value) {
        const v = jsonValue(value);
        const [row] = await write("content", () =>
          db()
            .insert(content)
            .values({ key, value: v })
            .onConflictDoUpdate({ target: content.key, set: { value: v, updatedAt: now } })
            .returning(),
        );
        return { key: row.key, value: row.value, updatedAt: iso(row.updatedAt) };
      },
      async delete(key) {
        await db().delete(content).where(eq(content.key, key));
      },
    },

    // ------------------------------------------------------------ posts
    posts: {
      async list({ kind, status, listed, tag, search, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        const q = search?.trim();
        // Published lists by publish date, everything else by last edit (the contract's ordering).
        const sortCol = status === "published" ? posts.publishedAt : posts.updatedAt;
        const rows = await db()
          .select()
          .from(posts)
          .where(
            and(
              kind ? eq(posts.kind, kind) : undefined,
              status ? eq(posts.status, status) : undefined,
              listed !== undefined ? eq(posts.listed, listed) : undefined,
              tag ? arrayContains(posts.tags, [tag]) : undefined,
              q ? or(ilike(posts.title, containsPattern(q)), ilike(posts.body, containsPattern(q))) : undefined,
              afterCursor(sortCol, posts.id, c),
            ),
          )
          .orderBy(desc(sortCol), desc(posts.id))
          .limit(size + 1);
        // published_at is non-null for published rows (posts_published_at_check).
        return toPage(rows, size, (r) => (status === "published" ? (r.publishedAt ?? r.updatedAt) : r.updatedAt), toPost);
      },
      async getById(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().select().from(posts).where(eq(posts.id, id)).limit(1);
        return row ? toPost(row) : null;
      },
      async getBySlug(kind, slug) {
        const [row] = await db()
          .select()
          .from(posts)
          .where(and(eq(posts.kind, kind), eq(posts.slug, slug)))
          .limit(1);
        return row ? toPost(row) : null;
      },
      async create(input) {
        const status = input.status ?? "draft";
        const publishedAt = toDate(input.publishedAt, "publishedAt");
        // Seed and audit restore pass the original id and timestamps (PostInput);
        // a duplicate id is a unique violation → DataError("conflict").
        if (input.id !== undefined && !isUuid(input.id)) throw new DataError("invalid", `Post id is not a uuid: "${input.id}"`);
        const [row] = await write(`${input.kind} "${input.slug}"`, () =>
          db()
            .insert(posts)
            .values({
              ...postColumns(input),
              ...(input.id !== undefined ? { id: input.id } : {}),
              kind: input.kind,
              slug: input.slug,
              title: input.title,
              status,
              publishedAt: publishedAt ?? (status === "published" ? now : null),
              createdAt: toDate(input.createdAt, "createdAt") ?? now,
              updatedAt: toDate(input.updatedAt, "updatedAt") ?? now,
            })
            .returning(),
        );
        return toPost(row);
      },
      async update(id, patch) {
        if (!isUuid(id)) throw new DataError("not_found", `No post ${id}`);
        const row = await write(`post ${id}`, () =>
          db().transaction(async (tx) => {
            const [current] = await tx.select().from(posts).where(eq(posts.id, id)).limit(1).for("update");
            if (!current) throw new DataError("not_found", `No post ${id}`);
            const set: Settable<typeof posts.$inferInsert> = { ...postColumns(patch), updatedAt: now };
            const nextStatus = set.status ?? current.status;
            const nextPublishedAt = "publishedAt" in set ? set.publishedAt : current.publishedAt;
            if (nextStatus === "published" && !nextPublishedAt) set.publishedAt = now;
            const [updated] = await tx.update(posts).set(set).where(eq(posts.id, id)).returning();
            return updated;
          }),
        );
        return toPost(row);
      },
      async delete(id) {
        if (!isUuid(id)) return;
        await db().delete(posts).where(eq(posts.id, id));
      },
      async tags(kind) {
        const result = await db().execute<{ tag: string; count: number }>(sql`
          select t.tag as tag, count(*)::int as count
          from ${posts}, unnest(${posts.tags}) as t(tag)
          where ${posts.kind} = ${kind} and ${posts.status} = 'published' and ${posts.listed}
          group by t.tag`);
        // Sorted here so ties order exactly like the other adapters (localeCompare, not the DB collation).
        return result.rows
          .map((r) => ({ tag: r.tag, count: Number(r.count) }))
          .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      },
    },

    // ------------------------------------------------------------ plans
    plans: {
      async list(opts) {
        const rows = await db()
          .select()
          .from(plans)
          .where(opts?.activeOnly ? eq(plans.active, true) : undefined)
          .orderBy(asc(plans.sortOrder), asc(plans.key));
        return rows.map(toPlan);
      },
      async getByKey(key) {
        const [row] = await db().select().from(plans).where(eq(plans.key, key)).limit(1);
        return row ? toPlan(row) : null;
      },
      async upsert(input) {
        const values = {
          name: input.name,
          description: input.description,
          features: input.features,
          prices: input.prices,
          highlighted: input.highlighted,
          contactSales: input.contactSales,
          ctaLabel: input.ctaLabel,
          trialDays: input.trialDays,
          active: input.active,
          sortOrder: input.sortOrder,
        };
        const [row] = await write(`plan "${input.key}"`, () =>
          db()
            .insert(plans)
            .values({ key: input.key, ...values })
            .onConflictDoUpdate({ target: plans.key, set: { ...values, updatedAt: now } })
            .returning(),
        );
        return toPlan(row);
      },
      async delete(key) {
        await db().delete(plans).where(eq(plans.key, key));
      },
    },

    // ------------------------------------------------------------ billing
    billing: {
      async upsertSubscription(input) {
        const values = {
          userId: input.userId,
          providerCustomerId: input.providerCustomerId,
          planKey: input.planKey,
          interval: input.interval,
          status: input.status,
          currentPeriodEnd: toDate(input.currentPeriodEnd, "currentPeriodEnd"),
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
          orgId: input.orgId ?? null,
          seats: input.seats ?? null,
        };
        if (values.orgId !== null && !isUuid(values.orgId)) throw new DataError("invalid", `orgId is not an id: "${values.orgId}"`);
        const [row] = await write("subscription", () =>
          db()
            .insert(subscriptions)
            .values({ provider: input.provider, providerSubscriptionId: input.providerSubscriptionId, ...values })
            .onConflictDoUpdate({
              target: [subscriptions.provider, subscriptions.providerSubscriptionId],
              set: { ...values, updatedAt: now },
            })
            .returning(),
        );
        return toSubscription(row);
      },
      async getSubscription(provider, providerSubscriptionId) {
        const [row] = await db()
          .select()
          .from(subscriptions)
          .where(and(eq(subscriptions.provider, provider), eq(subscriptions.providerSubscriptionId, providerSubscriptionId)))
          .limit(1);
        return row ? toSubscription(row) : null;
      },
      async listSubscriptions({ userId, orgId, status, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        if (userId !== undefined && !isUuid(userId)) return { items: [], nextCursor: null };
        const rows = await db()
          .select()
          .from(subscriptions)
          .where(
            and(
              userId ? eq(subscriptions.userId, userId) : undefined,
              orgId === null ? isNull(subscriptions.orgId) : orgId !== undefined ? (isUuid(orgId) ? eq(subscriptions.orgId, orgId) : sql`false`) : undefined,
              status ? eq(subscriptions.status, status) : undefined,
              afterCursor(subscriptions.updatedAt, subscriptions.id, c),
            ),
          )
          .orderBy(desc(subscriptions.updatedAt), desc(subscriptions.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.updatedAt, toSubscription);
      },
      async recordPurchase(input) {
        const values = {
          userId: input.userId,
          planKey: input.planKey,
          amountCents: input.amountCents,
          currency: input.currency,
          refunded: input.refunded,
        };
        const [row] = await write("purchase", () =>
          db()
            .insert(purchases)
            .values({ provider: input.provider, providerOrderId: input.providerOrderId, ...values })
            .onConflictDoUpdate({ target: [purchases.provider, purchases.providerOrderId], set: values })
            .returning(),
        );
        return toPurchase(row);
      },
      async listPurchases({ userId, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        if (userId !== undefined && !isUuid(userId)) return { items: [], nextCursor: null };
        const rows = await db()
          .select()
          .from(purchases)
          .where(and(userId ? eq(purchases.userId, userId) : undefined, afterCursor(purchases.createdAt, purchases.id, c)))
          .orderBy(desc(purchases.createdAt), desc(purchases.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.createdAt, toPurchase);
      },
      async getCustomerId(userId, provider) {
        if (!isUuid(userId)) return null;
        const [row] = await db()
          .select({ customerId: billingCustomers.customerId })
          .from(billingCustomers)
          .where(and(eq(billingCustomers.userId, userId), eq(billingCustomers.provider, provider)))
          .limit(1);
        return row?.customerId ?? null;
      },
      async setCustomerId(userId, provider, customerId) {
        if (!isUuid(userId)) throw new DataError("invalid", `No user ${userId}`);
        await write("billing customer", () =>
          db()
            .insert(billingCustomers)
            .values({ userId, provider, customerId })
            .onConflictDoUpdate({ target: [billingCustomers.userId, billingCustomers.provider], set: { customerId, updatedAt: now } }),
        );
      },
      async findUserIdByCustomerId(provider: PaidProvider, customerId) {
        const [row] = await db()
          .select({ userId: billingCustomers.userId })
          .from(billingCustomers)
          .where(and(eq(billingCustomers.provider, provider), eq(billingCustomers.customerId, customerId)))
          .orderBy(desc(billingCustomers.updatedAt))
          .limit(1);
        return row?.userId ?? null;
      },
      async claimWebhookEvent(provider, eventId) {
        // Atomic: of any number of concurrent deliveries, exactly one INSERT returns a row.
        const rows = await db()
          .insert(webhookEvents)
          .values({ provider, eventId })
          .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
          .returning({ eventId: webhookEvents.eventId });
        return rows.length > 0;
      },
    },

    // ------------------------------------------------------------ feedback
    feedback: {
      async create(input) {
        const userId = input.userId ?? null;
        if (userId !== null && !isUuid(userId)) throw new DataError("invalid", `No user ${userId}`);
        const [row] = await write("feedback", () =>
          db()
            .insert(feedback)
            .values({
              userId,
              email: input.email ?? null,
              name: input.name ?? null,
              kind: input.kind,
              title: input.title ?? null,
              message: input.message,
            })
            .returning(),
        );
        return toFeedback(row);
      },
      async getById(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().select().from(feedback).where(eq(feedback.id, id)).limit(1);
        return row ? toFeedback(row) : null;
      },
      async list({ status, kind, userId, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        if (userId !== undefined && !isUuid(userId)) return { items: [], nextCursor: null };
        const rows = await db()
          .select()
          .from(feedback)
          .where(
            and(
              status ? eq(feedback.status, status) : undefined,
              kind ? eq(feedback.kind, kind) : undefined,
              userId ? eq(feedback.userId, userId) : undefined,
              afterCursor(feedback.createdAt, feedback.id, c),
            ),
          )
          .orderBy(desc(feedback.createdAt), desc(feedback.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.createdAt, toFeedback);
      },
      async update(id, patch) {
        if (!isUuid(id)) throw new DataError("not_found", `No feedback ${id}`);
        const set: Settable<typeof feedback.$inferInsert> = { updatedAt: now };
        if (patch.status !== undefined) set.status = patch.status;
        if (patch.adminNote !== undefined) set.adminNote = patch.adminNote;
        const [row] = await write("feedback", () => db().update(feedback).set(set).where(eq(feedback.id, id)).returning());
        if (!row) throw new DataError("not_found", `No feedback ${id}`);
        return toFeedback(row);
      },
    },

    // ------------------------------------------------------------ subscribers
    subscribers: {
      async add(email, source) {
        const e = email.trim().toLowerCase();
        // One statement: insert, or return the existing row UNCHANGED. Adding is
        // public (the newsletter form), so it must never undo an unsubscribe:
        // the opt-out stands until the person confirms again through a flow the
        // app trusts. The no-op update (status = itself) is only there so
        // RETURNING yields the existing row. xmax = 0 ⇔ the row was inserted.
        const [row] = await write("subscriber", () =>
          db()
            .insert(subscribers)
            .values({ email: e, source })
            .onConflictDoUpdate({ target: subscribers.email, set: { status: sql`${subscribers.status}` } })
            .returning({ ...getTableColumns(subscribers), inserted: sql<boolean>`(xmax = 0)` }),
        );
        const { inserted, ...rest } = row;
        return { subscriber: toSubscriber(rest), created: Boolean(inserted) };
      },
      async list({ status, search, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        const q = search?.trim();
        const rows = await db()
          .select()
          .from(subscribers)
          .where(
            and(
              status ? eq(subscribers.status, status) : undefined,
              q ? ilike(subscribers.email, containsPattern(q)) : undefined,
              afterCursor(subscribers.createdAt, subscribers.id, c),
            ),
          )
          .orderBy(desc(subscribers.createdAt), desc(subscribers.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.createdAt, toSubscriber);
      },
      async unsubscribe(email) {
        const [row] = await db()
          .update(subscribers)
          .set({ status: "unsubscribed" })
          .where(eq(subscribers.email, email.trim().toLowerCase()))
          .returning();
        return row ? toSubscriber(row) : null;
      },
    },

    // ------------------------------------------------------------ agent keys
    agentKeys: {
      async create({ name, scope, keyHash, hint, createdBy = null }) {
        // A creator that is not a uuid can't be a users.id; one that is but has no row fails the FK (→ "invalid").
        if (createdBy !== null && !isUuid(createdBy)) throw new DataError("invalid", `No user ${createdBy}`);
        const [row] = await write("agent key", () => db().insert(agentKeys).values({ name, scope, keyHash, hint, createdBy }).returning());
        return toAgentKey(row);
      },
      async findActiveByHash(keyHash) {
        const [row] = await db()
          .select()
          .from(agentKeys)
          .where(and(eq(agentKeys.keyHash, keyHash), isNull(agentKeys.revokedAt)))
          .limit(1);
        return row ? toAgentKey(row) : null;
      },
      async list() {
        const rows = await db().select().from(agentKeys).orderBy(desc(agentKeys.createdAt), desc(agentKeys.id));
        return rows.map(toAgentKey);
      },
      async revoke(id) {
        if (!isUuid(id)) return null;
        // Revoking twice keeps the first revocation time.
        const [row] = await db()
          .update(agentKeys)
          .set({ revokedAt: sql`coalesce(${agentKeys.revokedAt}, now())` })
          .where(eq(agentKeys.id, id))
          .returning();
        return row ? toAgentKey(row) : null;
      },
      async touch(id) {
        if (!isUuid(id)) return;
        await db().update(agentKeys).set({ lastUsedAt: now }).where(eq(agentKeys.id, id));
      },
    },

    // ------------------------------------------------------------ audit
    audit: {
      async record(entry) {
        const [row] = await write("audit entry", () =>
          db()
            .insert(auditLog)
            .values({
              actorType: entry.actor.type,
              actorId: entry.actor.id,
              actorLabel: entry.actor.label,
              action: entry.action,
              entity: entry.entity,
              entityId: entry.entityId,
              before: entry.before ?? null,
              after: entry.after ?? null,
            })
            .returning(),
        );
        return toAudit(row);
      },
      async getById(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().select().from(auditLog).where(eq(auditLog.id, id)).limit(1);
        return row ? toAudit(row) : null;
      },
      async list({ entity, entityId, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        const rows = await db()
          .select()
          .from(auditLog)
          .where(
            and(
              entity ? eq(auditLog.entity, entity) : undefined,
              entityId ? eq(auditLog.entityId, entityId) : undefined,
              afterCursor(auditLog.createdAt, auditLog.id, c),
            ),
          )
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.createdAt, toAudit);
      },
    },

    // ------------------------------------------------------------ organisations
    orgs: {
      async create({ name, slug, ownerId }) {
        if (!isUuid(ownerId)) throw new DataError("invalid", `No user ${ownerId}`);
        return write("organisation", () =>
          db().transaction(async (tx) => {
            const [org] = await tx.insert(orgs).values({ name, slug, createdBy: ownerId }).returning();
            await tx.insert(orgMembers).values({ orgId: org.id, userId: ownerId, role: "owner" });
            return toOrg(org);
          }),
        );
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().select().from(orgs).where(eq(orgs.id, id)).limit(1);
        return row ? toOrg(row) : null;
      },
      async getBySlug(slug) {
        const [row] = await db().select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
        return row ? toOrg(row) : null;
      },
      async update(id, patch) {
        if (!isUuid(id)) throw new DataError("not_found", `No organisation ${id}`);
        const set: Settable<OrgRow> = { updatedAt: now };
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.slug !== undefined) set.slug = patch.slug;
        const [row] = await write("organisation", () => db().update(orgs).set(set).where(eq(orgs.id, id)).returning());
        if (!row) throw new DataError("not_found", `No organisation ${id}`);
        return toOrg(row);
      },
      async delete(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().delete(orgs).where(eq(orgs.id, id)).returning();
        return row ? toOrg(row) : null;
      },
      async list({ search, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        const q = search?.trim();
        const rows = await db()
          .select({ ...getTableColumns(orgs), members: sql<number>`(select count(*) from ${orgMembers} where ${orgMembers.orgId} = ${orgs.id})::int` })
          .from(orgs)
          .where(
            and(
              q ? or(ilike(orgs.name, containsPattern(q)), ilike(orgs.slug, containsPattern(q))) : undefined,
              afterCursor(orgs.createdAt, orgs.id, c),
            ),
          )
          .orderBy(desc(orgs.createdAt), desc(orgs.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.createdAt, ({ members, ...r }) => ({ ...toOrg(r), members: Number(members) }));
      },
      async listForUser(userId) {
        if (!isUuid(userId)) return [];
        const rows = await db()
          .select({ org: orgs, role: orgMembers.role })
          .from(orgMembers)
          .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
          .where(eq(orgMembers.userId, userId))
          .orderBy(asc(orgMembers.createdAt), asc(orgs.id));
        return rows.map((r) => ({ org: toOrg(r.org), role: r.role }));
      },
      async getMember(orgId, userId) {
        if (!isUuid(orgId) || !isUuid(userId)) return null;
        const [row] = await db()
          .select(memberColumns)
          .from(orgMembers)
          .innerJoin(users, eq(users.id, orgMembers.userId))
          .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
          .limit(1);
        return row ? toMember(row) : null;
      },
      async listMembers(orgId) {
        if (!isUuid(orgId)) return [];
        const rows = await db()
          .select(memberColumns)
          .from(orgMembers)
          .innerJoin(users, eq(users.id, orgMembers.userId))
          .where(eq(orgMembers.orgId, orgId))
          .orderBy(ROLE_ORDER, asc(orgMembers.createdAt), asc(orgMembers.userId));
        return rows.map(toMember);
      },
      async countMembers(orgId) {
        if (!isUuid(orgId)) return 0;
        const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(orgMembers).where(eq(orgMembers.orgId, orgId));
        return Number(row?.n ?? 0);
      },
      async addMember(orgId, userId, role) {
        if (!isUuid(orgId) || !isUuid(userId)) throw new DataError("invalid", "No such organisation or user");
        await write("membership", () => db().insert(orgMembers).values({ orgId, userId, role }));
        return (await store.orgs.getMember(orgId, userId))!;
      },
      async setMemberRole(orgId, userId, role) {
        if (!isUuid(orgId) || !isUuid(userId)) throw new DataError("not_found", "No such membership");
        const rows = await db()
          .update(orgMembers)
          .set({ role })
          .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
          .returning({ userId: orgMembers.userId });
        if (rows.length === 0) throw new DataError("not_found", "No such membership");
        return (await store.orgs.getMember(orgId, userId))!;
      },
      async removeMember(orgId, userId) {
        if (!isUuid(orgId) || !isUuid(userId)) return false;
        const rows = await db()
          .delete(orgMembers)
          .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
          .returning({ userId: orgMembers.userId });
        return rows.length > 0;
      },
      async createInvitation({ orgId, email, role, tokenHash, invitedBy, expiresAt }) {
        if (!isUuid(orgId)) throw new DataError("invalid", `No organisation ${orgId}`);
        if (invitedBy !== null && !isUuid(invitedBy)) throw new DataError("invalid", `No user ${invitedBy}`);
        const [row] = await write("invitation", () =>
          db()
            .insert(orgInvitations)
            .values({ orgId, email: email.trim().toLowerCase(), role, tokenHash, invitedBy, expiresAt: toDate(expiresAt, "expiresAt")! })
            .returning(),
        );
        return toInvitation(row);
      },
      async getInvitation(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().select().from(orgInvitations).where(eq(orgInvitations.id, id)).limit(1);
        return row ? toInvitation(row) : null;
      },
      async findInvitationByTokenHash(tokenHash) {
        const [row] = await db().select().from(orgInvitations).where(eq(orgInvitations.tokenHash, tokenHash)).limit(1);
        return row ? toInvitation(row) : null;
      },
      async listInvitations(orgId, opts = {}) {
        if (!isUuid(orgId)) return [];
        const rows = await db()
          .select()
          .from(orgInvitations)
          .where(and(eq(orgInvitations.orgId, orgId), opts.all ? undefined : pendingInvitation))
          .orderBy(desc(orgInvitations.createdAt), desc(orgInvitations.id));
        return rows.map(toInvitation);
      },
      async revokeInvitation(id) {
        if (!isUuid(id)) return null;
        const [row] = await db()
          .update(orgInvitations)
          .set({ revokedAt: now })
          .where(and(eq(orgInvitations.id, id), isNull(orgInvitations.acceptedAt), isNull(orgInvitations.revokedAt)))
          .returning();
        return row ? toInvitation(row) : null;
      },
      async acceptInvitation(id, userId) {
        if (!isUuid(id) || !isUuid(userId)) return null;
        return write("membership", () =>
          db().transaction(async (tx) => {
            const [inv] = await tx
              .update(orgInvitations)
              .set({ acceptedAt: now })
              .where(and(eq(orgInvitations.id, id), pendingInvitation))
              .returning();
            if (!inv) return null;
            await tx.insert(orgMembers).values({ orgId: inv.orgId, userId, role: inv.role });
            const [m] = await tx
              .select(memberColumns)
              .from(orgMembers)
              .innerJoin(users, eq(users.id, orgMembers.userId))
              .where(and(eq(orgMembers.orgId, inv.orgId), eq(orgMembers.userId, userId)))
              .limit(1);
            return { invitation: toInvitation(inv), member: toMember(m) };
          }),
        );
      },
    },

    // ------------------------------------------------------------ jobs
    jobs: {
      async enqueue({ kind, payload, runAt, maxAttempts = 5, key = null, sensitive = false }) {
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new DataError("invalid", "maxAttempts must be a whole number of at least 1");
        const values = {
          kind,
          payload: jsonValue(payload),
          maxAttempts,
          key,
          sensitive,
          ...(runAt ? { runAt: toDate(runAt, "runAt")! } : {}),
        };
        if (key === null) {
          const [row] = await write("job", () => db().insert(jobs).values(values).returning());
          return { job: toJob(row), created: true };
        }
        // The unique index covers unfinished jobs only, so ON CONFLICT can't name it: insert, and on
        // a conflict read the job that holds the key. A finish racing in between frees the key; retry once.
        for (let attempt = 0; attempt < 2; attempt++) {
          const [row] = await db()
            .insert(jobs)
            .values(values)
            .onConflictDoNothing({ target: jobs.key, where: sql`key is not null and status in ('queued', 'running')` })
            .returning();
          if (row) return { job: toJob(row), created: true };
          const [existing] = await db()
            .select()
            .from(jobs)
            .where(and(eq(jobs.key, key), inArray(jobs.status, ["queued", "running"])))
            .limit(1);
          if (existing) return { job: toJob(existing), created: false };
        }
        throw new DataError("conflict", `job: key "${key}" is busy`);
      },
      async claim({ limit, leaseMs }) {
        const n = Math.max(1, Math.min(Math.floor(limit), MAX_CLAIM));
        // SKIP LOCKED: concurrent claimers each take different rows instead of waiting on each other.
        const due = db()
          .select({ id: jobs.id })
          .from(jobs)
          .where(dueJob)
          .orderBy(asc(jobs.runAt), asc(jobs.id))
          .limit(n)
          .for("update", { skipLocked: true });
        const rows = await db()
          .update(jobs)
          .set({
            status: "running",
            attempts: sql`${jobs.attempts} + 1`,
            lockedUntil: sql`now() + make_interval(secs => ${Math.max(1, leaseMs) / 1000})`,
            updatedAt: now,
          })
          .where(inArray(jobs.id, due))
          .returning();
        return rows.map(toJob).sort((a, b) => (a.runAt < b.runAt ? -1 : a.runAt > b.runAt ? 1 : a.id < b.id ? -1 : 1));
      },
      async failAbandoned() {
        const rows = await db()
          .update(jobs)
          .set({ status: "failed", lockedUntil: null, lastError: ABANDONED_ERROR, finishedAt: now, updatedAt: now, payload: endedPayload })
          .where(and(eq(jobs.status, "running"), sql`${jobs.lockedUntil} < now()`, sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
          .returning();
        return rows.map(toJob);
      },
      async complete(id, attempt) {
        if (!isUuid(id)) return false;
        const rows = await db()
          .update(jobs)
          .set({ status: "succeeded", lockedUntil: null, finishedAt: now, updatedAt: now, payload: endedPayload })
          .where(and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.attempts, attempt)))
          .returning({ id: jobs.id });
        return rows.length > 0;
      },
      async fail(id, attempt, { error, retryAt }) {
        if (!isUuid(id)) return null;
        const retry = retryAt ? toDate(retryAt, "retryAt")! : null;
        const again = retry ? sql`${jobs.attempts} < ${jobs.maxAttempts}` : sql`false`;
        const terminal = sql`not (${again})`;
        const set: Settable<JobRow> = {
          status: sql`case when ${again} then 'queued' else 'failed' end`,
          lockedUntil: null,
          lastError: error.slice(0, MAX_JOB_ERROR),
          finishedAt: sql`case when ${terminal} then now() else null end`,
          updatedAt: now,
        };
        if (retry) set.runAt = sql`case when ${again} then ${retry}::timestamptz else ${jobs.runAt} end`;
        // A sensitive job keeps its payload while it may still run, and loses it once it can't.
        set.payload = sql`case when ${terminal} then ${endedPayload} else ${jobs.payload} end`;
        const [row] = await db()
          .update(jobs)
          .set(set)
          .where(and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.attempts, attempt)))
          .returning();
        return row ? toJob(row) : null;
      },
      async retry(id) {
        if (!isUuid(id)) return null;
        const [row] = await db()
          .update(jobs)
          .set({ status: "queued", attempts: 0, runAt: now, lockedUntil: null, finishedAt: null, updatedAt: now })
          // A sensitive job's payload is gone once it fails: there is nothing left to run.
          .where(and(eq(jobs.id, id), eq(jobs.status, "failed"), eq(jobs.sensitive, false)))
          .returning();
        return row ? toJob(row) : null;
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const [row] = await db().select().from(jobs).where(eq(jobs.id, id)).limit(1);
        return row ? toJob(row) : null;
      },
      async list({ status, limit, cursor }) {
        const size = clampLimit(limit);
        const c = decodeCursor(cursor);
        const rows = await db()
          .select()
          .from(jobs)
          .where(and(status ? eq(jobs.status, status) : undefined, afterCursor(jobs.createdAt, jobs.id, c)))
          .orderBy(desc(jobs.createdAt), desc(jobs.id))
          .limit(size + 1);
        return toPage(rows, size, (r) => r.createdAt, toJob);
      },
      async counts() {
        const result = await db().execute<{ status: JobStatus; n: number | string }>(sql`select status, count(*) as n from jobs group by status`);
        const counts: JobCounts = { queued: 0, running: 0, succeeded: 0, failed: 0, oldestDueAt: null };
        for (const r of result.rows) counts[r.status] = Number(r.n);
        const [oldest] = await db()
          .select({ runAt: jobs.runAt })
          .from(jobs)
          .where(and(eq(jobs.status, "queued"), sql`${jobs.runAt} <= now()`))
          .orderBy(asc(jobs.runAt))
          .limit(1);
        counts.oldestDueAt = oldest ? iso(oldest.runAt) : null;
        return counts;
      },
      async prune(finishedBefore) {
        const before = toDate(finishedBefore, "finishedBefore")!;
        const rows = await db()
          .delete(jobs)
          .where(and(inArray(jobs.status, ["succeeded", "failed"]), sql`${jobs.finishedAt} < ${before}`))
          .returning({ id: jobs.id });
        return rows.length;
      },
    },

    async stats(): Promise<Stats> {
      const entitled = sql.join(
        ENTITLED_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      );
      const open = sql.join(
        OPEN_FEEDBACK.map((s) => sql`${s}`),
        sql`, `,
      );
      // A subscription counts only while it still grants access, by the same
      // rule as computeEntitlement (src/server/services/billing.ts): its
      // period hasn't ended, or for past_due, ended under PAST_DUE_GRACE_DAYS ago.
      const live = sql`(${subscriptions.currentPeriodEnd} is null or ${subscriptions.currentPeriodEnd} + case when ${subscriptions.status} = 'past_due' then make_interval(days => ${PAST_DUE_GRACE_DAYS}::int) else interval '0' end > now())`;
      // One round-trip; each count uses its own table's index.
      const result = await db().execute<Record<keyof Stats, number>>(sql`
        select
          (select count(*)::int from ${users}) as "users",
          (select count(*)::int from ${users} where ${users.role} = 'admin') as "admins",
          (select count(*)::int from ${subscribers} where ${subscribers.status} = 'subscribed') as "subscribers",
          (select count(*)::int from ${subscriptions} where ${subscriptions.status} in (${entitled}) and ${live}) as "activeSubscriptions",
          (select count(*)::int from ${purchases} where not ${purchases.refunded}) as "purchases",
          (select count(*)::int from ${posts} where ${posts.status} = 'published') as "publishedPosts",
          (select count(*)::int from ${posts} where ${posts.status} = 'draft') as "draftPosts",
          (select count(*)::int from ${feedback} where ${feedback.status} in (${open})) as "openFeedback"`);
      const r = result.rows[0];
      return {
        users: Number(r.users),
        admins: Number(r.admins),
        subscribers: Number(r.subscribers),
        activeSubscriptions: Number(r.activeSubscriptions),
        purchases: Number(r.purchases),
        publishedPosts: Number(r.publishedPosts),
        draftPosts: Number(r.draftPosts),
        openFeedback: Number(r.openFeedback),
      };
    },

    async growth(span, now = new Date()): Promise<Growth> {
      const days = growthDays(clampGrowthDays(span), now);
      const from = new Date(`${days[0]}T00:00:00Z`);
      // One round-trip: both tables bucketed by UTC day from the first day on (created_at is indexed on both).
      const result = await db().execute<{ kind: "users" | "subscribers"; day: string; n: number }>(sql`
        select 'users' as kind, to_char(${users.createdAt} at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as n
          from ${users} where ${users.createdAt} >= ${from} group by 2
        union all
        select 'subscribers', to_char(${subscribers.createdAt} at time zone 'UTC', 'YYYY-MM-DD'), count(*)::int
          from ${subscribers} where ${subscribers.createdAt} >= ${from} and ${subscribers.status} = 'subscribed' group by 2`);
      const index = new Map(days.map((d, i) => [d, i]));
      const out: Growth = { days, users: days.map(() => 0), subscribers: days.map(() => 0) };
      for (const row of result.rows) {
        const i = index.get(row.day);
        if (i !== undefined) out[row.kind][i] = Number(row.n);
      }
      return out;
    },
  };

  return store;
}
