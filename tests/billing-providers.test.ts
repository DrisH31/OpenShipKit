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
import { isRenewing } from "@/core/types";
import { createMemoryStore } from "@/adapters/data/memory";
import type { DataStore } from "@/core/data";
import type { PlanInput, User } from "@/core/types";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

const { createRazorpayProvider, razorpaySubscriptionState } = await import("@/adapters/billing/razorpay");
import type { RazorpaySubscription } from "@/adapters/billing/razorpay";
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
  const dispute = { id: "disp_1", payment_id: "pay_1", status: "open" };
  const client: RazorpayClient = {
    disputes: { fetch: vi.fn(async () => ({ ...dispute })) },
    plans: { fetch: vi.fn() },
    subscriptions: { create: vi.fn(), fetch: vi.fn(async () => ({ ...sub })), cancel: vi.fn(async () => ({ ...sub })) },
    paymentLink: { create: vi.fn(), fetch: vi.fn(async () => ({ id: "plink_1", short_url: "x", status: "paid", payments: [{ payment_id: "pay_1", status: "captured" }] })) },
    payments: {
      fetch: vi.fn(async () => ({ ...payment, notes: { ...payment.notes } })),
      edit: vi.fn(async (_id: string, body: { notes: Record<string, string> }) => {
        payment.notes = body.notes;
      }),
    },
  };
  return { client, sub, payment, dispute };
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

    await rzp.cancelAtPeriodEnd!("sub_1", { type: "user", id: user.id, label: user.email });
    expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1", true);
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(true);
    // Audited once, as the person who pressed it.
    const audit = (await store.audit.list({ entity: "subscription", limit: 10 })).items.filter((e) => e.action === "subscription.update");
    expect(audit.map((e) => e.actor.label)).toEqual([user.email]);

    // A later charge event re-fetches "active" with no word of the cancellation: it must stay cancelled.
    await rzp.handleWebhook(rzpRequest({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1" } } } }, "e2"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(true);

    // At the end of the cycle Razorpay cancels it.
    sub.status = "cancelled";
    sub.ended_at = future;
    await rzp.handleWebhook(rzpRequest({ event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_1" } } } }, "e3"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.status).toBe("canceled");
  });

  // Razorpay's documented cancel errors, word for word:
  // https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription (Errors)
  const NO_CYCLE = { statusCode: 400, error: { code: "BAD_REQUEST_ERROR", description: "Subscription cannot be cancelled since no billing cycle is going on" } };

  const activate = async (rzp: ReturnType<typeof createRazorpayProvider>, id: string) =>
    rzp.handleWebhook(rzpRequest({ event: "subscription.activated", payload: { subscription: { entity: { id: "sub_1" } } } }, id));
  const me = () => ({ type: "user" as const, id: user.id, label: user.email });

  it("a cancel with no answer reads as ending, until Razorpay charges again: then it renews, and Cancel is back", async () => {
    const { client, sub } = razorpayFake();
    sub.notes.userId = user.id;
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    await activate(rzp, "n1");
    (client.subscriptions.cancel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("Gateway Timeout"), { statusCode: 504 }));
    await expect(rzp.cancelAtPeriodEnd!("sub_1", me())).rejects.toMatchObject({ name: "BillingProviderError", kind: "no_answer" });
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(true);

    // A charge event within the same period keeps it ending.
    await rzp.handleWebhook(rzpRequest({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1" } } } }, "n2"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(true);

    // The cancel never landed: Razorpay renews into a new period. The row renews again.
    sub.current_end = sub.current_end + 30 * 86_400;
    await rzp.handleWebhook(rzpRequest({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1" } } } }, "n3"));
    const row = (await store.billing.getSubscription("razorpay", "sub_1"))!;
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(isRenewing(row)).toBe(true); // so the billing page offers Cancel again
  });

  it("a refusal puts the row back and says Razorpay's reason", async () => {
    const { client, sub } = razorpayFake();
    sub.notes.userId = user.id;
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    await activate(rzp, "r1");
    (client.subscriptions.cancel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(NO_CYCLE);
    await expect(rzp.cancelAtPeriodEnd!("sub_1", me())).rejects.toMatchObject({ kind: "refused", message: expect.stringContaining("no billing cycle is going on") });
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(false);
  });

  it("two presses at once: one reaches Razorpay, the other stops before it", async () => {
    const { client, sub } = razorpayFake();
    sub.notes.userId = user.id;
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    await activate(rzp, "d1");
    const results = await Promise.allSettled([rzp.cancelAtPeriodEnd!("sub_1", me()), rzp.cancelAtPeriodEnd!("sub_1", me())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ kind: "conflict" });
    expect(client.subscriptions.cancel).toHaveBeenCalledTimes(1);
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.cancelAtPeriodEnd).toBe(true);
  });

  it("a trial is cancelled at Razorpay now (no first charge) and keeps its access until the trial's end", async () => {
    const { client, sub } = razorpayFake();
    sub.notes.userId = user.id;
    const startAt = Math.floor(Date.now() / 1000) + 14 * 86_400;
    Object.assign(sub, { status: "authenticated", start_at: startAt, current_end: null, current_start: null, paid_count: 0 });
    const cancel = client.subscriptions.cancel as ReturnType<typeof vi.fn>;
    // Razorpay: a cycle-end cancel of an authenticated subscription is refused; an immediate one cancels it.
    cancel.mockImplementation(async (_id: string, atCycleEnd: boolean) => {
      if (atCycleEnd) throw NO_CYCLE;
      sub.status = "cancelled";
      sub.ended_at = Math.floor(Date.now() / 1000);
      return { ...sub };
    });
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    await rzp.handleWebhook(rzpRequest({ event: "subscription.authenticated", payload: { subscription: { entity: { id: "sub_1" } } } }, "t1"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))?.status).toBe("trialing");

    await rzp.cancelAtPeriodEnd!("sub_1", me());
    expect(cancel).toHaveBeenCalledWith("sub_1", false);
    const row = (await store.billing.getSubscription("razorpay", "sub_1"))!;
    expect(row).toMatchObject({ status: "trialing", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(startAt * 1000).toISOString() });
    // Razorpay's cancelled webhook re-fetches the same object: the trial still runs to its end.
    await rzp.handleWebhook(rzpRequest({ event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_1" } } } }, "t2"));
    expect((await store.billing.getSubscription("razorpay", "sub_1"))).toMatchObject({ status: "trialing", cancelAtPeriodEnd: true });
  });

  it("authenticated without a later start is not a trial: no access until the first charge", () => {
    const base = { id: "sub_x", status: "authenticated", plan_id: "plan_1", customer_id: "c", notes: {}, quantity: 1, current_end: null, ended_at: null } as unknown as RazorpaySubscription;
    const now = Date.parse("2026-11-03T00:00:00Z");
    expect(razorpaySubscriptionState({ ...base, start_at: null } as unknown as RazorpaySubscription, now).status).toBe("incomplete");
    expect(razorpaySubscriptionState({ ...base, start_at: now / 1000 - 60 } as unknown as RazorpaySubscription, now).status).toBe("incomplete");
    const trial = razorpaySubscriptionState({ ...base, start_at: now / 1000 + 14 * 86_400 } as unknown as RazorpaySubscription, now);
    expect(trial).toMatchObject({ status: "trialing", currentPeriodEnd: new Date(now + 14 * 86_400_000).toISOString() });
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

  it("a lost chargeback revokes a purchase, a dispute still open doesn't, and a later re-sync can't hand it back", async () => {
    const { client, payment, dispute } = razorpayFake();
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    const notes = { userId: user.id, planKey: "pro", productId: "pro:one_time", interval: "one_time" };
    await rzp.handleWebhook(rzpRequest({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1", notes } } } }, "d1"));
    const lost = (id: string) => rzpRequest({ event: "payment.dispute.lost", payload: { dispute: { entity: { id: "disp_1" } } } }, id);

    await rzp.handleWebhook(lost("d2")); // the re-fetch says it's still open: the event decides nothing
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(false);

    dispute.status = "lost";
    await rzp.handleWebhook(lost("d3"));
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(true);

    // A partial refund event later re-fetches a payment that says nothing of the dispute: still revoked.
    payment.refund_status = "partial";
    await rzp.handleWebhook(rzpRequest({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_2", payment_id: "pay_1" } } } }, "d4"));
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(true);
  });

  it("a refund that failed (refund.failed) gives a purchase's access back", async () => {
    const { client, payment } = razorpayFake();
    const rzp = createRazorpayProvider({ client, webhookSecret: SECRET, sink: billingWebhookSink });
    const notes = { userId: user.id, planKey: "pro", productId: "pro:one_time", interval: "one_time" };
    await rzp.handleWebhook(rzpRequest({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1", notes } } } }, "rf1"));
    payment.refund_status = "full";
    payment.status = "refunded";
    await rzp.handleWebhook(rzpRequest({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1" } } } }, "rf2"));
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(true);
    payment.refund_status = null;
    payment.status = "captured";
    await rzp.handleWebhook(rzpRequest({ event: "refund.failed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", status: "failed" } } } }, "rf3"));
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(false);
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

describe("seats", () => {
  it("a quantity is stored as seats only on a per-seat price, matched by product or kept by checkout's plan key", async () => {
    const subs: Record<string, unknown> = {};
    const client = {
      subscriptions: { retrieve: vi.fn(async (id: string) => subs[id]) },
      webhooks: { constructEventAsync: vi.fn(async (payload: string) => JSON.parse(payload)) },
    } as unknown as StripeClient;
    const stripe = createStripeProvider({ client, webhookSecret: "whsec_x", sink: billingWebhookSink });
    const put = (id: string, price: string) => {
      subs[id] = {
        id,
        status: "active",
        customer: "cus_1",
        cancel_at_period_end: false,
        cancel_at: null,
        ended_at: null,
        metadata: { userId: user.id, planKey: "pro", productId: price },
        items: { data: [{ quantity: 3, current_period_end: 4102444800, price: { id: price, recurring: { interval: "month" } } }] },
      };
      return stripe.handleWebhook(
        new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": "t=1,v1=ok" }, body: JSON.stringify({ id: `evt_${id}`, type: "customer.subscription.updated", data: { object: { id } } }) }),
      );
    };
    await put("sub_a", "price_pro_month"); // matched, not per seat
    await put("sub_b", "price_retired"); // matches no plan now; checkout's plan key keeps it on pro, still not per seat
    expect((await store.billing.getSubscription("stripe", "sub_a"))).toMatchObject({ planKey: "pro", seats: null });
    expect((await store.billing.getSubscription("stripe", "sub_b"))).toMatchObject({ planKey: "pro", seats: null });

    // The same plan sold per seat: the quantity is the seat count.
    const plan = (await store.plans.getByKey("pro"))!;
    await store.plans.upsert({ ...plan, prices: plan.prices.map((p) => (p.interval === "month" ? { ...p, perSeat: true } : p)) });
    await put("sub_c", "price_pro_month");
    await put("sub_d", "price_retired");
    expect((await store.billing.getSubscription("stripe", "sub_c"))?.seats).toBe(3);
    expect((await store.billing.getSubscription("stripe", "sub_d"))?.seats).toBe(3);
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
  it("a lost chargeback (re-fetched) revokes a purchase; a won one doesn't", async () => {
    const pi = {
      id: "pi_2",
      status: "succeeded",
      amount_received: 299900,
      currency: "inr",
      customer: "cus_1",
      metadata: { userId: user.id, planKey: "pro", productId: "price_pro_once" },
      latest_charge: { id: "ch_2", refunded: false },
    };
    const dispute = { id: "dp_1", status: "won", payment_intent: "pi_2" };
    const client = {
      paymentIntents: { retrieve: vi.fn(async () => structuredClone(pi)) },
      disputes: { retrieve: vi.fn(async () => ({ ...dispute })) },
      webhooks: { constructEventAsync: vi.fn(async (payload: string) => JSON.parse(payload)) },
    } as unknown as StripeClient;
    const stripe = createStripeProvider({ client, webhookSecret: "whsec_x", sink: billingWebhookSink });
    const deliver = (event: Record<string, unknown>) =>
      stripe.handleWebhook(new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": "t=1,v1=ok" }, body: JSON.stringify(event) }));
    await deliver({ id: "evt_a", type: "checkout.session.completed", data: { object: { mode: "payment", payment_intent: "pi_2" } } });
    const closed = (id: string) => deliver({ id, type: "charge.dispute.closed", data: { object: { id: "dp_1", status: "lost", payment_intent: "pi_2" } } });

    await closed("evt_b"); // the event says lost; Stripe says won
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(false);
    dispute.status = "lost";
    await closed("evt_c");
    expect((await store.billing.listPurchases({ userId: user.id })).items[0]).toMatchObject({ refunded: true, chargedBack: true });
    // A later refund event re-fetches a charge that says "not refunded": the chargeback still stands.
    await deliver({ id: "evt_d", type: "charge.refunded", data: { object: { id: "ch_2", payment_intent: "pi_2" } } });
    expect((await store.billing.listPurchases({ userId: user.id })).items[0]).toMatchObject({ refunded: true, chargedBack: true });
  });

  it("a refund follows Stripe: one that failed (the charge no longer refunded) gives the access back", async () => {
    const pi = {
      id: "pi_3",
      status: "succeeded",
      amount_received: 299900,
      currency: "inr",
      customer: "cus_1",
      metadata: { userId: user.id, planKey: "pro", productId: "price_pro_once" },
      latest_charge: { id: "ch_3", refunded: true },
    };
    const client = {
      paymentIntents: { retrieve: vi.fn(async () => structuredClone(pi)) },
      webhooks: { constructEventAsync: vi.fn(async (payload: string) => JSON.parse(payload)) },
    } as unknown as StripeClient;
    const stripe = createStripeProvider({ client, webhookSecret: "whsec_x", sink: billingWebhookSink });
    const deliver = (id: string, type: string, object: Record<string, unknown>) =>
      stripe.handleWebhook(new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": "t=1,v1=ok" }, body: JSON.stringify({ id, type, data: { object } }) }));
    await deliver("evt_r1", "charge.refunded", { id: "ch_3", object: "charge", payment_intent: "pi_3" });
    expect((await store.billing.listPurchases({ userId: user.id })).items[0].refunded).toBe(true);
    // The refund fails: Stripe puts the money back with the merchant and sends refund.failed, naming the refund.
    pi.latest_charge.refunded = false;
    await deliver("evt_r2", "refund.failed", { id: "re_1", object: "refund", status: "failed", charge: "ch_3", payment_intent: "pi_3" });
    expect((await store.billing.listPurchases({ userId: user.id })).items[0]).toMatchObject({ refunded: false, chargedBack: false });
  });

  it("a one-time checkout made free by a promotion code (no payment intent) is granted from the re-fetched session", async () => {
    const session = {
      id: "cs_free",
      mode: "payment",
      status: "complete",
      payment_status: "no_payment_required",
      payment_intent: null,
      customer: "cus_1",
      client_reference_id: user.id,
      amount_total: 0,
      currency: "inr",
      metadata: { userId: user.id, planKey: "pro", productId: "price_pro_once", interval: "one_time" },
    };
    const retrieve = vi.fn(async () => ({ ...session }));
    const client = {
      checkout: { sessions: { create: vi.fn(), retrieve } },
      webhooks: { constructEventAsync: async (body: string) => JSON.parse(body) },
    } as unknown as StripeClient;
    const stripe = createStripeProvider({ client, webhookSecret: "whsec_x", sink: billingWebhookSink });
    const deliver = (id: string, sessionId: string) =>
      stripe.handleWebhook(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "stripe-signature": "t=1,v1=ok" },
          // The event's own copy claims nothing we trust: the state comes from the retrieve.
          body: JSON.stringify({ id, type: "checkout.session.completed", data: { object: { id: sessionId, mode: "payment", payment_status: "no_payment_required" } } }),
        }),
      );
    expect((await deliver("evt_free", "cs_free")).status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith("cs_free");
    expect((await store.billing.listPurchases({ userId: user.id })).items[0]).toMatchObject({ planKey: "pro", providerOrderId: "cs_free", amountCents: 0, refunded: false });

    // Not complete at Stripe: nothing.
    retrieve.mockResolvedValueOnce({ ...session, id: "cs_open", status: "open" });
    await deliver("evt_open", "cs_open");
    expect((await store.billing.listPurchases({ userId: user.id })).items).toHaveLength(1);
  });
});
