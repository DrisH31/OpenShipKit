//
// The billing adapter contract (ROADMAP 3.3): every provider OpenShipKit ships
// (Polar, Stripe, Razorpay) passes the same scenarios, with its webhooks signed
// for real and its API faked:
//
//  - a bad signature is refused (403) and nothing reaches the sink;
//  - a signed subscription event re-fetches the subscription and hands the sink
//    what the provider says NOW: who, which product, which team, how many seats,
//    its status and period;
//  - the event id is claimed only after the write, and a failed re-fetch claims
//    nothing (so the provider retries);
//  - checkout carries who it's for, the plan, the product sold, the team and the seats;
//  - an event it doesn't handle is acknowledged (2xx), not refused.
//
// A new adapter passes when it has a harness here and this file passes.
//

import { createHmac, randomBytes } from "node:crypto";
import Stripe from "stripe";
import { Webhook } from "standardwebhooks";
import { describe, expect, it, vi } from "vitest";
import { createPolarProvider, type PolarClient } from "@/adapters/billing/polar";
import { createRazorpayProvider, type RazorpayClient, type RazorpaySubscription } from "@/adapters/billing/razorpay";
import { createStripeProvider, type StripeClient } from "@/adapters/billing/stripe";
import type { BillingWebhookSink, ProviderSubscriptionState } from "@/adapters/billing/shared";
import type { BillingProvider } from "@/core/billing";
import type { Plan, PlanPrice, User } from "@/core/types";

vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

const USER: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "buyer@example.com",
  name: "Buyer",
  image: null,
  role: "user",
  banned: false,
  authProvider: "better-auth",
  authProviderUserId: "ba_1",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: null,
};
const ORG = "22222222-2222-4222-8222-222222222222";
const PERIOD_END_UNIX = Math.floor(Date.UTC(2031, 0, 2, 3, 4, 5) / 1000);
const PERIOD_END = new Date(PERIOD_END_UNIX * 1000).toISOString();
const PERIOD_START_UNIX = Math.floor(Date.UTC(2030, 11, 2, 3, 4, 5) / 1000);
const PERIOD_START = new Date(PERIOD_START_UNIX * 1000).toISOString();

/** What a checkout sold, the way our checkout writes it into the provider's metadata. */
type Sold = { userId: string; planKey: string; productId: string; orgId?: string; seats: number };

/** The facts every adapter must hand the sink for an active, renewing subscription to a team. */
const EXPECTED = { userId: USER.id, planKey: "team", orgId: ORG, seats: 4 };

interface Harness {
  name: "polar" | "stripe" | "razorpay";
  /** The product id this provider sells the plan's monthly price as. */
  productId: string;
  make(sink: BillingWebhookSink): { provider: BillingProvider; putSubscription(id: string): void; failFetches(): void; lastCheckout(): Sold | null };
  /** A signed delivery of "subscription `id` changed". */
  subscriptionEvent(id: string, eventId: string): Request;
  /** The same, with the wrong secret. */
  forged(id: string, eventId: string): Request;
  /** A signed event type the adapter doesn't handle. */
  otherEvent(eventId: string): Request;
}

function recordingSink() {
  const applied: ProviderSubscriptionState[] = [];
  const claimed: string[] = [];
  const sink: BillingWebhookSink = {
    applySubscription: vi.fn(async (state) => {
      applied.push(state);
      return "applied" as const;
    }),
    applyOrder: vi.fn(async () => "applied" as const),
    markEventProcessed: vi.fn(async (_provider, id) => {
      claimed.push(id);
      return true;
    }),
  };
  return { sink, applied, claimed };
}

const PLAN = (productIds: Partial<PlanPrice>): Plan =>
  ({
    id: "p1",
    key: "team",
    name: "Team",
    description: "",
    features: [],
    prices: [{ interval: "month", amountCents: 1000, currency: "usd", polarProductId: null, perSeat: true, ...productIds }],
    highlighted: false,
    contactSales: false,
    ctaLabel: "Buy",
    trialDays: null,
    active: true,
    sortOrder: 1, limits: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as Plan;

// ---------------------------------------------------------------- Polar

const polarSecret = `whsec_${randomBytes(24).toString("base64")}`;
function polarRequest(type: string, data: Record<string, unknown>, eventId: string, secret = polarSecret): Request {
  const body = JSON.stringify({ type, timestamp: new Date().toISOString(), api_version: "2026-10", data });
  const now = new Date();
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "webhook-id": eventId, "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": new Webhook(secret).sign(eventId, now, body) },
    body,
  });
}

const polar: Harness = {
  name: "polar",
  productId: "polar_team_month",
  make(sink) {
    const subs = new Map<string, unknown>();
    let fail = false;
    let last: Sold | null = null;
    const client = {
      checkouts: {
        create: vi.fn(async (body: { metadata?: Record<string, string>; seats?: number }) => {
          last = { userId: body.metadata!.userId, planKey: body.metadata!.planKey, productId: body.metadata!.productId, orgId: body.metadata!.orgId, seats: body.seats ?? 1 };
          return { url: "https://polar.example.com/checkout" };
        }),
      },
      customerSessions: { create: vi.fn(async () => ({ customer_portal_url: "https://polar.example.com/portal" })) },
      subscriptions: {
        get: vi.fn(async (id: string) => {
          if (fail) throw new Error("down");
          return subs.get(id);
        }),
      },
      orders: { get: vi.fn() },
    } as unknown as PolarClient;
    return {
      provider: createPolarProvider({ client, webhookSecret: polarSecret, sink }),
      putSubscription: (id) =>
        subs.set(id, {
          id,
          status: "active",
          product_id: "polar_team_month",
          customer_id: "pcus_1",
          recurring_interval: "month",
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          cancel_at_period_end: false,
          ended_at: null,
          seats: 4,
          metadata: { userId: USER.id, planKey: "team", productId: "polar_team_month", orgId: ORG },
          customer: { id: "pcus_1", external_id: USER.id },
        }),
      failFetches: () => {
        fail = true;
      },
      lastCheckout: () => last,
    };
  },
  subscriptionEvent: (id, eventId) => polarRequest("subscription.updated", { id }, eventId),
  forged: (id, eventId) => polarRequest("subscription.updated", { id }, eventId, `whsec_${randomBytes(24).toString("base64")}`),
  otherEvent: (eventId) => polarRequest("checkout.created", { id: "co_1" }, eventId),
};

// ---------------------------------------------------------------- Stripe

const stripeSecret = "whsec_test_stripe_contract";
const realStripe = new Stripe("sk_test_contract_no_network");
function stripeRequest(event: Record<string, unknown>, secret = stripeSecret): Request {
  const payload = JSON.stringify(event);
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/billing/webhook", { method: "POST", headers: { "stripe-signature": header }, body: payload });
}

const stripe: Harness = {
  name: "stripe",
  productId: "price_team_month",
  make(sink) {
    const subs = new Map<string, unknown>();
    let fail = false;
    let last: Sold | null = null;
    const client = {
      checkout: {
        sessions: {
          create: vi.fn(async (p: Stripe.Checkout.SessionCreateParams) => {
            const meta = p.subscription_data?.metadata ?? p.payment_intent_data?.metadata ?? {};
            last = { userId: String(meta.userId), planKey: String(meta.planKey), productId: String(meta.productId), orgId: meta.orgId ? String(meta.orgId) : undefined, seats: p.line_items?.[0]?.quantity ?? 1 };
            return { url: "https://checkout.stripe.com/c/x" };
          }),
        },
      },
      billingPortal: { sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.com/p/x" })) } },
      subscriptions: {
        retrieve: vi.fn(async (id: string) => {
          if (fail) throw new Error("down");
          return subs.get(id);
        }),
      },
      paymentIntents: { retrieve: vi.fn() },
      // The SDK's real verification: no network involved.
      webhooks: { constructEventAsync: (payload: string, header: string, secret: string) => realStripe.webhooks.constructEventAsync(payload, header, secret) },
    } as unknown as StripeClient;
    return {
      provider: createStripeProvider({ client, webhookSecret: stripeSecret, sink }),
      putSubscription: (id) =>
        subs.set(id, {
          id,
          status: "active",
          customer: "cus_1",
          cancel_at_period_end: false,
          cancel_at: null,
          ended_at: null,
          metadata: { userId: USER.id, planKey: "team", productId: "price_team_month", orgId: ORG },
          items: { data: [{ quantity: 4, current_period_start: PERIOD_START_UNIX, current_period_end: PERIOD_END_UNIX, price: { id: "price_team_month", recurring: { interval: "month" } } }] },
        }),
      failFetches: () => {
        fail = true;
      },
      lastCheckout: () => last,
    };
  },
  subscriptionEvent: (id, eventId) => stripeRequest({ id: eventId, object: "event", type: "customer.subscription.updated", data: { object: { id, object: "subscription" } } }),
  forged: (id, eventId) => stripeRequest({ id: eventId, object: "event", type: "customer.subscription.updated", data: { object: { id } } }, "whsec_wrong"),
  otherEvent: (eventId) => stripeRequest({ id: eventId, object: "event", type: "invoice.created", data: { object: { id: "in_1" } } }),
};

// ---------------------------------------------------------------- Razorpay

const razorpaySecret = "razorpay_contract_secret";
function razorpayRequest(event: Record<string, unknown>, eventId: string, secret = razorpaySecret): Request {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("http://localhost/api/billing/webhook", { method: "POST", headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId }, body });
}

const razorpay: Harness = {
  name: "razorpay",
  productId: "plan_team_month",
  make(sink) {
    const subs = new Map<string, RazorpaySubscription>();
    let fail = false;
    let last: Sold | null = null;
    const client: RazorpayClient = {
      disputes: { fetch: vi.fn() },
      plans: { fetch: vi.fn() },
      subscriptions: {
        create: vi.fn(async (body: Record<string, unknown>) => {
          const notes = body.notes as Record<string, string>;
          last = { userId: notes.userId, planKey: notes.planKey, productId: notes.productId, orgId: notes.orgId, seats: Number(body.quantity ?? 1) };
          return { id: "sub_new", short_url: "https://rzp.io/i/x" };
        }),
        fetch: vi.fn(async (id: string) => {
          if (fail) throw new Error("down");
          return subs.get(id)!;
        }),
        cancel: vi.fn(),
      },
      paymentLink: { create: vi.fn(), fetch: vi.fn() },
      payments: { fetch: vi.fn(), edit: vi.fn() },
    };
    return {
      provider: createRazorpayProvider({ client, webhookSecret: razorpaySecret, sink }),
      putSubscription: (id) =>
        subs.set(id, {
          id,
          status: "active",
          plan_id: "plan_team_month",
          quantity: 4,
          customer_id: "cust_1",
          notes: { userId: USER.id, planKey: "team", productId: "plan_team_month", orgId: ORG },
          current_start: PERIOD_START_UNIX,
          current_end: PERIOD_END_UNIX,
          ended_at: null,
        }),
      failFetches: () => {
        fail = true;
      },
      lastCheckout: () => last,
    };
  },
  subscriptionEvent: (id, eventId) => razorpayRequest({ event: "subscription.charged", payload: { subscription: { entity: { id } } } }, eventId),
  forged: (id, eventId) => razorpayRequest({ event: "subscription.charged", payload: { subscription: { entity: { id } } } }, eventId, "wrong"),
  otherEvent: (eventId) => razorpayRequest({ event: "order.paid", payload: {} }, eventId),
};

// ---------------------------------------------------------------- the contract

describe.each([polar, stripe, razorpay])("billing adapter contract: $name", (h) => {
  it("refuses a bad signature, and nothing reaches the sink", async () => {
    const { sink, applied, claimed } = recordingSink();
    const a = h.make(sink);
    a.putSubscription("sub_1");
    const res = await a.provider.handleWebhook(h.forged("sub_1", "evt_forged"));
    expect(res.status).toBe(403);
    expect(applied).toEqual([]);
    expect(claimed).toEqual([]);
  });

  it("re-fetches the subscription and hands the sink who, what, which team and how many seats", async () => {
    const { sink, applied, claimed } = recordingSink();
    const a = h.make(sink);
    a.putSubscription("sub_1");
    const res = await a.provider.handleWebhook(h.subscriptionEvent("sub_1", "evt_1"));
    expect(res.status).toBe(200);
    expect(applied).toHaveLength(1);
    const state = applied[0];
    expect(state).toMatchObject({
      provider: h.name,
      providerSubscriptionId: "sub_1",
      productId: h.productId,
      planKeyHint: EXPECTED.planKey,
      checkoutProductId: h.productId,
      orgIdHint: EXPECTED.orgId,
      seats: EXPECTED.seats,
      status: "active",
      cancelAtPeriodEnd: false,
    });
    expect(state.userIdHints).toContain(EXPECTED.userId);
    expect(Date.parse(state.currentPeriodEnd!)).toBe(Date.parse(PERIOD_END));
    expect(Date.parse(state.currentPeriodStart!)).toBe(Date.parse(PERIOD_START)); // the usage period's start
    expect(claimed).toEqual(["evt_1"]); // claimed, and only after the write
  });

  it("claims nothing when the re-fetch fails, so the provider retries", async () => {
    const { sink, claimed } = recordingSink();
    const a = h.make(sink);
    a.putSubscription("sub_1");
    a.failFetches();
    const res = await a.provider.handleWebhook(h.subscriptionEvent("sub_1", "evt_2"));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(claimed).toEqual([]);
  });

  it("acknowledges an event it doesn't handle", async () => {
    const { sink, applied } = recordingSink();
    const res = await h.make(sink).provider.handleWebhook(h.otherEvent("evt_3"));
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(applied).toEqual([]);
  });

  it("checkout carries who it's for, the plan, the product sold, the team and the seats", async () => {
    const { sink } = recordingSink();
    const a = h.make(sink);
    const field = { polar: "polarProductId", stripe: "stripePriceId", razorpay: "razorpayPlanId" }[h.name];
    const plan = PLAN({ [field]: h.productId });
    const { url } = await a.provider.createCheckout({
      user: USER,
      plan,
      price: plan.prices[0],
      customerId: null,
      orgId: ORG,
      seats: 4,
      successUrl: "https://example.com/dashboard/billing?checkout=success",
      cancelUrl: "https://example.com/pricing",
    });
    expect(url).toMatch(/^https:\/\//);
    expect(a.lastCheckout()).toEqual({ userId: USER.id, planKey: "team", productId: h.productId, orgId: ORG, seats: 4 });
  });
});

describe("reporting usage to a metered price", () => {
  const report = { id: "evt-1", customerId: "cus_9", metric: "api_calls", quantity: 3, occurredAt: "2026-11-03T10:00:00.000Z" };

  it("Polar: one event named after the metric, our id as external_id, the quantity in metadata", async () => {
    const ingest = vi.fn(async () => ({ inserted: 1 }));
    await createPolarProvider({ client: { events: { ingest } } as unknown as PolarClient, webhookSecret: polarSecret }).reportUsage!(report);
    expect(ingest).toHaveBeenCalledWith({ events: [{ name: "api_calls", customer_id: "cus_9", external_id: "evt-1", timestamp: report.occurredAt, metadata: { quantity: 3 } }] });
  });

  it("Stripe: a meter event with our id as identifier and idempotency key, the value as a string", async () => {
    const create = vi.fn(async () => ({}));
    await createStripeProvider({ client: { billing: { meterEvents: { create } } } as unknown as StripeClient, webhookSecret: stripeSecret }).reportUsage!(report);
    expect(create).toHaveBeenCalledWith(
      { event_name: "api_calls", identifier: "evt-1", timestamp: Math.floor(Date.parse(report.occurredAt) / 1000), payload: { stripe_customer_id: "cus_9", value: "3" } },
      { idempotencyKey: "usage-evt-1" },
    );
  });

  it("Razorpay has no meters", () => {
    expect(razorpay.make(recordingSink().sink).provider.reportUsage).toBeUndefined();
  });
});

describe("what a provider charges for a price id", () => {
  it("Stripe: amount, currency, interval; one-time when not recurring; null for an unknown id", async () => {
    const retrieve = vi.fn(async (id: string) => {
      if (id === "missing") throw Object.assign(new Error("No such price"), { statusCode: 404 });
      if (id === "price_q") return { unit_amount: 5700, currency: "usd", recurring: { interval: "month", interval_count: 3 } };
      return id === "price_y" ? { unit_amount: 19000, currency: "usd", recurring: { interval: "year", interval_count: 1 } } : { unit_amount: 29900, currency: "usd", recurring: null };
    });
    const p = createStripeProvider({ client: { prices: { retrieve } } as unknown as StripeClient, webhookSecret: stripeSecret });
    expect(await p.describePrice!("price_y")).toEqual({ amountCents: 19000, currency: "usd", interval: "year" });
    expect(await p.describePrice!("price_once")).toEqual({ amountCents: 29900, currency: "usd", interval: "one_time" });
    expect(await p.describePrice!("missing")).toBeNull();
    expect((await p.describePrice!("price_q"))?.interval).toBe("other"); // every 3 months
  });

  it("Polar: the product's fixed price and recurrence", async () => {
    const get = vi.fn(async () => ({ is_recurring: true, recurring_interval: "month", recurring_interval_count: 1, prices: [{ amount_type: "fixed", is_archived: false, price_amount: 1900, price_currency: "usd" }] }));
    const p = createPolarProvider({ client: { products: { get } } as unknown as PolarClient, webhookSecret: polarSecret });
    expect(await p.describePrice!("prod_1")).toEqual({ amountCents: 1900, currency: "usd", interval: "month" });
  });

  it("Razorpay: the plan's item and period; another schedule is \"other\"", async () => {
    const fetch = vi.fn(async () => ({ id: "plan_1", period: "yearly", interval: 1, item: { amount: 499900, currency: "INR" } }));
    const client = { plans: { fetch } } as unknown as RazorpayClient;
    const p = createRazorpayProvider({ client, webhookSecret: "x" });
    expect(await p.describePrice!("plan_1")).toEqual({ amountCents: 499900, currency: "INR", interval: "year" });
    fetch.mockResolvedValueOnce({ id: "plan_q", period: "monthly", interval: 3, item: { amount: 99900, currency: "INR" } });
    expect((await p.describePrice!("plan_q"))?.interval).toBe("other"); // every 3 months
  });
});
