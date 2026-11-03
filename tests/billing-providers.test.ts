//
// What only one provider does (the shared contract is tests/billing-adapters.test.ts):
//  - Razorpay: cancelling from the app is remembered (Razorpay reports such a
//    subscription as plain "active"); a one-time payment link is granted, and a
//    full refund (which names only the payment) revokes it through the notes we
//    copied onto the payment.
//  - Stripe: a one-time purchase is granted and a full refund revokes it.
// Through the real webhook sink and the memory store.
//

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import type { DataStore } from "@/core/data";
import type { PlanInput, User } from "@/core/types";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

const { createRazorpayProvider } = await import("@/adapters/billing/razorpay");
const { createStripeProvider } = await import("@/adapters/billing/stripe");
const { billingWebhookSink } = await import("@/adapters/billing/webhook-sink");
type RazorpayClient = import("@/adapters/billing/razorpay").RazorpayClient;
type StripeClient = import("@/adapters/billing/stripe").StripeClient;

const PLAN: PlanInput = {
  key: "pro",
  name: "Pro",
  description: "",
  features: [],
  prices: [
    { interval: "month", amountCents: 49900, currency: "inr", polarProductId: null, razorpayPlanId: "plan_pro_month", stripePriceId: "price_pro_month" },
    { interval: "one_time", amountCents: 299900, currency: "inr", polarProductId: null, stripePriceId: "price_pro_once" },
  ],
  highlighted: false,
  contactSales: false,
  ctaLabel: "Buy",
  trialDays: null,
  active: true,
  sortOrder: 1,
};
const SECRET = "rzp_webhook_secret";
const future = Math.floor(Date.now() / 1000) + 20 * 86_400;
let user: User;

beforeEach(async () => {
  store = createMemoryStore({ fresh: true });
  await store.plans.upsert(PLAN);
  user = await store.users.upsertFromIdentity(
    { provider: "better-auth", providerUserId: "u1", email: "u1@example.com", name: "U", image: null, emailVerified: true },
    { makeAdmin: false },
  );
});

function razorpayFake() {
  const sub = { id: "sub_1", status: "active", plan_id: "plan_pro_month", quantity: 1, customer_id: "cust_1", notes: { userId: "", planKey: "pro", productId: "plan_pro_month" }, current_end: future, ended_at: null as number | null };
  const payment = { id: "pay_1", status: "captured", amount: 299900, currency: "INR", customer_id: "cust_1", notes: {} as Record<string, string>, refund_status: null as string | null };
  const client: RazorpayClient = {
    subscriptions: { create: vi.fn(), fetch: vi.fn(async () => ({ ...sub })), cancel: vi.fn(async () => ({ ...sub })) },
    paymentLink: { create: vi.fn(), fetch: vi.fn(async () => ({ id: "plink_1", short_url: "x", status: "paid", payments: [{ payment_id: "pay_1", status: "captured" }] })) },
    payments: {
      fetch: vi.fn(async () => ({ ...payment, notes: { ...payment.notes } })),
      edit: vi.fn(async (_id: string, body: { notes: Record<string, string> }) => {
        payment.notes = body.notes;
      }),
    },
  };
  return { client, sub, payment };
}

const rzpRequest = (event: Record<string, unknown>, id: string) => {
  const body = JSON.stringify(event);
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": createHmac("sha256", SECRET).update(body).digest("hex"), "x-razorpay-event-id": id },
    body,
  });
};

describe("Razorpay", () => {
  it("remembers a cancellation made from the app, though Razorpay still reports the subscription as active", async () => {
    const { client, sub } = razorpayFake();
    sub.notes.userId = user.id;
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    await rzp.handleWebhook(rzpRequest({ event: "subscription.activated", payload: { subscription: { entity: { id: "sub_1" } } } }, "e1"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(false);

    await rzp.cancelAtPeriodEnd!("sub_1");
    expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1", true);
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(true);

    // A later charge event re-fetches "active" with no word of the cancellation: it must stay cancelled.
    await rzp.handleWebhook(rzpRequest({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1" } } } }, "e2"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(true);

    // At the end of the cycle Razorpay cancels it.
    sub.status = "cancelled";
    sub.ended_at = future;
    await rzp.handleWebhook(rzpRequest({ event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_1" } } } }, "e3"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.status).toBe("canceled");
  });

  it("grants a paid payment link, and a full refund (which names only the payment) revokes it", async () => {
    const { client, payment } = razorpayFake();
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    const notes = { userId: user.id, planKey: "pro", productId: "pro:one_time", interval: "one_time" };
    await rzp.handleWebhook(rzpRequest({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1", notes } } } }, "p1"));
    expect(client.payments.edit).toHaveBeenCalledWith("pay_1", { notes });
    const [bought] = (await store.billing.listPurchases({ userId: user.id })).items;
    expect(bought).toMatchObject({ planKey: "pro", refunded: false, amountCents: 299900, currency: "inr" });

    payment.refund_status = "full";
    payment.status = "refunded";
    await rzp.handleWebhook(rzpRequest({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1" } } } }, "p2"));
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(true);
  });

  it("has no portal: the provider says so, and checkout makes a payment link for a one-time price", async () => {
    const { client } = razorpayFake();
    client.paymentLink.create = vi.fn(async () => ({ id: "plink_new", short_url: "https://rzp.io/l/x" }));
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    expect(rzp.hasPortal).toBe(false);
    const plan = (await store.plans.getByKey("pro"))!;
    const { url } = await rzp.createCheckout({ user, plan, price: plan.prices[1], customerId: null, successUrl: "https://example.com/ok", cancelUrl: "https://example.com/no" });
    expect(url).toBe("https://rzp.io/l/x");
    expect(client.paymentLink.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 299900, currency: "INR", notes: expect.objectContaining({ productId: "pro:one_time", userId: user.id }) }));
  });
});

describe("Stripe one-time purchases", () => {
  it("grants on a completed checkout and revokes on a full refund", async () => {
    const pi = {
      id: "pi_1",
      status: "succeeded",
      amount_received: 299900,
      currency: "inr",
      customer: "cus_1",
      metadata: { userId: user.id, planKey: "pro", productId: "price_pro_once" },
      latest_charge: { id: "ch_1", refunded: false },
    };
    const events: unknown[] = [];
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      subscriptions: { retrieve: vi.fn() },
      paymentIntents: { retrieve: vi.fn(async () => structuredClone(pi)) },
      webhooks: { constructEventAsync: vi.fn(async (payload: string) => JSON.parse(payload)) },
    } as unknown as StripeClient;
    const stripe = createStripeProvider({ client, webhookSecret: "whsec_x", sink: billingWebhookSink });
    const deliver = (event: Record<string, unknown>) => {
      events.push(event);
      return stripe.handleWebhook(new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": "t=1,v1=ok" }, body: JSON.stringify(event) }));
    };
    await deliver({ id: "evt_1", type: "checkout.session.completed", data: { object: { mode: "payment", payment_intent: "pi_1" } } });
    expect((await store.billing.listPurchases({ userId: user.id })).items[0]).toMatchObject({ planKey: "pro", refunded: false });
    pi.latest_charge.refunded = true;
    await deliver({ id: "evt_2", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1" } } });
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(true);
  });
});
