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
const { runDueJobs } = await import("@/server/jobs");

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

  it("an organisation's usage goes to the customer paying its renewing subscription", async () => {
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
      cancelAtPeriodEnd: false,
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
