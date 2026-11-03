//
// The Postgres schema, in Drizzle. Two groups of tables:
//
//   app tables  — one per DataStore repo (users, content, posts, plans, billing,
//                 feedback, subscribers, agent keys, audit). Read and written
//                 only by ./index.ts, which maps rows to the domain types.
//   auth_*      — Better Auth's own tables (user, session, account,
//                 verification, rate limit, and the two-factor plugin's
//                 table). Drizzle property names are Better Auth's camelCase
//                 field names (its drizzle adapter addresses columns by
//                 property); the SQL columns are snake_case.
//
// Rules:
//  - This file is loaded by drizzle-kit, outside Next: no "server-only", no
//    "@/..." runtime imports (type-only imports are erased and are fine).
//  - App timestamps are timestamptz(3): millisecond precision, the same as a
//    JS Date, so a keyset cursor built from a row compares exactly equal to it.
//  - Change a table → `npm run db:generate -- --name <what>` → commit the SQL.
//

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ActorType,
  AgentScope,
  AuthProviderId,
  FeedbackKind,
  FeedbackStatus,
  JobStatus,
  PlanPrice,
  PostKind,
  PostStatus,
  PriceInterval,
  Role,
  SubscriberStatus,
  SubscriptionStatus,
} from "@/core/types";
import type { OrgRole } from "@/core/orgs";

type PaidProvider = "polar" | "stripe" | "razorpay";

/** timestamptz with millisecond precision (see the header). */
const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();

// ---------------------------------------------------------------- users

export const users = pgTable(
  "users",
  {
    id: id(),
    /** Always stored lower-case; the adapter lower-cases on every write and lookup. */
    email: text("email").notNull(),
    name: text("name"),
    image: text("image"),
    role: text("role").$type<Role>().notNull().default("user"),
    banned: boolean("banned").notNull().default(false),
    authProvider: text("auth_provider").$type<AuthProviderId>().notNull(),
    authProviderUserId: text("auth_provider_user_id").notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [
    unique("users_email_key").on(t.email),
    unique("users_auth_identity_key").on(t.authProvider, t.authProviderUserId),
    index("users_created_idx").on(t.createdAt, t.id),
    index("users_role_created_idx").on(t.role, t.createdAt, t.id),
    check("users_role_check", sql`${t.role} in ('user', 'admin')`),
  ],
);

// ---------------------------------------------------------------- content

export const content = pgTable("content", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- posts

export const posts = pgTable(
  "posts",
  {
    id: id(),
    kind: text("kind").$type<PostKind>().notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    body: text("body").notNull().default(""),
    coverImage: text("cover_image"),
    /** The cover's alt text; null or empty = decorative. */
    coverAlt: text("cover_alt"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").$type<PostStatus>().notNull().default("draft"),
    /** On the indexes (/blog, tags, landing). False = published but unlisted: still live and in the sitemap. */
    listed: boolean("listed").notNull().default(true),
    authorName: text("author_name"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("posts_kind_slug_key").on(t.kind, t.slug),
    // Published lists sort by published_at; every other list by updated_at.
    index("posts_kind_status_published_idx").on(t.kind, t.status, t.publishedAt, t.id),
    index("posts_kind_updated_idx").on(t.kind, t.updatedAt, t.id),
    index("posts_updated_idx").on(t.updatedAt, t.id),
    index("posts_tags_idx").using("gin", t.tags),
    check("posts_kind_check", sql`${t.kind} in ('post', 'changelog', 'page')`),
    check("posts_status_check", sql`${t.status} in ('draft', 'published')`),
    // The adapter stamps published_at on publish; this keeps the published sort key non-null.
    check("posts_published_at_check", sql`${t.status} <> 'published' or ${t.publishedAt} is not null`),
  ],
);

// ---------------------------------------------------------------- plans

export const plans = pgTable(
  "plans",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    features: jsonb("features").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    prices: jsonb("prices").$type<PlanPrice[]>().notNull().default(sql`'[]'::jsonb`),
    highlighted: boolean("highlighted").notNull().default(false),
    contactSales: boolean("contact_sales").notNull().default(false),
    ctaLabel: text("cta_label").notNull().default(""),
    trialDays: integer("trial_days"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    limits: jsonb("limits").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    updatedAt: updatedAt(),
  },
  (t) => [unique("plans_key_key").on(t.key), index("plans_sort_idx").on(t.sortOrder, t.key)],
);

// ---------------------------------------------------------------- billing

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<PaidProvider>().notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    providerCustomerId: text("provider_customer_id"),
    planKey: text("plan_key"),
    interval: text("interval").$type<PriceInterval>(),
    status: text("status").$type<SubscriptionStatus>().notNull(),
    currentPeriodEnd: ts("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /**
     * The organisation it pays for, or null for a personal plan. Deliberately NOT a foreign key:
     * deleting an organisation must not turn its subscription into the buyer's personal plan (a
     * null here), so the id stays, pointing nowhere, and grants nothing.
     */
    orgId: uuid("org_id"),
    seats: integer("seats"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("subscriptions_provider_ref_key").on(t.provider, t.providerSubscriptionId),
    index("subscriptions_org_idx").on(t.orgId).where(sql`org_id is not null`),
    index("subscriptions_user_updated_idx").on(t.userId, t.updatedAt, t.id),
    index("subscriptions_status_updated_idx").on(t.status, t.updatedAt, t.id),
    index("subscriptions_updated_idx").on(t.updatedAt, t.id),
  ],
);

export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<PaidProvider>().notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    planKey: text("plan_key"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    refunded: boolean("refunded").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("purchases_provider_ref_key").on(t.provider, t.providerOrderId),
    index("purchases_user_created_idx").on(t.userId, t.createdAt, t.id),
    index("purchases_created_idx").on(t.createdAt, t.id),
  ],
);

/** One provider customer per (user, provider), so checkouts and portals reuse it. */
export const billingCustomers = pgTable(
  "billing_customers",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<PaidProvider>().notNull(),
    customerId: text("customer_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: "billing_customers_pkey", columns: [t.userId, t.provider] }), index("billing_customers_lookup_idx").on(t.provider, t.customerId)],
);

/** Webhook idempotency: a row per delivered event id; the insert is the claim. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    provider: text("provider").$type<PaidProvider>().notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "webhook_events_pkey", columns: [t.provider, t.eventId] })],
);

// ---------------------------------------------------------------- feedback & contact

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    // SET NULL: deleting a user keeps their feedback, anonymised.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email"),
    name: text("name"),
    kind: text("kind").$type<FeedbackKind>().notNull(),
    title: text("title"),
    message: text("message").notNull(),
    status: text("status").$type<FeedbackStatus>().notNull().default("new"),
    adminNote: text("admin_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("feedback_created_idx").on(t.createdAt, t.id),
    index("feedback_status_created_idx").on(t.status, t.createdAt, t.id),
    index("feedback_kind_created_idx").on(t.kind, t.createdAt, t.id),
    index("feedback_user_created_idx").on(t.userId, t.createdAt, t.id),
  ],
);

// ---------------------------------------------------------------- email list

export const subscribers = pgTable(
  "subscribers",
  {
    id: id(),
    /** Always stored lower-case. */
    email: text("email").notNull(),
    source: text("source"),
    status: text("status").$type<SubscriberStatus>().notNull().default("subscribed"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("subscribers_email_key").on(t.email),
    index("subscribers_created_idx").on(t.createdAt, t.id),
    index("subscribers_status_created_idx").on(t.status, t.createdAt, t.id),
  ],
);

// ---------------------------------------------------------------- agents (MCP)

export const agentKeys = pgTable(
  "agent_keys",
  {
    id: id(),
    name: text("name").notNull(),
    scope: text("scope").$type<AgentScope>().notNull(),
    /** SHA-256 of the key; the key itself is shown once and never stored. */
    keyHash: text("key_hash").notNull(),
    hint: text("hint").notNull(),
    /**
     * The admin who minted the key. A key must not outlive its creator's admin
     * rights: the user services revoke a person's keys when they are demoted,
     * banned or deleted. SET NULL keeps the (revoked) key's row for the audit
     * trail once its creator is gone. Null too for a key minted outside the
     * app (scripts/mcp-key.mts).
     */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    unique("agent_keys_key_hash_key").on(t.keyHash),
    index("agent_keys_created_idx").on(t.createdAt),
    index("agent_keys_created_by_idx").on(t.createdBy),
  ],
);

// ---------------------------------------------------------------- audit

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt, t.id),
    index("audit_log_entity_created_idx").on(t.entity, t.entityId, t.createdAt, t.id),
  ],
);

// ---------------------------------------------------------------- organisations (OPENSHIPKIT_TENANCY=org)

export const orgs = pgTable(
  "orgs",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // SET NULL: the organisation outlives the account that created it.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("orgs_slug_key").on(t.slug), index("orgs_created_idx").on(t.createdAt, t.id)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<OrgRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "org_members_pkey", columns: [t.orgId, t.userId] }),
    index("org_members_user_idx").on(t.userId),
    check("org_members_role_check", sql`${t.role} in ('owner', 'admin', 'member')`),
  ],
);

export const orgInvitations = pgTable(
  "org_invitations",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<"admin" | "member">().notNull(),
    /** SHA-256 of the link's token; the token itself is only in the email. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    unique("org_invitations_token_hash_key").on(t.tokenHash),
    // One open invitation per address per organisation. Expiry is checked by time, not here: an
    // expired-but-open row still holds the address until it is revoked or replaced (the service does that).
    uniqueIndex("org_invitations_open_key").on(t.orgId, t.email).where(sql`accepted_at is null and revoked_at is null`),
    index("org_invitations_org_idx").on(t.orgId, t.createdAt),
    check("org_invitations_role_check", sql`${t.role} in ('admin', 'member')`),
  ],
);

// ---------------------------------------------------------------- usage

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    // A user's or an organisation's id; not a foreign key, so history outlives either.
    subjectType: text("subject_type").$type<"user" | "org">().notNull(),
    subjectId: uuid("subject_id").notNull(),
    metric: text("metric").notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    key: text("key"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("usage_events_sum_idx").on(t.subjectType, t.subjectId, t.metric, t.occurredAt),
    uniqueIndex("usage_events_key_key").on(t.subjectType, t.subjectId, t.key).where(sql`key is not null`),
    check("usage_events_subject_check", sql`${t.subjectType} in ('user', 'org')`),
    check("usage_events_quantity_check", sql`${t.quantity} >= 0`),
  ],
);

// ---------------------------------------------------------------- background jobs

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    payload: jsonb("payload"),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    key: text("key"),
    /** The payload holds something that mustn't outlive the job (a live sign-in link): deleted when the job ends. */
    sensitive: boolean("sensitive").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    // What claim() scans: due work, oldest first. Partial, so finished rows don't bloat it.
    index("jobs_due_idx").on(t.runAt, t.id).where(sql`status in ('queued', 'running')`),
    // One unfinished job per key (enqueue's dedupe); finished jobs free the key.
    uniqueIndex("jobs_key_unfinished_key").on(t.key).where(sql`key is not null and status in ('queued', 'running')`),
    index("jobs_created_idx").on(t.createdAt, t.id),
    index("jobs_finished_idx").on(t.finishedAt).where(sql`finished_at is not null`),
    check("jobs_status_check", sql`status in ('queued', 'running', 'succeeded', 'failed')`),
    check("jobs_attempts_check", sql`attempts >= 0 and max_attempts >= 1`),
  ],
);

// ---------------------------------------------------------------- Better Auth (auth_*)
//
// Better Auth 1.7.7's core schema (getAuthTables in @better-auth/core). Ids are
// text: Better Auth generates them. Adding a Better Auth plugin that brings its
// own tables or fields means adding them here and generating a migration.

const authTs = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique("auth_user_email_key"),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Two-factor plugin: set once the user has verified a TOTP app. */
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: authTs("created_at").notNull().defaultNow(),
  updatedAt: authTs("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: authTs("expires_at").notNull(),
    token: text("token").notNull().unique("auth_session_token_key"),
    createdAt: authTs("created_at").notNull().defaultNow(),
    updatedAt: authTs("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_session_user_id_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: authTs("access_token_expires_at"),
    refreshTokenExpiresAt: authTs("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: authTs("created_at").notNull().defaultNow(),
    updatedAt: authTs("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("auth_account_user_id_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: authTs("expires_at").notNull(),
    createdAt: authTs("created_at").notNull().defaultNow(),
    updatedAt: authTs("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

/** Used when Better Auth is configured with `rateLimit: { storage: "database" }`. */
export const authRateLimit = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique("auth_rate_limit_key_key"),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** The two-factor plugin's table: one TOTP secret and the hashed backup codes per user. */
export const authTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: authTs("locked_until"),
  },
  (t) => [index("auth_two_factor_secret_idx").on(t.secret), index("auth_two_factor_user_id_idx").on(t.userId)],
);

/**
 * Better Auth's tables keyed by its model names, for
 * `drizzleAdapter(getDrizzle(), { provider: "pg", schema: authTables })`.
 */
export const authTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  rateLimit: authRateLimit,
  twoFactor: authTwoFactor,
};
