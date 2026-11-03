//
// The domain, once. Every adapter (data, billing, email), every page and every
// MCP tool speaks these types — never a library's own shapes. A Better Auth
// session becomes an `Identity`, then the app's own `User`; a Postgres row
// becomes a `Post`.
//
// Rules: ids are opaque strings (uuid in Postgres); every
// timestamp is an ISO-8601 string; money is integer minor units (cents).
//

/** Better Auth is the only auth. Kept as a type so stored rows say where an identity came from. */
export type AuthProviderId = "better-auth";
/** postgres (your server, or embedded PGlite in development) | memory (unit tests only). */
export type DataProviderId = "postgres" | "memory";
/** Polar (merchant of record), Stripe, Razorpay (India), or none: billing is optional and off by default. One at a time. */
export type BillingProviderId = "polar" | "stripe" | "razorpay" | "none";
/** Resend, your own SMTP server or relay, or console (prints to the server log) in development. */
export type EmailProviderId = "resend" | "smtp" | "console";

/** A page of results. `nextCursor` is opaque; pass it back to get the next page. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListQuery {
  limit?: number;
  cursor?: string | null;
}

// ---------------------------------------------------------------- users

export type Role = "user" | "admin";

/** Who the auth provider says is signed in. Adapters produce this; nothing else does. */
export interface Identity {
  provider: AuthProviderId;
  providerUserId: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
}

/** The app's own user row, keyed by (authProvider, authProviderUserId). Roles live here, not at the provider. */
export interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  banned: boolean;
  authProvider: AuthProviderId;
  authProviderUserId: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export type UserPatch = Partial<Pick<User, "name" | "role" | "banned">>;

// ---------------------------------------------------------------- content

/**
 * One editable piece of the site — site settings, navigation, the hero, the
 * FAQ … — stored as JSON under a key from CONTENT_KEYS (src/core/content.ts),
 * validated by that key's schema on every read and write.
 */
export interface ContentEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

// ---------------------------------------------------------------- posts

/** One table for every long-form document: blog posts, changelog entries and static pages (privacy, terms, about). */
export type PostKind = "post" | "changelog" | "page";
export type PostStatus = "draft" | "published";

export interface Post {
  id: string;
  kind: PostKind;
  slug: string;
  title: string;
  description: string;
  /** Markdown (GFM). Rendered and sanitised on the server. */
  body: string;
  coverImage: string | null;
  /**
   * What the cover shows, for its alt text and og:image:alt. Null or empty
   * means the cover is decorative (alt=""). Meaningless without a cover.
   */
  coverAlt: string | null;
  tags: string[];
  status: PostStatus;
  /**
   * Shown on the indexes: /blog, tag pages, the changelog list, "Keep
   * reading", the landing page and llms.txt. A different question from
   * `status`: an unlisted PUBLISHED post still answers 200 at its URL and stays
   * in the sitemap, the RSS feed and llms-full.txt — it is only no longer
   * promoted. Use it when a post outlives its reason to be advertised (the
   * feature it announced is gone, a newer guide supersedes it): unpublishing
   * would throw away its rankings and inbound links; leaving it listed keeps
   * advertising something stale. Default true.
   */
  listed: boolean;
  authorName: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostInput {
  kind: PostKind;
  slug: string;
  title: string;
  description?: string;
  body?: string;
  coverImage?: string | null;
  coverAlt?: string | null;
  tags?: string[];
  status?: PostStatus;
  /** Defaults to true (see Post.listed). */
  listed?: boolean;
  authorName?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** Defaults to now when a post is first published. */
  publishedAt?: string | null;
  /**
   * Seed and audit restore only: keep the original id and timestamps, so a
   * restored post keeps its audit history and a seeded post reports the date it
   * was written, not the install date. Omitted → a new id and now.
   */
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** A partial update. Ids and timestamps are the store's, never patched. */
export type PostPatch = Partial<Omit<PostInput, "kind" | "id" | "createdAt" | "updatedAt">>;

export interface PostQuery extends ListQuery {
  kind?: PostKind;
  status?: PostStatus;
  /**
   * true → listed posts only; false → unlisted only; omitted → both. Only the
   * index readers set it (listListed in src/server/services/posts.ts): the
   * sitemap, feeds and llms-full.txt must keep unlisted posts.
   */
  listed?: boolean;
  tag?: string;
  search?: string;
}

// ---------------------------------------------------------------- plans

export type PriceInterval = "month" | "year" | "one_time";

export interface PlanPrice {
  interval: PriceInterval;
  amountCents: number;
  /** ISO 4217, lower case: "usd". */
  currency: string;
  /** The Polar product this price checks out (BILLING_PROVIDER=polar). Empty until set in /admin/plans. */
  polarProductId: string | null;
  /** The Stripe price it checks out (BILLING_PROVIDER=stripe): price_…. */
  stripePriceId?: string | null;
  /** The Razorpay plan a recurring price subscribes to (BILLING_PROVIDER=razorpay): plan_…. One-time prices need none. */
  razorpayPlanId?: string | null;
  /**
   * Charged per seat (OPENSHIPKIT_TENANCY=org): an organisation's checkout buys one seat per
   * member and pending invitation, and invitations stop at the seat count. The Polar product must
   * use seat-based pricing. Recurring prices only.
   */
  perSeat?: boolean;
}

export interface Plan {
  id: string;
  /** Stable slug used everywhere else ("starter", "pro"). Unique. */
  key: string;
  name: string;
  description: string;
  features: string[];
  /** No prices → a free plan. */
  prices: PlanPrice[];
  highlighted: boolean;
  /** Show "Contact us" instead of a checkout (enterprise). */
  contactSales: boolean;
  ctaLabel: string;
  trialDays: number | null;
  active: boolean;
  sortOrder: number;
  /**
   * What the plan allows, by metric: { projects: 3, api_calls: 10000, seats: 5 }. A metric that isn't
   * listed is unlimited. src/server/services/usage.ts checks them (requireWithinLimit).
   */
  limits: PlanLimits;
  updatedAt: string;
}

/** Metric (lower-case words joined by underscores) → the most allowed. Absent: unlimited. */
export type PlanLimits = Record<string, number>;

export type PlanInput = Omit<Plan, "id" | "updatedAt" | "limits"> & { limits?: PlanLimits };

// ---------------------------------------------------------------- usage

/** Who usage is counted for: a person, or with teams on, their organisation. */
export type UsageSubject = { type: "user" | "org"; id: string };

export interface UsageEvent {
  id: string;
  subject: UsageSubject;
  metric: string;
  quantity: number;
  /** Dedupes: a second event with the same key for the same subject and metric is ignored. */
  key: string | null;
  occurredAt: string;
  /**
   * The outbox for metered prices. Every event reaches one final state: sent (reportedAt), or settled
   * without sending (reportSkipped: no_customer, a free account; expired, past the provider's window).
   * Until then it is pending (reportPending).
   */
  reportPending: boolean;
  /** When the billing provider accepted it. Never set for an event that wasn't sent. */
  reportedAt: string | null;
  /** Settled without sending, and why: nobody to bill, or older than the provider accepts. */
  reportSkipped?: "no_customer" | "expired" | null;
}

// ---------------------------------------------------------------- billing

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid"
  | "paused";

/** Statuses that grant access. past_due only within PAST_DUE_GRACE_DAYS of the period end. */
export const ENTITLED_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due"];

/** How long a failed renewal keeps access while the provider retries the card. */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * Pure: does this subscription still grant access at `now`? An entitled status
 * whose period hasn't ended (or has none), or past_due within
 * PAST_DUE_GRACE_DAYS of the period end — a failed renewal keeps access for a
 * short grace while the card is retried, not forever. computeEntitlement() and
 * every DataStore's stats().activeSubscriptions use this one rule (the Postgres
 * store spells it in SQL).
 */
/** Statuses in which the provider will charge again unless the subscription is set to end. */
export const RENEWING_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "unpaid", "paused"];

/**
 * The one definition of "still being charged": the provider will bill it again. A renewing status
 * and not set to end at the period's close, whatever plan it's on. Every rule about who may leave,
 * delete or buy uses this, so no two of them can disagree.
 */
export function isRenewing(sub: Pick<Subscription, "status" | "cancelAtPeriodEnd">): boolean {
  return RENEWING_STATUSES.includes(sub.status) && !sub.cancelAtPeriodEnd;
}

export function grantsAccess(sub: Pick<Subscription, "status" | "currentPeriodEnd">, now: number = Date.now()): boolean {
  if (!ENTITLED_STATUSES.includes(sub.status)) return false;
  if (!sub.currentPeriodEnd) return true;
  const end = Date.parse(sub.currentPeriodEnd);
  const graceMs = sub.status === "past_due" ? PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000 : 0;
  return end + graceMs > now;
}

export interface Subscription {
  id: string;
  userId: string;
  provider: Exclude<BillingProviderId, "none">;
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  planKey: string | null;
  interval: PriceInterval | null;
  status: SubscriptionStatus;
  /** When the current billing period began, as the provider says; null when it doesn't (rows from before it was stored). */
  currentPeriodStart?: string | null;
  /**
   * For a provider that can't report a pending cancel (Razorpay): the period end it reported when the
   * app asked it to cancel. The recorded cancel holds while the provider still reports that period.
   */
  cancelRequestedFor?: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /**
   * The organisation it pays for (OPENSHIPKIT_TENANCY=org); null for a person's own plan. userId is
   * then the owner who bought it. An organisation's subscription never grants its buyer a personal plan.
   */
  orgId: string | null;
  /** Seats bought, for a per-seat price; null otherwise. */
  seats: number | null;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionUpsert = Omit<Subscription, "id" | "createdAt" | "updatedAt" | "orgId" | "seats"> & {
  orgId?: string | null;
  seats?: number | null;
};

export interface Purchase {
  id: string;
  userId: string;
  provider: Exclude<BillingProviderId, "none">;
  providerOrderId: string;
  planKey: string | null;
  amountCents: number;
  currency: string;
  /** No access any more: a full refund, or a lost chargeback. */
  refunded: boolean;
  /** A chargeback the merchant lost (refunded is true too). Final: a later re-sync can't undo it. */
  chargedBack?: boolean;
  createdAt: string;
}

export type PurchaseInput = Omit<Purchase, "id" | "createdAt">;

/** What a user may use right now — derived from subscriptions and purchases, never stored. */
export interface Entitlement {
  planKey: string | null;
  source: "subscription" | "purchase" | "free";
  status: SubscriptionStatus | "lifetime" | "free";
  /** The subscription's current period, when the provider gave its start (usage periods use it). */
  currentPeriodStart?: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

// ---------------------------------------------------------------- feedback & contact

export type FeedbackKind = "bug" | "feature" | "general" | "contact";
export type FeedbackStatus = "new" | "planned" | "in_progress" | "done" | "closed";

export interface Feedback {
  id: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  kind: FeedbackKind;
  title: string | null;
  message: string;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackInput {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  kind: FeedbackKind;
  title?: string | null;
  message: string;
}

// ---------------------------------------------------------------- email list

export type SubscriberStatus = "subscribed" | "unsubscribed";

export interface Subscriber {
  id: string;
  email: string;
  source: string | null;
  status: SubscriberStatus;
  createdAt: string;
}

// ---------------------------------------------------------------- agents (MCP)

/**
 * What an MCP agent key may do. Scopes are cumulative:
 *  - read  — read everything that is not a secret
 *  - write — read + edit and publish content, posts, plans, feedback
 *  - admin — write + users, roles, subscribers, agent keys
 */
// ---------------------------------------------------------------- background jobs

/**
 * queued → running → succeeded, or back to queued with a later runAt after a
 * failure, until maxAttempts; then failed (kept for inspection and a manual retry).
 */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  /** Which handler runs it ("email.send"): src/server/jobs/registry.ts. */
  kind: string;
  /** The handler's input, as JSON. Null once a sensitive job has ended (succeeded or failed for good). */
  payload: unknown;
  status: JobStatus;
  /** Claims so far, the current one included. */
  attempts: number;
  maxAttempts: number;
  /** When it may next run. */
  runAt: string;
  /** While running: when the claim expires and another worker may take the job over. */
  lockedUntil: string | null;
  lastError: string | null;
  /** Dedupes: one queued or running job per key. Null for none. */
  key: string | null;
  /** The payload is deleted when the job ends, so it can't be retried by hand afterwards. */
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface JobInput {
  kind: string;
  payload: unknown;
  /** Default now. */
  runAt?: string;
  /** Default 5. */
  maxAttempts?: number;
  key?: string | null;
  /** Default false. */
  sensitive?: boolean;
}

export interface JobCounts {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  /** The runAt of the oldest queued job that is already due: how far behind the runner is. */
  oldestDueAt: string | null;
}

export type AgentScope = "read" | "write" | "admin";

export interface AgentKey {
  id: string;
  name: string;
  scope: AgentScope;
  /** Last 6 characters of the key, to recognise it in a list. */
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /**
   * The users.id of the admin who minted it; null for keys minted by the CLI
   * (scripts/mcp-key.mts), minted before creators were recorded, whose
   * creator has since been deleted, and for the MCP_DEV_KEY stand-in
   * (src/server/mcp/auth.ts). Demoting, banning or deleting that admin
   * revokes the key (src/server/services/users.ts).
   */
  createdBy: string | null;
}

// ---------------------------------------------------------------- audit

export type ActorType = "user" | "agent" | "system";

export interface Actor {
  type: ActorType;
  id: string | null;
  /** Human-readable: an email, an agent key's name, "webhook:polar". */
  label: string;
  /**
   * The read-only demo admin (src/core/demo.ts): every write service refuses
   * it. Set by actorFor(); never stored (a refused write records nothing).
   */
  readOnly?: true;
}

/**
 * Every write through the app's services and the MCP server is recorded with
 * the value before and after, so any change can be inspected and undone.
 */
export interface AuditEntry {
  id: string;
  actor: Actor;
  /** Verb in the form `<entity>.<verb>`: "content.update", "post.publish", "user.role". */
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export type AuditInput = Omit<AuditEntry, "id" | "createdAt">;

export interface AuditQuery extends ListQuery {
  entity?: string;
  entityId?: string;
}

// ---------------------------------------------------------------- overview

/**
 * New accounts and new email subscribers per day, for the overview's trends:
 * `days` are UTC dates (YYYY-MM-DD), oldest first, ending today; `users[i]` and
 * `subscribers[i]` are the rows created on `days[i]` (subscribers still
 * subscribed). Counts of what exists now: a deleted account leaves its day.
 */
export interface Growth {
  days: string[];
  users: number[];
  subscribers: number[];
}

/** The UTC days `growth()` covers: `count` dates ending on `now`'s day, oldest first. */
export function growthDays(count: number, now: Date = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export interface Stats {
  users: number;
  admins: number;
  subscribers: number;
  activeSubscriptions: number;
  purchases: number;
  publishedPosts: number;
  draftPosts: number;
  openFeedback: number;
}
