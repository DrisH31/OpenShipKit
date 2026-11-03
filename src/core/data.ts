//
// The data contract. Two implementations:
//
//   src/adapters/data/postgres  — Drizzle over Postgres: your server (DATABASE_URL —
//                                 docker compose, a VPS, any host) or, in development,
//                                 the embedded PGlite database. The real one.
//   src/adapters/data/memory    — in-process maps, seeded; the reference implementation
//                                 and what unit tests run on (DATA_PROVIDER=memory).
//
// Nothing outside src/adapters/data imports a database driver. Pages, services
// and MCP tools call `getData()` (src/server/data.ts) and speak only this
// interface — that is what lets one codebase run on every stack.
//
// Contract both adapters honour (tests/contract/describe-data-contract.ts, run by
// tests/data-contract.test.ts on memory, PGlite and Postgres):
//  - ids are strings; timestamps ISO-8601; lists are newest-first unless noted;
//  - `limit` defaults to 50 and is capped at 200; a malformed cursor throws DataError("invalid");
//  - a missing row is `null`, never a throw; a broken connection always throws;
//  - writes return the stored row;
//  - unique keys: users (authProvider, authProviderUserId) and email;
//    posts (kind, slug); plans key; subscribers email; subscriptions
//    (provider, providerSubscriptionId); purchases (provider, providerOrderId);
//    agent keys keyHash. A conflicting create throws DataError("conflict");
//  - users.delete cascades to the user's subscriptions, purchases and billing
//    customer ids, and sets feedback.userId to null.
//

import type {
  AgentKey,
  AgentScope,
  AuditEntry,
  AuditInput,
  AuditQuery,
  BillingProviderId,
  ContentEntry,
  DataProviderId,
  Feedback,
  FeedbackInput,
  FeedbackKind,
  FeedbackStatus,
  Growth,
  Identity,
  Job,
  JobCounts,
  JobInput,
  JobStatus,
  ListQuery,
  Page,
  Plan,
  PlanInput,
  Post,
  PostInput,
  PostKind,
  PostPatch,
  PostQuery,
  Purchase,
  PurchaseInput,
  Role,
  Stats,
  Subscriber,
  SubscriberStatus,
  Subscription,
  SubscriptionStatus,
  SubscriptionUpsert,
  User,
  UserPatch,
} from "./types";
import type { Org, OrgInvitation, OrgMember, OrgRole } from "./orgs";

export type PaidProvider = Exclude<BillingProviderId, "none">;

export interface UsersRepo {
  /**
   * Create the user on first sign-in, or refresh email, image and lastSeenAt
   * on later ones. A name only fills in when the stored one is empty, and
   * src/server/session.ts passes none for an existing row, so users.name is
   * copied once and then changed only in settings. `makeAdmin` promotes, never
   * demotes.
   */
  upsertFromIdentity(identity: Identity, opts: { makeAdmin: boolean }): Promise<User>;
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  /**
   * One read for many ids (an audit list naming its actors). Unknown ids are
   * skipped, duplicates collapse; the order is unspecified. An empty list
   * reads nothing and returns [].
   */
  getManyByIds(ids: readonly string[]): Promise<User[]>;
  /** Newest first. `search` matches email or name, case-insensitive. */
  list(query: ListQuery & { search?: string; role?: Role }): Promise<Page<User>>;
  update(id: string, patch: UserPatch): Promise<User>;
  /** Removes the app's row (and, by cascade, its feedback link). Auth-provider data is the adapter's job. */
  delete(id: string): Promise<void>;
}

export interface ContentRepo {
  get(key: string): Promise<ContentEntry | null>;
  all(): Promise<ContentEntry[]>;
  set(key: string, value: unknown): Promise<ContentEntry>;
  delete(key: string): Promise<void>;
}

export interface PostsRepo {
  /** Published posts are ordered by publishedAt desc; drafts by updatedAt desc. */
  list(query: PostQuery): Promise<Page<Post>>;
  getById(id: string): Promise<Post | null>;
  getBySlug(kind: PostKind, slug: string): Promise<Post | null>;
  /**
   * `input.id`, `createdAt` and `updatedAt` are honoured when given (seed and
   * audit restore); an id already in use throws DataError("conflict").
   */
  create(input: PostInput): Promise<Post>;
  /** Setting status "published" with no publishedAt stamps it with now. */
  update(id: string, patch: PostPatch): Promise<Post>;
  delete(id: string): Promise<void>;
  /**
   * Every tag on a published, LISTED post of `kind`, with counts, most used
   * first (ties by tag). Unlisted posts are left out: the tag pages these
   * counts describe list only listed posts, so counting the others would link
   * a tag to a page with nothing on it.
   */
  tags(kind: PostKind): Promise<{ tag: string; count: number }[]>;
}

export interface PlansRepo {
  /** Ordered by sortOrder asc. */
  list(opts?: { activeOnly?: boolean }): Promise<Plan[]>;
  getByKey(key: string): Promise<Plan | null>;
  /** Insert or replace by key. */
  upsert(input: PlanInput): Promise<Plan>;
  delete(key: string): Promise<void>;
}

export interface BillingRepo {
  /** Insert or update by (provider, providerSubscriptionId). */
  upsertSubscription(input: SubscriptionUpsert): Promise<Subscription>;
  getSubscription(provider: PaidProvider, providerSubscriptionId: string): Promise<Subscription | null>;
  listSubscriptions(query: ListQuery & { userId?: string; status?: SubscriptionStatus }): Promise<Page<Subscription>>;
  /** Insert or update (refund flag) by (provider, providerOrderId). */
  recordPurchase(input: PurchaseInput): Promise<Purchase>;
  listPurchases(query: ListQuery & { userId?: string }): Promise<Page<Purchase>>;
  /** The provider's customer id for a user, so checkouts and portals reuse one customer. */
  getCustomerId(userId: string, provider: PaidProvider): Promise<string | null>;
  setCustomerId(userId: string, provider: PaidProvider, customerId: string): Promise<void>;
  findUserIdByCustomerId(provider: PaidProvider, customerId: string): Promise<string | null>;
  /**
   * Idempotency for webhooks: returns true the FIRST time an event id is seen,
   * false on every redelivery. Must be atomic.
   */
  claimWebhookEvent(provider: PaidProvider, eventId: string): Promise<boolean>;
}

export interface FeedbackRepo {
  create(input: FeedbackInput): Promise<Feedback>;
  getById(id: string): Promise<Feedback | null>;
  list(query: ListQuery & { status?: FeedbackStatus; kind?: FeedbackKind; userId?: string }): Promise<Page<Feedback>>;
  update(id: string, patch: { status?: FeedbackStatus; adminNote?: string | null }): Promise<Feedback>;
}

export interface SubscribersRepo {
  /**
   * Idempotent: an existing email comes back unchanged — add() never changes a
   * row's status, so a later sign-up never undoes an unsubscribe. `created` is
   * true only for a new email.
   */
  add(email: string, source: string | null): Promise<{ subscriber: Subscriber; created: boolean }>;
  list(query: ListQuery & { status?: SubscriberStatus; search?: string }): Promise<Page<Subscriber>>;
  unsubscribe(email: string): Promise<Subscriber | null>;
}

export interface AgentKeysRepo {
  /** `createdBy` must name an existing user (else DataError "invalid"); omitted means null. */
  create(input: { name: string; scope: AgentScope; keyHash: string; hint: string; createdBy?: string | null }): Promise<AgentKey>;
  /** Active = not revoked. */
  findActiveByHash(keyHash: string): Promise<AgentKey | null>;
  list(): Promise<AgentKey[]>;
  revoke(id: string): Promise<AgentKey | null>;
  touch(id: string): Promise<void>;
}

export interface AuditRepo {
  record(entry: AuditInput): Promise<AuditEntry>;
  getById(id: string): Promise<AuditEntry | null>;
  list(query: AuditQuery): Promise<Page<AuditEntry>>;
}

/**
 * The background job queue (src/server/jobs). Claims are leases: a running
 * job whose lockedUntil has passed is due again, so a crashed worker's jobs
 * aren't lost, until it has used its maxAttempts: then failAbandoned() ends
 * it, so a job that kills its worker can't restart the app forever.
 * complete() and fail() take the attempt number from the claim and do
 * nothing (null/false) when it no longer matches, so a worker whose lease
 * expired can't overwrite the outcome of the worker that took over.
 *
 * Every way a job ends (succeeded, failed, abandoned) deletes a sensitive
 * job's payload, and nothing else does.
 */
/**
 * Organisations (src/core/orgs.ts). The repository keeps the shapes and the
 * unique keys; who may do what, and the last-owner rule, are the service's
 * (src/server/services/orgs.ts), so both stores enforce them the same way.
 *
 *  - slug is unique; a clash on create or update throws DataError("conflict").
 *  - (orgId, userId) is unique: one membership per person per organisation.
 *  - One pending invitation per (orgId, email); a second throws "conflict".
 *    Accepted, revoked or expired ones free the address.
 *  - Deleting an organisation deletes its members and invitations. Deleting a
 *    user deletes their memberships and sets createdBy / invitedBy to null.
 *  - acceptInvitation() is atomic: the member is added and the invitation marked
 *    accepted together, or neither.
 */
export interface OrgsRepo {
  /** Creates the organisation with `ownerId` as its owner, in one step. */
  create(input: { name: string; slug: string; ownerId: string }): Promise<Org>;
  get(id: string): Promise<Org | null>;
  getBySlug(slug: string): Promise<Org | null>;
  update(id: string, patch: { name?: string; slug?: string }): Promise<Org>;
  delete(id: string): Promise<Org | null>;
  /** Every organisation, newest first; `search` matches the name or slug. For the site admin. */
  list(query: ListQuery & { search?: string }): Promise<Page<Org & { members: number }>>;
  /** The organisations a user belongs to, oldest membership first, with their role in each. */
  listForUser(userId: string): Promise<{ org: Org; role: OrgRole }[]>;
  getMember(orgId: string, userId: string): Promise<OrgMember | null>;
  /** Owners first, then admins, then members; oldest first within a role. */
  listMembers(orgId: string): Promise<OrgMember[]>;
  countMembers(orgId: string): Promise<number>;
  addMember(orgId: string, userId: string, role: OrgRole): Promise<OrgMember>;
  setMemberRole(orgId: string, userId: string, role: OrgRole): Promise<OrgMember>;
  removeMember(orgId: string, userId: string): Promise<boolean>;
  createInvitation(input: { orgId: string; email: string; role: OrgInvitation["role"]; tokenHash: string; invitedBy: string | null; expiresAt: string }): Promise<OrgInvitation>;
  getInvitation(id: string): Promise<OrgInvitation | null>;
  findInvitationByTokenHash(tokenHash: string): Promise<OrgInvitation | null>;
  /** Pending ones only unless `all`; newest first. */
  listInvitations(orgId: string, opts?: { all?: boolean }): Promise<OrgInvitation[]>;
  /** Closes an open invitation (not accepted, not revoked), expired ones included: that frees the address. Null otherwise. */
  revokeInvitation(id: string): Promise<OrgInvitation | null>;
  /** Null when it isn't pending any more; DataError("conflict") when the user is already a member. */
  acceptInvitation(id: string, userId: string): Promise<{ invitation: OrgInvitation; member: OrgMember } | null>;
}

/** What JobsRepo.failAbandoned() records as the job's lastError. */
export const ABANDONED_ERROR =
  "The lease on its last attempt ran out: the worker stopped, or was still running it. A late success is no longer recorded.";

export interface JobsRepo {
  /** With a `key`, a queued or running job with the same key comes back instead (`created: false`). */
  enqueue(input: JobInput): Promise<{ job: Job; created: boolean }>;
  /**
   * Up to `limit` due jobs, oldest runAt first, marked running with attempts + 1
   * and lockedUntil = now + leaseMs. Due: queued with runAt passed, or running
   * with its lease expired and attempts left. Concurrent claims never return the same job.
   */
  claim(input: { limit: number; leaseMs: number }): Promise<Job[]>;
  /** Running jobs whose lease expired on their last attempt, marked failed. Returns them. */
  failAbandoned(): Promise<Job[]>;
  /** Marks a claimed job succeeded. False when the claim is stale. */
  complete(id: string, attempt: number): Promise<boolean>;
  /**
   * Records a failed attempt: back to queued at `retryAt` while attempts < maxAttempts
   * (and retryAt isn't null), else failed. Null when the claim is stale.
   */
  fail(id: string, attempt: number, input: { error: string; retryAt: string | null }): Promise<Job | null>;
  /** A failed job back to queued, due now, with its attempts reset. Null unless it is failed and still has its payload. */
  retry(id: string): Promise<Job | null>;
  get(id: string): Promise<Job | null>;
  /** Newest first. */
  list(query: ListQuery & { status?: JobStatus }): Promise<Page<Job>>;
  counts(): Promise<JobCounts>;
  /** Deletes succeeded and failed jobs that finished before `finishedBefore`; returns how many. */
  prune(finishedBefore: string): Promise<number>;
}

export interface DataStore {
  readonly id: DataProviderId;
  /** Cheap round-trip; used by /api/health. */
  health(): Promise<{ ok: boolean; detail?: string }>;
  users: UsersRepo;
  content: ContentRepo;
  posts: PostsRepo;
  plans: PlansRepo;
  billing: BillingRepo;
  feedback: FeedbackRepo;
  subscribers: SubscribersRepo;
  agentKeys: AgentKeysRepo;
  audit: AuditRepo;
  jobs: JobsRepo;
  orgs: OrgsRepo;
  stats(): Promise<Stats>;
  /** New accounts and subscribers per UTC day over the last `days` days (1–90), ending today. */
  growth(days: number, now?: Date): Promise<Growth>;
}

export type DataErrorCode = "conflict" | "not_found" | "invalid";

/** The only errors an adapter throws on purpose. Anything else is a backend failure. */
export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** The span `growth()` accepts: 1 to 90 whole days. */
export function clampGrowthDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  return Math.min(90, Math.max(1, Math.floor(days)));
}

export function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}
