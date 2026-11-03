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
//  - Or both at once, atomically: consumeUsage(subject, "api_calls", 1, { key })
//    records only if it fits (concurrent calls for one metric queue). The two-step
//    form above lets concurrent requests both slip in at limit - 1.
//
// Whose limits: the subject's plan (usageSubject). That's a person, or with
// teams on, the organisation they're working in, unless the organisation has
// no plan and the person has their own: then the person. (requirePlan lets
// either plan through; here one has to win, and the team's does when it has one.)
// With no paid plan, the free plan's limits apply (the active plan with no paid
// price that isn't "contact sales", first by sortOrder); with no free plan,
// nothing is limited.
//
// Metered prices: an event of a metric in BILLING_METERED_METRICS is stored as
// pending (an outbox) and sent to the billing provider's meter (Polar, Stripe)
// by a job that reads the stored event, never the caller's arguments
// (../jobs/usage-report.ts). A sweep re-queues anything left pending.
//
// The period resets monthly: the subscription's own period where the provider
// gave its start, else a month back from the renewal, or the 1st (UTC) for the
// free plan and lifetime purchases. A yearly plan's quotas reset
// monthly too, which is the common SaaS shape; a quota meant per year is a
// count the app keeps itself.
//

import { METRIC_RE } from "@/core/schemas";
import type { Entitlement, Plan, UsageEvent, UsageSubject, User } from "@/core/types";
import { getBilling } from "../billing";
import { getData } from "../data";
import { billingProvider, meteredMetrics } from "../env";
import { enqueueJob } from "../jobs";
import { REPORT_WINDOW_MS, usageReportJob } from "../jobs/usage-report";
import { log } from "../log";
import { currentOrg } from "../orgs";
import { getEntitlement, getOrgEntitlement } from "./billing";
import { ServiceError } from "./errors";
import { orgAccess, teamsEnabled } from "./orgs";

/**
 * Whose usage and limits apply to what `user` is doing. With teams on: the organisation, `orgId` if
 * given (it must be one of theirs), else the current one. Give `orgId` outside a browser session, such
 * as an API request, where there is no "current organisation" cookie. But if that organisation has no
 * plan and the person has their own, the person. The billing page reads the same subject.
 */
export async function usageSubject(user: User, opts: { orgId?: string } = {}): Promise<UsageSubject> {
  if (teamsEnabled()) {
    const access = opts.orgId ? await orgAccess(user, opts.orgId) : await currentOrg(user);
    if (access) {
      const org = await getOrgEntitlement(access.org.id);
      if (org.source !== "free") return { type: "org", id: access.org.id };
      const mine = await getEntitlement(user.id);
      return mine.source !== "free" ? { type: "user", id: user.id } : { type: "org", id: access.org.id };
    }
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

/**
 * Pure: the month-long period containing `now`. With the subscription's own period (`startsAt` to
 * `renewsAt`) containing now, exactly that: a renewal on the 31st has periods 31 Jan to 28 Feb to 31
 * Mar, which no rule from the end alone can tell. Otherwise anchored on `renewsAt`'s day (a yearly plan
 * resets monthly), or the calendar month (UTC).
 */
export function periodAt(now: Date, renewsAt: string | null, startsAt: string | null = null): Period {
  if (renewsAt && startsAt) {
    const start = new Date(startsAt);
    const end = new Date(renewsAt);
    // A month-long period that contains now (a yearly one is split into months below).
    if (start <= now && now < end && addMonths(start, 1) >= end) return { from: start.toISOString(), to: end.toISOString() };
  }
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

/** Pure: whether a plan could be the free plan (ignoring whether it's active): no paid price, not "contact sales". The one rule, also used by the MCP gate. */
export function isFreePlanCandidate(p: Pick<Plan, "contactSales" | "prices"> | Partial<Plan>): boolean {
  return !p.contactSales && !(p.prices ?? []).some((x) => x.amountCents > 0);
}

/** Pure: the free plan, whose limits apply to anyone without a paid one: an active candidate, first by sortOrder. */
export function freePlan(plans: readonly Plan[]): Plan | null {
  return [...plans].filter((p) => p.active && isFreePlanCandidate(p)).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))[0] ?? null;
}

/** Pure: the plan whose limits apply, given the entitlement and every plan. */
export function limitingPlan(entitlement: Entitlement, plans: readonly Plan[]): Plan | null {
  const held = entitlement.planKey ? plans.find((p) => p.key === entitlement.planKey) : undefined;
  return held ?? freePlan(plans);
}

export type LimitContext = { plan: Plan | null; period: Period };

/** The plan whose limits apply to `subject` right now, and its current period. */
export async function limitContext(subject: UsageSubject, now = new Date()): Promise<LimitContext> {
  const [entitlement, plans] = await Promise.all([subject.type === "org" ? getOrgEntitlement(subject.id) : getEntitlement(subject.id), (await getData()).plans.list({})]);
  const sub = entitlement.source === "subscription";
  return { plan: limitingPlan(entitlement, plans), period: periodAt(now, sub ? entitlement.currentPeriodEnd : null, sub ? (entitlement.currentPeriodStart ?? null) : null) };
}

/** The limit on `metric` for this context, or null for unlimited. */
export const limitOf = (ctx: LimitContext, metric: string): number | null => {
  const v = ctx.plan?.limits?.[metric];
  return typeof v === "number" ? v : null;
};

function assertMetric(metric: string): void {
  if (!METRIC_RE.test(metric) || metric.length > 40) throw new ServiceError("invalid", `"${metric}" isn't a metric name: use lower-case words joined by underscores (api_calls).`);
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0) throw new ServiceError("invalid", "Usage is a whole number of at least 0.");
}

export type LimitCheck = { allowed: boolean; limit: number | null; used: number; metric: string; plan: string | null };

const limitReached = (metric: string, limit: number | null, used: number, metered: boolean) =>
  new ServiceError("conflict", `Your plan allows ${limit} ${metric.replace(/_/g, " ")}${metered ? " a month" : ""}, and that's used up. Upgrade for more.`, {
    reason: "limit_reached",
    metric,
    limit,
    used,
  });

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
  if (!check.allowed) throw limitReached(metric, check.limit, check.used, opts.current === undefined);
  return check;
}

/** Whether this metric's events go to the billing provider's meter (BILLING_METERED_METRICS, on Polar or Stripe). */
function reportable(metric: string, quantity: number): boolean {
  const provider = billingProvider();
  return quantity > 0 && (provider === "polar" || provider === "stripe") && meteredMetrics().has(metric);
}

/** A key reused for different usage is a bug in the caller, not a retry: say so instead of silently keeping the first. */
function assertSameRetry(event: UsageEvent, quantity: number): void {
  if (event.quantity !== quantity) {
    throw new ServiceError("conflict", `The key "${event.key}" already recorded ${event.quantity} ${event.metric}, not ${quantity}. Use a new key for new usage.`, { reason: "key_reused" });
  }
}

/** Queue the stored event's report. Keyed by the event, so at most one job waits for it. */
async function queueReport(event: UsageEvent): Promise<void> {
  if (event.reportPending) await enqueueJob(usageReportJob, { eventId: event.id }, { key: `usage:${event.id}` });
}

/**
 * Record `quantity` of `metric` for `subject`. With a `key` (a request id, a job id) it's idempotent
 * per metric: a retry records nothing (and a reused key with a different quantity is refused).
 * Recording never refuses on a limit: check first, or use consumeUsage.
 */
export async function recordUsage(subject: UsageSubject, metric: string, quantity: number, opts: { key?: string; occurredAt?: Date } = {}): Promise<{ created: boolean }> {
  assertMetric(metric);
  assertQuantity(quantity);
  const { event, created } = await (await getData()).usage.record({ subject, metric, quantity, key: opts.key ?? null, occurredAt: opts.occurredAt?.toISOString(), report: reportable(metric, quantity) });
  if (!created) assertSameRetry(event, quantity);
  // Queued on a repeat too, while still pending: a first call that recorded and then failed to queue
  // is finished by the caller's retry (and the sweep catches the rest).
  await queueReport(event);
  return { created };
}

/**
 * Check and record in one atomic step: records `quantity` of `metric` only if it fits this period's
 * limit, else refuses like requireWithinLimit. Concurrent calls for one subject's metric queue, so the
 * limit holds exactly, provided every write of this metric goes through consumeUsage (recordUsage takes
 * no lock). A key already recorded comes back as a retry, without a second check.
 */
export async function consumeUsage(subject: UsageSubject, metric: string, quantity = 1, opts: { key?: string; occurredAt?: Date } = {}): Promise<{ created: boolean; used: number; limit: number | null }> {
  assertMetric(metric);
  assertQuantity(quantity);
  const ctx = await limitContext(subject);
  const limit = limitOf(ctx, metric);
  const data = await getData();
  const input = { subject, metric, quantity, key: opts.key ?? null, occurredAt: opts.occurredAt?.toISOString(), report: reportable(metric, quantity) };
  if (limit === null) {
    const { event, created } = await data.usage.record(input);
    if (!created) assertSameRetry(event, quantity);
    await queueReport(event);
    return { created, used: await data.usage.sum(subject, metric, ctx.period.from, ctx.period.to), limit };
  }
  const { event, created, used } = await data.usage.consume({ ...input, limit, from: ctx.period.from, to: ctx.period.to });
  if (!event) throw limitReached(metric, limit, used, true);
  if (!created) assertSameRetry(event, quantity);
  await queueReport(event);
  return { created, used: created ? used + quantity : used, limit };
}

/** Pending reports younger than this are left to the normal path, which queues them at once. */
const SWEEP_AFTER_MS = 5 * 60_000;
/** Pending longer than this is worth an alarm. */
const STALE_AFTER_MS = 24 * 60 * 60_000;
/**
 * The provider's window (REPORT_WINDOW_MS, in the job): the job expires an event older than it by the
 * event's own time; the sweep expires rows older than it by when they were written, as a backstop.
 */
export { REPORT_WINDOW_MS };
/** An event whose job failed for good is re-queued no sooner than this after, so a refusal can't loop. */
const RETRY_FAILED_AFTER_MS = 6 * 60 * 60_000;
/** The alarm for stale events: at most once an hour per process. */
const ALARM_EVERY_MS = 60 * 60_000;
let lastAlarm = 0;

/**
 * The outbox's sweep, run by the job runner every few minutes. Every pending event reaches a final
 * state: sent, settled with nobody to bill (the job), or expired past the provider's window (here).
 *   - Re-queues events still pending a few minutes after they were recorded (a crash between insert
 *     and queue; a job that failed for good, after a pause), but only where this process can meter:
 *     with billing off here, it queues nothing and just counts.
 *   - Settles as expired what is past the provider's window, and says how many.
 *   - Raises one alarm an hour, with the count, while any event waits for more than a day.
 * Returns how many it queued.
 */
export async function sweepUsageReports(now = Date.now()): Promise<number> {
  const data = await getData();
  const iso = (ms: number) => new Date(ms).toISOString();
  const expired = await data.usage.expirePendingReports(iso(now - REPORT_WINDOW_MS));
  if (expired) log.warn("usage", `${expired} metered usage event(s) expired unsent: older than the billing provider accepts (35 days)`);

  const canMeter = Boolean((await getBilling())?.reportUsage);
  let queued = 0;
  if (canMeter) {
    const pending = await data.usage.listPendingReports(iso(now - REPORT_WINDOW_MS), iso(now - SWEEP_AFTER_MS), 200, { failedSince: iso(now - RETRY_FAILED_AFTER_MS) });
    for (const event of pending) {
      const { created } = await enqueueJob(usageReportJob, { eventId: event.id }, { key: `usage:${event.id}` });
      if (created) queued++;
    }
    if (queued) log.info("usage", `re-queued ${queued} usage report(s) still pending`);
  }

  if (now - lastAlarm >= ALARM_EVERY_MS) {
    const stale = await data.usage.countPendingReports(iso(now - STALE_AFTER_MS));
    if (stale) {
      lastAlarm = now;
      log.error(
        "usage",
        canMeter
          ? `${stale} metered usage event(s) unsent for over a day. The failed usage.report jobs in /admin/jobs say why; they are retried every few hours until 35 days old, then expire.`
          : `${stale} metered usage event(s) unsent for over a day: billing can't meter in this process (off, or a provider without meters). They are sent once it can, until 35 days old.`,
      );
    }
  }
  return queued;
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
