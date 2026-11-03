import "server-only";

//
// Plan limits and usage (ROADMAP Phase 4). Two kinds of limit, both declared on
// the plan (plan.limits: { projects: 3, api_calls: 10000, seats: 5 }; a metric
// that isn't listed is unlimited):
//
//  - Counts: things the app already has rows for (projects, seats). The caller
//    passes how many exist now:
//      await requireWithinLimit(subject, "projects", { current: await countProjects(orgId) });
//  - Metered usage: events recorded with recordUsage() and summed over the
//    current period:
//      await requireWithinLimit(subject, "api_calls");             // before the work
//      await recordUsage(subject, "api_calls", 1, { key: requestId }); // after it
//
// Whose limits: the subject's plan. That's a person, or with teams on, the
// organisation they're working in (usageSubject). With no paid plan, the free
// plan's limits apply (the active plan with no paid price, first by sortOrder),
// and with no free plan, nothing is limited.
//
// Metered prices: a metric listed in BILLING_METERED_METRICS is also reported to
// the billing provider's meter (Polar, Stripe) by a background job, one per
// event (../jobs/usage-report.ts). Limits here and charges there are separate:
// a metered price usually has no limit, or a high one as a safety cap.
//
// The period resets monthly: on the subscription's renewal day, or on the 1st
// (UTC) for the free plan and lifetime purchases. A yearly plan's quotas reset
// monthly too, which is the common SaaS shape; a quota meant per year is a
// count the app keeps itself.
//

import { METRIC_RE } from "@/core/schemas";
import type { Entitlement, Plan, UsageSubject, User } from "@/core/types";
import { getData } from "../data";
import { billingProvider, meteredMetrics } from "../env";
import { enqueueJob } from "../jobs";
import { usageReportJob } from "../jobs/usage-report";
import { currentOrg } from "../orgs";
import { getEntitlement, getOrgEntitlement } from "./billing";
import { ServiceError } from "./errors";
import { teamsEnabled } from "./orgs";

/** Whose usage and limits apply to what `user` is doing: their organisation with teams on, else themselves. */
export async function usageSubject(user: User): Promise<UsageSubject> {
  if (teamsEnabled()) {
    const access = await currentOrg(user);
    if (access) return { type: "org", id: access.org.id };
  }
  return { type: "user", id: user.id };
}

export type Period = { from: string; to: string };

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  // 31 Jan + 1 month is the last day of February, not 3 March.
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** Pure: the month-long period containing `now`, anchored on `renewsAt`'s day (or the 1st, UTC). */
export function periodAt(now: Date, renewsAt: string | null): Period {
  if (!renewsAt) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: from.toISOString(), to: addMonths(from, 1).toISOString() };
  }
  // Every boundary is counted from the renewal itself, never from the previous step, or the day
  // drifts (31 March → 28 February → 28 January, instead of 31 January).
  const anchor = new Date(renewsAt);
  let k = 0;
  while (addMonths(anchor, -k) > now && k < 1200) k++;
  while (addMonths(anchor, -(k - 1)) <= now && k > -1200) k--;
  return { from: addMonths(anchor, -k).toISOString(), to: addMonths(anchor, -(k - 1)).toISOString() };
}

/** Pure: the plan whose limits apply, given the entitlement and every plan. */
export function limitingPlan(entitlement: Entitlement, plans: readonly Plan[]): Plan | null {
  const held = entitlement.planKey ? plans.find((p) => p.key === entitlement.planKey) : undefined;
  if (held) return held;
  // No paid plan: the free plan, the active one with no paid price, first by sortOrder.
  return [...plans].filter((p) => p.active && !p.prices.some((x) => x.amountCents > 0)).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))[0] ?? null;
}

export type LimitContext = { plan: Plan | null; period: Period };

/** The plan whose limits apply to `subject` right now, and its current period. */
export async function limitContext(subject: UsageSubject, now = new Date()): Promise<LimitContext> {
  const [entitlement, plans] = await Promise.all([subject.type === "org" ? getOrgEntitlement(subject.id) : getEntitlement(subject.id), (await getData()).plans.list({})]);
  const renewsAt = entitlement.source === "subscription" ? entitlement.currentPeriodEnd : null;
  return { plan: limitingPlan(entitlement, plans), period: periodAt(now, renewsAt) };
}

/** The limit on `metric` for this context, or null for unlimited. */
export const limitOf = (ctx: LimitContext, metric: string): number | null => {
  const v = ctx.plan?.limits?.[metric];
  return typeof v === "number" ? v : null;
};

function assertMetric(metric: string): void {
  if (!METRIC_RE.test(metric) || metric.length > 40) throw new ServiceError("invalid", `"${metric}" isn't a metric name: use lower-case words joined by underscores (api_calls).`);
}

export type LimitCheck = { allowed: boolean; limit: number | null; used: number; metric: string; plan: string | null };

/**
 * Whether `adding` more of `metric` fits the plan's limit. `current` is the count the app keeps (a
 * count limit); without it, the metered usage this period is summed (a usage limit).
 */
export async function checkLimit(subject: UsageSubject, metric: string, opts: { current?: number; adding?: number } = {}): Promise<LimitCheck> {
  assertMetric(metric);
  const ctx = await limitContext(subject);
  const limit = limitOf(ctx, metric);
  const used = opts.current ?? (await (await getData()).usage.sum(subject, metric, ctx.period.from, ctx.period.to));
  const adding = opts.adding ?? 1;
  return { allowed: limit === null || used + adding <= limit, limit, used, metric, plan: ctx.plan?.key ?? null };
}

/** checkLimit, refusing with ServiceError("conflict", reason "limit_reached") when it doesn't fit. */
export async function requireWithinLimit(subject: UsageSubject, metric: string, opts: { current?: number; adding?: number } = {}): Promise<LimitCheck> {
  const check = await checkLimit(subject, metric, opts);
  if (!check.allowed) {
    throw new ServiceError("conflict", `Your plan allows ${check.limit} ${metric.replace(/_/g, " ")}${opts.current === undefined ? " a month" : ""}, and that's used up. Upgrade for more.`, {
      reason: "limit_reached",
      metric,
      limit: check.limit,
      used: check.used,
    });
  }
  return check;
}

/**
 * Record `quantity` of `metric` for `subject`. With a `key` (a request id, a job id) it's
 * idempotent: a retry records nothing. Recording never refuses on a limit: check first.
 */
export async function recordUsage(subject: UsageSubject, metric: string, quantity: number, opts: { key?: string; occurredAt?: Date } = {}): Promise<{ created: boolean }> {
  assertMetric(metric);
  if (!Number.isInteger(quantity) || quantity < 0) throw new ServiceError("invalid", "Usage is a whole number of at least 0.");
  const { event, created } = await (await getData()).usage.record({ subject, metric, quantity, key: opts.key ?? null, occurredAt: opts.occurredAt?.toISOString() });
  // Queued on a repeat too (keyed by the event, so at most one is waiting): if a first call recorded
  // the event and then failed to queue, the caller's retry still gets it reported. The provider drops
  // a second report of the same event id.
  const provider = billingProvider();
  if (quantity > 0 && (provider === "polar" || provider === "stripe") && meteredMetrics().has(metric)) {
    await enqueueJob(usageReportJob, { eventId: event.id, subject, metric, quantity: event.quantity, occurredAt: event.occurredAt }, { key: `usage:${event.id}` });
  }
  return { created };
}

export type UsageLine = { metric: string; used: number; limit: number | null };

/**
 * This period's usage of every metric the plan limits or that was recorded, for the billing page and
 * MCP. Count limits (projects, seats) show the limit only: their "used" is the app's own count.
 */
export async function usageSummary(subject: UsageSubject): Promise<{ plan: string | null; period: Period; lines: UsageLine[] }> {
  const ctx = await limitContext(subject);
  const totals = await (await getData()).usage.totals(subject, ctx.period.from, ctx.period.to);
  const metrics = [...new Set([...Object.keys(ctx.plan?.limits ?? {}), ...Object.keys(totals)])].sort();
  return { plan: ctx.plan?.key ?? null, period: ctx.period, lines: metrics.map((metric) => ({ metric, used: totals[metric] ?? 0, limit: limitOf(ctx, metric) })) };
}
