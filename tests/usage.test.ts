//
// Plan limits and usage (ROADMAP Phase 4), through the real services on the
// memory store: the period, which plan's limits apply, count and metered
// limits, idempotent recording, organisations, and a plan's seat limit.
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import type { DataStore } from "@/core/data";
import type { Entitlement, Plan, PlanInput, User } from "@/core/types";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
vi.mock("@/server/email", () => ({ sendEmail: async () => ({ id: "em" }) }));
const meter = vi.hoisted(() => ({ reports: [] as unknown[] }));
vi.mock("@/server/billing", () => ({
  getBilling: async () => ({ id: "stripe", label: "Stripe", hasPortal: true, reportUsage: async (r: unknown) => void meter.reports.push(r) }),
}));
const cookie = vi.hoisted(() => ({ org: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookie.org ? { value: cookie.org } : undefined), set: () => {} }) }));

const usage = await import("@/server/services/usage");
const orgs = await import("@/server/services/orgs");
const { enqueueJob, runDueJobs } = await import("@/server/jobs");
const { usageReportJob } = await import("@/server/jobs/usage-report");

const plan = (key: string, over: Partial<PlanInput> = {}): PlanInput => ({
  key,
  name: key,
  description: "",
  features: [],
  prices: [],
  highlighted: false,
  contactSales: false,
  ctaLabel: "Go",
  trialDays: null,
  active: true,
  sortOrder: 1,
  ...over,
});

let user: User;
beforeEach(async () => {
  store = createMemoryStore({ fresh: true });
  for (const p of await store.plans.list({})) await store.plans.delete(p.key); // the seed's plans, out of the way
  await store.plans.upsert(plan("free", { sortOrder: 0, limits: { api_calls: 3, projects: 1, seats: 2 } }));
  await store.plans.upsert(plan("pro", { sortOrder: 2, prices: [{ interval: "month", amountCents: 1000, currency: "usd", polarProductId: "prod_pro" }], limits: { api_calls: 1000 } }));
  user = await store.users.upsertFromIdentity(
    { provider: "better-auth", providerUserId: "u1", email: "u1@example.com", name: "U", image: null, emailVerified: true },
    { makeAdmin: false },
  );
  cookie.org = undefined;
  meter.reports = [];
});
afterEach(() => vi.unstubAllEnvs());

const me = () => ({ type: "user" as const, id: user.id });

describe("the period", () => {
  it("is the calendar month (UTC) without a subscription", () => {
    expect(usage.periodAt(new Date("2026-11-15T10:00:00Z"), null)).toEqual({ from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" });
  });

  it("is the month ending at the next renewal, anchored on its day, whatever month it is now", () => {
    expect(usage.periodAt(new Date("2026-11-15T10:00:00Z"), "2026-11-20T08:00:00.000Z")).toEqual({ from: "2026-10-20T08:00:00.000Z", to: "2026-11-20T08:00:00.000Z" });
    // A yearly renewal months away: the quota still resets monthly, on that day.
    expect(usage.periodAt(new Date("2026-11-15T10:00:00Z"), "2027-06-20T08:00:00.000Z")).toEqual({ from: "2026-10-20T08:00:00.000Z", to: "2026-11-20T08:00:00.000Z" });
    // The 31st in a short month lands on its last day.
    expect(usage.periodAt(new Date("2026-02-10T00:00:00Z"), "2026-03-31T00:00:00.000Z")).toEqual({ from: "2026-01-31T00:00:00.000Z", to: "2026-02-28T00:00:00.000Z" });
  });
});

describe("whose limits", () => {
  const ent = (planKey: string | null): Entitlement => ({ planKey, source: planKey ? "subscription" : "free", status: planKey ? "active" : "free", currentPeriodEnd: null, cancelAtPeriodEnd: false });
  it("the held plan's, else the free plan's, else none", async () => {
    const plans = await store.plans.list({});
    expect(usage.limitingPlan(ent("pro"), plans)?.key).toBe("pro");
    expect(usage.limitingPlan(ent(null), plans)?.key).toBe("free");
    expect(usage.limitingPlan(ent(null), plans.filter((p: Plan) => p.key !== "free"))).toBeNull();
  });
});

describe("limits", () => {
  it("a metered limit counts this period's usage and refuses past it", async () => {
    for (let i = 0; i < 3; i++) await usage.requireWithinLimit(me(), "api_calls").then(() => usage.recordUsage(me(), "api_calls", 1));
    await expect(usage.requireWithinLimit(me(), "api_calls")).rejects.toMatchObject({ code: "conflict", details: { reason: "limit_reached", metric: "api_calls", limit: 3, used: 3 } });
    expect(await usage.checkLimit(me(), "api_calls", { adding: 0 })).toMatchObject({ allowed: true, used: 3, limit: 3, plan: "free" });
  });

  it("a count limit uses the count the app passes", async () => {
    await expect(usage.requireWithinLimit(me(), "projects", { current: 0 })).resolves.toMatchObject({ allowed: true, limit: 1 });
    await expect(usage.requireWithinLimit(me(), "projects", { current: 1 })).rejects.toMatchObject({ details: { reason: "limit_reached" } });
  });

  it("a metric the plan doesn't list is unlimited", async () => {
    await usage.recordUsage(me(), "exports", 1_000_000);
    expect(await usage.checkLimit(me(), "exports")).toMatchObject({ allowed: true, limit: null });
  });

  it("recording is idempotent by key, and refuses a bad metric or quantity", async () => {
    expect(await usage.recordUsage(me(), "api_calls", 1, { key: "req_9" })).toEqual({ created: true });
    expect(await usage.recordUsage(me(), "api_calls", 1, { key: "req_9" })).toEqual({ created: false });
    expect((await usage.checkLimit(me(), "api_calls")).used).toBe(1);
    await expect(usage.recordUsage(me(), "API Calls", 1)).rejects.toMatchObject({ code: "invalid" });
    await expect(usage.recordUsage(me(), "api_calls", -2)).rejects.toMatchObject({ code: "invalid" });
  });

  it("summarises this period: every limited or recorded metric", async () => {
    await usage.recordUsage(me(), "api_calls", 2);
    await usage.recordUsage(me(), "exports", 5);
    const s = await usage.usageSummary(me());
    expect(s.plan).toBe("free");
    expect(s.lines).toEqual([
      { metric: "api_calls", used: 2, limit: 3 },
      { metric: "exports", used: 5, limit: null },
      { metric: "projects", used: 0, limit: 1 },
      { metric: "seats", used: 0, limit: 2 },
    ]);
  });
});

describe("with teams on", () => {
  beforeEach(() => {
    vi.stubEnv("OPENSHIPKIT_TENANCY", "org");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  });

  it("the subject is the organisation you're working in, with its own usage", async () => {
    const org = await orgs.createOrg(user, { name: "Acme" });
    cookie.org = org.id;
    expect(await usage.usageSubject(user)).toEqual({ type: "org", id: org.id });
    await usage.recordUsage({ type: "org", id: org.id }, "api_calls", 3);
    expect((await usage.checkLimit({ type: "org", id: org.id }, "api_calls")).allowed).toBe(false);
    expect((await usage.checkLimit(me(), "api_calls")).allowed).toBe(true); // the person's own usage is separate
  });

  it("a plan's seats limit caps invitations on a team with no per-seat subscription", async () => {
    const org = await orgs.createOrg(user, { name: "Acme" });
    await orgs.inviteMember(user, org.id, { email: "one@example.com", role: "member" }); // 2 of 2
    await expect(orgs.inviteMember(user, org.id, { email: "two@example.com", role: "member" })).rejects.toMatchObject({ details: { reason: "no_seats" } });
  });
});

describe("reporting to a metered price", () => {
  beforeEach(() => {
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv("BILLING_METERED_METRICS", "api_calls");
  });

  it("queues one report per event, a repeat included, and sends it to the person's customer", async () => {
    await store.billing.setCustomerId(user.id, "stripe", "cus_u1");
    await usage.recordUsage(me(), "api_calls", 2, { key: "req_1" });
    await usage.recordUsage(me(), "api_calls", 2, { key: "req_1" }); // a retry: no second job
    await usage.recordUsage(me(), "exports", 5); // not metered
    expect((await store.jobs.list({})).items.map((j) => j.kind)).toEqual(["usage.report"]);
    expect(await runDueJobs()).toMatchObject({ succeeded: 1 });
    expect(meter.reports).toEqual([expect.objectContaining({ customerId: "cus_u1", metric: "api_calls", quantity: 2 })]);
  });

  it("sends nothing for an account with no customer (nothing to bill), and the job still succeeds", async () => {
    await usage.recordUsage(me(), "api_calls", 1);
    expect(await runDueJobs()).toMatchObject({ succeeded: 1 });
    expect(meter.reports).toEqual([]);
  });

  it("an organisation's usage goes to the customer of the subscription giving it access, even one set to cancel", async () => {
    vi.stubEnv("OPENSHIPKIT_TENANCY", "org");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
    const org = await orgs.createOrg(user, { name: "Acme" });
    await store.billing.upsertSubscription({
      userId: user.id,
      provider: "stripe",
      providerSubscriptionId: "sub_1",
      providerCustomerId: "cus_payer",
      planKey: "pro",
      interval: "month",
      status: "active",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      cancelAtPeriodEnd: true, // its last period is still billed
      orgId: org.id,
      seats: null,
    });
    await usage.recordUsage({ type: "org", id: org.id }, "api_calls", 4);
    await runDueJobs();
    expect(meter.reports).toEqual([expect.objectContaining({ customerId: "cus_payer", quantity: 4 })]);
  });

  it("queues nothing without metered metrics, or on Razorpay", async () => {
    vi.stubEnv("BILLING_METERED_METRICS", "");
    await usage.recordUsage(me(), "api_calls", 1);
    vi.stubEnv("BILLING_METERED_METRICS", "api_calls");
    vi.stubEnv("BILLING_PROVIDER", "razorpay");
    await usage.recordUsage(me(), "api_calls", 1);
    expect((await store.jobs.list({})).items).toEqual([]);
  });
});

describe("one stored event, one charge", () => {
  beforeEach(() => {
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv("BILLING_METERED_METRICS", "api_calls,tokens");
  });

  it("a key dedupes per metric: one request may record two metrics, and each is billed as stored", async () => {
    await store.billing.setCustomerId(user.id, "stripe", "cus_u1");
    expect(await usage.recordUsage(me(), "api_calls", 1, { key: "req_1" })).toEqual({ created: true });
    expect(await usage.recordUsage(me(), "tokens", 500, { key: "req_1" })).toEqual({ created: true });
    expect((await usage.checkLimit(me(), "tokens", { adding: 0 })).used).toBe(500);
    await runDueJobs();
    expect(meter.reports).toEqual(
      expect.arrayContaining([expect.objectContaining({ metric: "api_calls", quantity: 1 }), expect.objectContaining({ metric: "tokens", quantity: 500 })]),
    );
    expect(meter.reports).toHaveLength(2);
  });

  it("a key reused for a different quantity is refused, not silently kept", async () => {
    await usage.recordUsage(me(), "api_calls", 1, { key: "req_2" });
    await expect(usage.recordUsage(me(), "api_calls", 3, { key: "req_2" })).rejects.toMatchObject({ code: "conflict", details: { reason: "key_reused" } });
  });

  it("an event already reported is never sent again: not on a repeat, a re-queue, or a retried job", async () => {
    await store.billing.setCustomerId(user.id, "stripe", "cus_u1");
    await usage.recordUsage(me(), "api_calls", 2, { key: "req_3" });
    await runDueJobs();
    await usage.recordUsage(me(), "api_calls", 2, { key: "req_3" }); // the caller retries after the report finished
    expect(await usage.sweepUsageReports(Date.now() + 3_600_000)).toBe(0);
    // A job queued again by hand (a retry from /admin/jobs after a first attempt that did reach the provider).
    expect(await store.usage.listPendingReports("2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z", 10)).toEqual([]); // nothing pending any more
    const reported = (await store.jobs.list({})).items[0].payload as { eventId: string };
    await enqueueJob(usageReportJob, { eventId: reported.eventId });
    await runDueJobs();
    expect(meter.reports).toHaveLength(1);
  });

  it("the sweep re-queues an event whose queueing was lost", async () => {
    await store.billing.setCustomerId(user.id, "stripe", "cus_u1");
    // Recorded as pending straight in the store: the insert happened, the queueing didn't.
    await store.usage.record({ subject: me(), metric: "api_calls", quantity: 7, report: true });
    expect(await usage.sweepUsageReports(Date.now())).toBe(0); // too fresh: the normal path may still queue it
    expect(await usage.sweepUsageReports(Date.now() + 10 * 60_000)).toBe(1);
    await runDueJobs();
    expect(meter.reports).toEqual([expect.objectContaining({ quantity: 7 })]);
  });
});

describe("consumeUsage", () => {
  it("checks and records atomically: concurrent calls never pass the limit", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => usage.consumeUsage(me(), "api_calls", 1, { key: `c${i}` })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3); // the free plan allows 3
    expect((await usage.checkLimit(me(), "api_calls", { adding: 0 })).used).toBe(3);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "conflict", details: { reason: "limit_reached", limit: 3 } });
  });

  it("a retried key comes back without a second check or charge", async () => {
    await usage.consumeUsage(me(), "api_calls", 3, { key: "batch" });
    await expect(usage.consumeUsage(me(), "api_calls", 3, { key: "batch" })).resolves.toMatchObject({ created: false });
  });
});

describe("the subscription's own period", () => {
  it("uses the provider's start: a renewal on the 31st doesn't overlap the month before", () => {
    // Period 31 Jan → 28 Feb. From the end alone it would read 28 Jan → 28 Feb.
    expect(usage.periodAt(new Date("2026-02-10T00:00:00Z"), "2026-02-28T00:00:00.000Z", "2026-01-31T00:00:00.000Z")).toEqual({
      from: "2026-01-31T00:00:00.000Z",
      to: "2026-02-28T00:00:00.000Z",
    });
    // A yearly period: still split into months, from the renewal.
    expect(usage.periodAt(new Date("2026-11-15T10:00:00Z"), "2027-06-20T08:00:00.000Z", "2026-06-20T08:00:00.000Z").from).toBe("2026-10-20T08:00:00.000Z");
  });
});

describe("whose limits with teams on", () => {
  beforeEach(() => {
    vi.stubEnv("OPENSHIPKIT_TENANCY", "org");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  });

  it("a person with their own plan, in a team with none, is limited (and billed) by their own plan", async () => {
    const org = await orgs.createOrg(user, { name: "Acme" });
    cookie.org = org.id;
    expect(await usage.usageSubject(user)).toEqual({ type: "org", id: org.id }); // nobody has a plan: the team
    await store.billing.upsertSubscription({
      userId: user.id,
      provider: "stripe",
      providerSubscriptionId: "sub_me",
      providerCustomerId: "cus_me",
      planKey: "pro",
      interval: "month",
      status: "active",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    });
    expect(await usage.usageSubject(user)).toEqual({ type: "user", id: user.id });
    expect(await usage.checkLimit(await usage.usageSubject(user), "api_calls")).toMatchObject({ allowed: true, limit: 1000, plan: "pro" });
  });

  it("an explicit orgId (an API request has no cookie) must be one of theirs", async () => {
    const org = await orgs.createOrg(user, { name: "Acme" });
    expect(await usage.usageSubject(user, { orgId: org.id })).toEqual({ type: "org", id: org.id });
    await expect(usage.usageSubject(user, { orgId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "not_found" });
  });
});
