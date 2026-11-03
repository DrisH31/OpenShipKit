import "server-only";

//
// Small pieces the tool files share: paging arguments, public URLs, the
// compact shapes lists return, and `patchShape` for update tools. Lists stay
// small on purpose — an agent's context is the scarce resource — and the
// matching *_get tool returns the full record.
//

import { z } from "zod";
import { siteSchema } from "@/core/content";
import { DEFAULT_CONTENT } from "@/content/defaults";
import type { AgentScope, AuditEntry, Feedback, Plan, PlanLimits, PlanPrice, Post, PostPatch } from "@/core/types";
import { POST_KIND } from "@/lib/status";
import { scopeAllows } from "@/server/services/agent-keys";
import { RESTORABLE_ENTITIES } from "@/server/services/audit";
import { ServiceError } from "@/server/services/errors";
import { siteUrl } from "@/server/env";
import type { ToolContext } from "../types";

/** MCP lists default smaller than the DataStore's 50: replies land in a model's context. */
export const MCP_DEFAULT_LIMIT = 20;

export const pagingShape = {
  limit: z.number().int().min(1).max(200).optional().describe(`How many to return (default ${MCP_DEFAULT_LIMIT}, max 200)`),
  cursor: z.string().max(200).nullable().optional().describe("Pass the previous reply's nextCursor to get the next page"),
};

export function paging(args: { limit?: number; cursor?: string | null }) {
  return { limit: args.limit ?? MCP_DEFAULT_LIMIT, cursor: args.cursor ?? null };
}

/**
 * The fields of a create schema as an all-optional PATCH shape. `.partial()`
 * alone is not enough: zod still applies a field's default to a missing key,
 * so `{title}` would come back with `body: ""` and wipe the stored body. Here
 * each default is removed (its description kept), so a field the agent did not
 * send stays absent.
 */
export function patchShape<T extends z.ZodRawShape>(shape: T): PatchShape<T> {
  const out: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(shape)) {
    let inner = field as z.ZodType;
    let description = inner.description;
    // Peel .optional() and .default() layers (a .partial() schema has both: optional(default(x))).
    while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
      inner = inner.unwrap() as z.ZodType;
      description ??= inner.description;
    }
    const optional = inner.optional();
    out[key] = description ? optional.describe(description) : optional;
  }
  return out as PatchShape<T>;
}

type Bare<F> = F extends z.ZodOptional<infer I> ? Bare<I> : F extends z.ZodDefault<infer I> ? Bare<I> : F;
type PatchShape<T extends z.ZodRawShape> = { [K in keyof T]: z.ZodOptional<Bare<T[K]>> };

/** Drop keys whose value is undefined (what a patch schema leaves for fields not sent). */
export function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Where a post lives on the public site (a draft's URL 404s until it is published). */
export function postUrl(post: Pick<Post, "kind" | "slug">): string {
  return `${siteUrl()}${POST_KIND[post.kind].publicPath}/${post.slug}`;
}

// ---------------------------------------------------------------- finer scopes

/**
 * Refuse unless the calling key has `needs` scope. For rules finer than a
 * tool's own scope: a write key may edit a plan's copy, but changing what a
 * customer is charged needs admin. Throws ServiceError("forbidden"), which the
 * protocol returns to the agent as a refusal.
 */
export function requireScope(ctx: ToolContext, needs: AgentScope, what: string): void {
  if (scopeAllows(ctx.key.scope, needs)) return;
  throw new ServiceError(
    "forbidden",
    `${what} needs ${needs === "admin" ? "an" : "a"} ${needs} key; this key (${ctx.key.name}) has scope ${ctx.key.scope}. Ask the site owner to make this change in /admin, or for a key with more scope.`,
  );
}

// ---------------------------------------------------------------- contact address

/**
 * The address a stored `site` value sends contact-form copies to, as the site
 * would read it: a value that fails the schema (or none at all) renders the
 * default, so it routes to the default's address.
 */
export function contactEmailOf(siteValue: unknown): string {
  const parsed = siteValue == null ? null : siteSchema.safeParse(siteValue);
  return parsed?.success ? parsed.data.contactEmail : DEFAULT_CONTENT.site.contactEmail;
}

/**
 * Refuse a change to site.contactEmail below admin. Every contact-form
 * submission — the sender's name, email and message — is emailed to that
 * address, so a write key that has read hostile public text (feedback_list)
 * must not be able to point it somewhere else. Same rule as plan prices.
 * `current` and `next` are addresses, as contactEmailOf() reads them.
 */
export function guardContactEmail(ctx: ToolContext, current: string, next: string, what: string): void {
  if (current === next) return;
  requireScope(ctx, "admin", `${what} changes site.contactEmail, where every contact-form message (with the sender's name and email) is sent, and`);
}

// ---------------------------------------------------------------- dates

/** How far ahead of the server clock a publishedAt may be (clock skew), in ms. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

/**
 * Refuse a published post dated in the future. There is no scheduling: a
 * published post is live at once whatever its date, so a future publishedAt
 * would only put it at the top of /blog with a pubDate that hasn't happened.
 */
export function assertNotFutureDated(status: string | undefined, publishedAt: string | null | undefined): void {
  if (status !== "published" || !publishedAt) return;
  if (Date.parse(publishedAt) <= Date.now() + FUTURE_SLACK_MS) return;
  throw new ServiceError(
    "invalid",
    `publishedAt ${publishedAt} is in the future. Publishing is immediate (there is no scheduling), so a published post can't be dated ahead: keep it a draft and publish it on the day, or pass a date that has passed.`,
    [{ path: "publishedAt", message: "Must not be in the future for a published post" }],
  );
}

// ---------------------------------------------------------------- plans

/** The billing-relevant part of one price: what checkout charges and which provider objects it maps to. */
function priceKey(p: PlanPrice): string {
  return `${p.interval}|${p.amountCents}|${p.currency.toLowerCase()}|${p.polarProductId ?? ""}|${p.stripePriceId ?? ""}|${p.razorpayPlanId ?? ""}|${p.perSeat ? "seat" : ""}`;
}

/**
 * True when two price lists charge the same: same intervals, amounts,
 * currencies and Polar product ids, in any order. Prices decide entitlements
 * (a webhook's product id is matched against them) and what checkout sells.
 */
export function samePrices(a: readonly PlanPrice[], b: readonly PlanPrice[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(priceKey).sort();
  const right = b.map(priceKey).sort();
  return left.every((k, i) => k === right[i]);
}

/** Two plans' limits are the same: the same metrics with the same numbers, in any order. A missing set (a plan saved before limits existed) is none. */
export function sameLimits(a: PlanLimits | undefined, b: PlanLimits | undefined): boolean {
  const left = Object.entries(a ?? {});
  const right = b ?? {};
  return left.length === Object.keys(right).length && left.every(([k, v]) => right[k] === v);
}

/**
 * Whether saving `next` over `current` (null = no such plan yet) changes what
 * a customer is charged or gets: its prices (amounts, intervals, provider
 * ids), its trial, or its limits (raising a quota or a seat cap gives
 * something away). Copy, features, order and visibility don't.
 */
export function changesBilling(current: Pick<Plan, "prices" | "trialDays"> & { limits?: PlanLimits } | null, next: Pick<Plan, "prices" | "trialDays"> & { limits?: PlanLimits }): boolean {
  if (!current) return next.prices.length > 0 || next.trialDays !== null || Object.keys(next.limits ?? {}).length > 0;
  return !samePrices(current.prices, next.prices) || current.trialDays !== next.trialDays || !sameLimits(current.limits, next.limits);
}

/**
 * Whether saving `next` for plan `key` (null: deleting it) could change which plan is the free plan,
 * whose limits everyone without a paid plan gets (freePlan in src/server/services/usage.ts). A write
 * key could otherwise lift every free limit without touching one: hide the free plan, re-sort it, or
 * add a priceless plan before it.
 *
 * Judged on this call alone, never by comparing against the other plans as they are now: two calls
 * sent at once each see the plans before the other's write, so a check against the current free plan
 * passes both. Any change to a priceless plan's candidacy (active, sortOrder, contactSales, prices),
 * a new active priceless plan, or deleting a priceless plan counts.
 */
export async function changesFreePlan(key: string, next: Partial<Plan> | null): Promise<boolean> {
  const [{ getPlan }, { isFreePlanCandidate }] = await Promise.all([import("@/server/services/plans"), import("@/server/services/usage")]);
  const current = await getPlan(key);
  const priceless = (p: Partial<Plan> | null | undefined) => !!p && isFreePlanCandidate(p);
  if (next === null) return priceless(current);
  const after = { ...(current ?? {}), ...next } as Partial<Plan>;
  if (!current) return priceless(after) && after.active !== false;
  if (!priceless(current) && !priceless(after)) return false;
  return (
    current.active !== after.active ||
    current.sortOrder !== after.sortOrder ||
    current.contactSales !== after.contactSales ||
    !samePrices(current.prices, after.prices ?? [])
  );
}

/**
 * Every editable field of a stored post, overlaid with `changes`. The post
 * tools always send the whole set to updatePost, so a field the agent did not
 * mention keeps its stored value whatever defaults the update schema applies.
 */
export function fullPostPatch(post: Post, changes: PostPatch): PostPatch {
  return {
    slug: post.slug,
    title: post.title,
    description: post.description,
    body: post.body,
    coverImage: post.coverImage,
    coverAlt: post.coverAlt,
    tags: post.tags,
    status: post.status,
    listed: post.listed,
    authorName: post.authorName,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    publishedAt: post.publishedAt,
    ...definedOnly(changes),
  };
}

/** A post without its body, for lists. */
export function postSummary(post: Post) {
  return {
    id: post.id,
    kind: post.kind,
    slug: post.slug,
    title: post.title,
    description: post.description,
    status: post.status,
    listed: post.listed,
    tags: post.tags,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    bodyChars: post.body.length,
    url: postUrl(post),
  };
}

/** The full post plus its public URL. */
export function postDetail(post: Post) {
  return { ...post, url: postUrl(post), live: post.status === "published" };
}

export function isRestorable(entity: string): boolean {
  return (RESTORABLE_ENTITIES as readonly string[]).includes(entity);
}

// ---------------------------------------------------------------- personal data

/**
 * Audit entities whose before/after a key below admin may see: site content,
 * posts, plans, feedback triage (status and admin note only), the seed
 * marker and media (a file's path, type and size). Everything else is withheld below admin — user rows (email, name,
 * provider ids), subscriber emails, billing rows (subscriptions, purchases,
 * the billing_customer link between a user and their Polar customer id) and
 * agent keys — the same line users_list and subscribers_list draw.
 *
 * An allowlist on purpose: an entity added to the audit log later is private
 * until someone decides its values are safe to show here.
 */
const VALUES_BELOW_ADMIN: ReadonlySet<string> = new Set(["content", "post", "plan", "feedback", "seed", "media"]);

/** Whether this key may see personal data (emails, names) — admin only. */
export function seesPersonalData(ctx: ToolContext): boolean {
  return scopeAllows(ctx.key.scope, "admin");
}

/**
 * Who made a change, as a key may see it. A person's label is their email, so
 * below admin it becomes `user:<id>`; agents and the system keep their label.
 */
function actorLabel(entry: AuditEntry, ctx: ToolContext): string {
  if (entry.actor.type !== "user" || seesPersonalData(ctx)) return entry.actor.label;
  return `user:${entry.actor.id ?? "unknown"}`;
}

/** An audit entry without before/after (which can be whole documents). */
export function auditSummary(entry: AuditEntry, ctx: ToolContext) {
  return {
    id: entry.id,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    actor: actorLabel(entry, ctx),
    createdAt: entry.createdAt,
    restorable: isRestorable(entry.entity),
  };
}

/** An audit entry with before/after — below admin, only for the entities in VALUES_BELOW_ADMIN. */
export function auditDetail(entry: AuditEntry, ctx: ToolContext) {
  if (!VALUES_BELOW_ADMIN.has(entry.entity) && !seesPersonalData(ctx)) {
    return { ...auditSummary(entry, ctx), valuesWithheld: "personal data: needs an admin key" };
  }
  return { ...auditSummary(entry, ctx), before: entry.before, after: entry.after };
}

/** A feedback item as a key may see it: the sender's email and name only with admin scope. */
export function feedbackView(item: Feedback, ctx: ToolContext) {
  if (seesPersonalData(ctx)) return { ...item };
  const { email, name, ...rest } = item;
  return { ...rest, hasEmail: email !== null, hasName: name !== null };
}
