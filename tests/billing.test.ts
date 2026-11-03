//
// Billing: entitlement rules, Polar webhooks end to end against a fresh
// in-memory DataStore with REAL Standard Webhooks signatures and a faked API
// for the re-fetches, and the checkout / portal / webhook routes.
//
// What must hold: a valid signature applies; a bad one is 403 and writes
// nothing; a redelivery changes nothing; an older event arriving late can't
// regress state (we re-fetch the canonical object); a failure after
// verification is a 500 that the retry then completes; unrelated events are 202.
// The adapter only hands state to its sink; the redelivery rules also run on
// PGlite, whose timestamps don't round-trip as the strings Polar sent.
//

import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Webhook } from "standardwebhooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import { createPostgresStore } from "@/adapters/data/postgres";
import { drizzleOverPglite } from "@/adapters/data/postgres/db";
import { migrateEmbedded } from "@/adapters/data/postgres/embedded";
import { createPolarProvider, type PolarClient } from "@/adapters/billing/polar";
import type { BillingWebhookSink, ProviderOrderState, ProviderSubscriptionState } from "@/adapters/billing/shared";
import { normalizeInstant, sameInstant } from "@/adapters/billing/webhook-sink";
import { POST as checkoutRoute } from "@/app/api/billing/checkout/route";
import { POST as portalRoute } from "@/app/api/billing/portal/route";
import { POST as webhookRoute } from "@/app/api/billing/webhook/route";
import { BillingOffNotice } from "@/components/billing/billing-off-notice";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PortalButton } from "@/components/billing/portal-button";
import { BILLING_SETUP_STEPS, billingErrorMessage, formatPrice, intervalLabel, priceInWords, priceLabel } from "@/components/billing/format";
import type { BillingProvider } from "@/core/billing";
import type { DataStore } from "@/core/data";
import { PAST_DUE_GRACE_DAYS, type Plan, type Purchase, type Subscription, type User } from "@/core/types";
import { computeEntitlement } from "@/server/services/billing";
import { formatPrice as sharedFormatPrice } from "@/shared/money";

const h = vi.hoisted(() => ({
  store: null as DataStore | null,
  // What the registry returns: null = billing off (the default).
  billing: null as BillingProvider | null,
  // Who the session says is signed in.
  signedIn: null as User | null,
}));
vi.mock("@/server/data", () => ({
  getData: async () => {
    if (!h.store) throw new Error("test store not set");
    return h.store;
  },
}));
vi.mock("@/server/billing", () => ({ getBilling: async () => h.billing }));
vi.mock("@/server/session", () => ({ getCurrentUser: async () => h.signedIn }));
vi.mock("@/server/auth", () => ({ getAuth: async () => ({ urls: { signIn: "/sign-in", signUp: "/sign-up" } }) }));

// Quiet the adapters' one-line logs; assertions don't depend on them.
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

let store: DataStore;
let user: User;

async function setup() {
  await setupOn(createMemoryStore({ fresh: true }));
}

/** A buyer and the seeded pro / lifetime plans with Polar product ids, on `next` (memory, or PGlite below). */
async function setupOn(next: DataStore) {
  store = next;
  h.store = store;
  h.billing = null;
  h.signedIn = null;
  user = await store.users.upsertFromIdentity(
    { provider: "better-auth", providerUserId: "ba_1", email: "buyer@example.com", name: "Buyer", image: null, emailVerified: true },
    { makeAdmin: false },
  );
  // The seeded plans are the templates; a fresh PGlite has none of its own.
  const seeded = createMemoryStore({ fresh: true });
  const pro = (await seeded.plans.getByKey("pro")) as Plan;
  const lifetime = (await seeded.plans.getByKey("lifetime")) as Plan;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const strip = ({ id, updatedAt, ...rest }: Plan) => rest;
  await store.plans.upsert({
    ...strip(pro),
    prices: pro.prices.map((p) => ({ ...p, polarProductId: p.interval === "month" ? "polar_pro_month" : "polar_pro_year" })),
  });
  await store.plans.upsert({
    ...strip(lifetime),
    prices: lifetime.prices.map((p) => ({ ...p, polarProductId: "polar_lifetime" })),
  });
}

const subsOf = async () => (await store.billing.listSubscriptions({ userId: user.id })).items;
const purchasesOf = async () => (await store.billing.listPurchases({ userId: user.id })).items;
const auditCount = async () => (await store.audit.list({ limit: 200 })).items.length;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

// ------------------------------------------------------------------ entitlements

function sub(over: Partial<Subscription>): Subscription {
  return {
    id: "s1",
    userId: "u1",
    provider: "polar",
    providerSubscriptionId: "ps1",
    providerCustomerId: "c1",
    planKey: "pro",
    interval: "month",
    status: "active",
    currentPeriodEnd: future(10),
    cancelAtPeriodEnd: false,
    orgId: null,
    seats: null,
    createdAt: past(30),
    updatedAt: past(1),
    ...over,
  };
}

function purchase(over: Partial<Purchase>): Purchase {
  return {
    id: "p1",
    userId: "u1",
    provider: "polar",
    providerOrderId: "o1",
    planKey: "lifetime",
    amountCents: 29900,
    currency: "usd",
    refunded: false,
    createdAt: past(5),
    ...over,
  };
}

describe("computeEntitlement", () => {
  it("is free with nothing", () => {
    expect(computeEntitlement([], [])).toMatchObject({ source: "free", status: "free", planKey: null });
  });

  it("grants trialing and active subscriptions in their period", () => {
    expect(computeEntitlement([sub({ status: "trialing" })], [])).toMatchObject({ source: "subscription", status: "trialing", planKey: "pro" });
    expect(computeEntitlement([sub({ status: "active" })], [])).toMatchObject({ status: "active" });
  });

  it("keeps past_due entitled for a bounded grace while Polar retries the card — not forever", () => {
    expect(computeEntitlement([sub({ status: "past_due", currentPeriodEnd: past(2) })], [])).toMatchObject({ status: "past_due" });
    expect(computeEntitlement([sub({ status: "past_due", currentPeriodEnd: past(PAST_DUE_GRACE_DAYS - 1) })], [])).toMatchObject({ source: "subscription" });
    expect(computeEntitlement([sub({ status: "past_due", currentPeriodEnd: past(PAST_DUE_GRACE_DAYS + 1) })], [])).toMatchObject({ source: "free" });
    // The grace is only for past_due: an active sub past its period end is over.
    expect(computeEntitlement([sub({ status: "active", currentPeriodEnd: past(2) })], [])).toMatchObject({ source: "free" });
  });

  it("keeps a cancelled-at-period-end subscription until the period ends", () => {
    const e = computeEntitlement([sub({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: future(3) })], []);
    expect(e).toMatchObject({ source: "subscription", cancelAtPeriodEnd: true });
  });

  it("drops an expired period and a canceled status", () => {
    expect(computeEntitlement([sub({ status: "active", currentPeriodEnd: past(1) })], [])).toMatchObject({ source: "free" });
    expect(computeEntitlement([sub({ status: "canceled", currentPeriodEnd: future(5) })], [])).toMatchObject({ source: "free" });
    expect(computeEntitlement([sub({ status: "incomplete" }), sub({ status: "unpaid" })], [])).toMatchObject({ source: "free" });
  });

  it("grants a lifetime purchase, but not a refunded one", () => {
    expect(computeEntitlement([], [purchase({})])).toMatchObject({ source: "purchase", status: "lifetime", planKey: "lifetime" });
    expect(computeEntitlement([], [purchase({ refunded: true })])).toMatchObject({ source: "free" });
  });

  it("prefers a live subscription to a purchase, and the newest subscription wins", () => {
    const older = sub({ id: "a", planKey: "starter", updatedAt: past(10) });
    const newer = sub({ id: "b", planKey: "pro", updatedAt: past(1) });
    expect(computeEntitlement([older, newer], [purchase({})])).toMatchObject({ source: "subscription", planKey: "pro" });
    expect(computeEntitlement([newer, older], [])).toMatchObject({ planKey: "pro" });
  });
});

// ------------------------------------------------------------------ format

describe("price formatting", () => {
  it("labels prices", () => {
    expect(priceLabel({ amountCents: 1900, currency: "usd", interval: "month" })).toBe("$19/mo");
    expect(priceLabel({ amountCents: 19000, currency: "usd", interval: "year" })).toBe("$190/yr");
    expect(priceLabel({ amountCents: 29900, currency: "usd", interval: "one_time" })).toBe("$299 once");
    expect(formatPrice(1950, "usd")).toBe("$19.50");
    expect(formatPrice(900, "eur", "de-DE")).toMatch(/^9\s€$/u);
    expect(formatPrice(500, "jpy")).toBe("¥500");
  });

  it("uses the one shared formatter and says intervals one way", () => {
    // One table of zero-decimal currencies: the billing UI re-exports src/shared/money's formatter.
    expect(formatPrice).toBe(sharedFormatPrice);
    expect(intervalLabel("month")).toBe("per month");
    expect(intervalLabel("one_time")).toBe("one-time");
    expect(intervalLabel("year", "rate")).toBe("a year");
    expect(intervalLabel("one_time", "rate")).toBe("once");
    expect(intervalLabel("month", "adverb")).toBe("monthly");
    expect(priceInWords({ amountCents: 1900, currency: "usd", interval: "month" })).toBe("$19 a month");
    expect(priceInWords({ amountCents: 29900, currency: "usd", interval: "one_time" })).toBe("$299 once");
  });

  it("maps route error codes to copy", () => {
    expect(billingErrorMessage(undefined)).toBeNull();
    expect(billingErrorMessage("unavailable")).toMatch(/isn’t available/);
    expect(billingErrorMessage("already_owned")).toMatch(/already own this plan/);
    expect(billingErrorMessage("already_owned")).not.toMatch(/subscription/);
    expect(billingErrorMessage("too_large")).toMatch(/too large/);
    expect(billingErrorMessage("weird")).toMatch(/went wrong/);
  });
});

describe("billing buttons", () => {
  it("render plain forms that work without JavaScript", () => {
    const html = renderToStaticMarkup(createElement(CheckoutButton, { planKey: "pro", interval: "year", label: "Subscribe" }));
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/billing/checkout"');
    expect(html).toContain('name="planKey" value="pro"');
    expect(html).toContain('name="interval" value="year"');
    expect(html).toMatch(/<button[^>]*type="submit"/);
    const portal = renderToStaticMarkup(createElement(PortalButton, {}));
    expect(portal).toContain('action="/api/billing/portal"');
    expect(portal).toContain("Manage billing");
  });
});

// ------------------------------------------------------------------ Polar

type PolarSub = Awaited<ReturnType<PolarClient["subscriptions"]["get"]>>;
type PolarOrder = Awaited<ReturnType<PolarClient["orders"]["get"]>>;

function polarSub(over: Record<string, unknown>): PolarSub {
  return {
    id: "psub_1",
    status: "active",
    product_id: "polar_pro_month",
    customer_id: "pcus_1",
    recurring_interval: "month",
    current_period_end: future(30),
    cancel_at_period_end: false,
    ended_at: null,
    metadata: {},
    customer: { id: "pcus_1", external_id: user.id },
    ...over,
  } as unknown as PolarSub;
}

function polarOrder(over: Record<string, unknown>): PolarOrder {
  return {
    id: "pord_1",
    status: "paid",
    paid: true,
    product_id: "polar_lifetime",
    subscription_id: null,
    customer_id: "pcus_1",
    total_amount: 29900,
    currency: "usd",
    metadata: {},
    customer: { id: "pcus_1", external_id: user.id },
    ...over,
  } as unknown as PolarOrder;
}

/** A fake Polar API whose objects tests change between deliveries — "the provider's current state". */
function fakePolar() {
  const state = { subs: new Map<string, PolarSub>(), orders: new Map<string, PolarOrder>(), fail: false };
  const client = {
    checkouts: { create: vi.fn(async () => ({ url: "https://sandbox.polar.sh/checkout/x" })) },
    customerSessions: { create: vi.fn(async () => ({ customer_portal_url: "https://sandbox.polar.sh/portal/x" })) },
    subscriptions: {
      get: vi.fn(async (id: string) => {
        if (state.fail) throw new Error("Polar is down");
        const s = state.subs.get(id);
        if (!s) throw new Error(`no subscription ${id}`);
        return s;
      }),
    },
    orders: {
      get: vi.fn(async (id: string) => {
        const o = state.orders.get(id);
        if (!o) throw new Error(`no order ${id}`);
        return o;
      }),
    },
  } satisfies PolarClient;
  return { state, client };
}

const newSecret = `whsec_${randomBytes(24).toString("base64")}`;
let deliveries = 0;

function polarRequest(
  type: string,
  data: Record<string, unknown>,
  opts: { id?: string; secret?: string; rawKey?: boolean; tamper?: boolean } = {},
): Request {
  const id = opts.id ?? `msg_${++deliveries}`;
  const body = JSON.stringify({ type, timestamp: new Date().toISOString(), api_version: "2026-10", data });
  const secret = opts.secret ?? newSecret;
  // rawKey: Polar's pre-Sep-2026 format, the UTF-8 bytes of the whole "whsec_…" string.
  const signer = opts.rawKey ? new Webhook(new TextEncoder().encode(secret), { format: "raw" }) : new Webhook(secret);
  const now = new Date();
  const signature = signer.sign(id, now, body);
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
      "webhook-signature": opts.tamper ? signature.replace(/,./, ",A") : signature,
    },
    body: opts.tamper ? body.replace("psub_1", "psub_X") : body,
  });
}

describe("Polar webhooks", () => {
  beforeEach(setup);

  it("applies a validly signed subscription event from the re-fetched state", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({}));
    const polar = createPolarProvider({ client, webhookSecret: newSecret });

    // The payload is stale on purpose: what's stored is what the API returns.
    const res = await polar.handleWebhook(polarRequest("subscription.created", { id: "psub_1", status: "incomplete" }));
    expect(res.status).toBe(200);
    const [row] = await subsOf();
    expect(row).toMatchObject({ provider: "polar", providerSubscriptionId: "psub_1", status: "active", planKey: "pro", interval: "month" });
    expect(await store.billing.getCustomerId(user.id, "polar")).toBe("pcus_1");
    expect(computeEntitlement(await subsOf(), [])).toMatchObject({ planKey: "pro", status: "active" });
  });

  it("accepts the pre-2026 raw-key secret format too", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({}));
    const oldSecret = "whsec_legacy-polar-secret-used-as-raw-bytes";
    const polar = createPolarProvider({ client, webhookSecret: oldSecret });
    const res = await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }, { secret: oldSecret, rawKey: true }));
    expect(res.status).toBe(200);
    expect(await subsOf()).toHaveLength(1);
  });

  it("rejects a bad signature with 403 and writes nothing", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({}));
    const polar = createPolarProvider({ client, webhookSecret: newSecret });

    const wrongKey = await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }, { secret: `whsec_${randomBytes(24).toString("base64")}` }));
    expect(wrongKey.status).toBe(403);
    const tampered = await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }, { tamper: true }));
    expect(tampered.status).toBe(403);
    const unsigned = await polar.handleWebhook(new Request("http://localhost/x", { method: "POST", body: "{}" }));
    expect(unsigned.status).toBe(403);
    expect(await subsOf()).toHaveLength(0);
    expect(client.subscriptions.get).not.toHaveBeenCalled();
  });

  it("is idempotent on redelivery", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({}));
    const polar = createPolarProvider({ client, webhookSecret: newSecret });

    expect((await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }, { id: "msg_same" }))).status).toBe(200);
    const audits = await auditCount();
    const again = await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }, { id: "msg_same" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ result: "unchanged" });
    expect(await subsOf()).toHaveLength(1);
    expect(await auditCount()).toBe(audits);
  });

  it("doesn't let an older event arriving late regress a revoked subscription", async () => {
    const { state, client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    state.subs.set("psub_1", polarSub({}));
    await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }));

    // Revoked now…
    state.subs.set("psub_1", polarSub({ status: "canceled", ended_at: past(0) }));
    await polar.handleWebhook(polarRequest("subscription.revoked", { id: "psub_1", status: "canceled" }));
    // …then a retried, older "updated: active" arrives.
    const late = await polar.handleWebhook(polarRequest("subscription.updated", { id: "psub_1", status: "active" }));
    expect(late.status).toBe(200);
    const [row] = await subsOf();
    expect(row.status).toBe("canceled");
    expect(computeEntitlement(await subsOf(), [])).toMatchObject({ source: "free" });
  });

  it("answers 500 when processing fails, and the retry of the same event completes", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({}));
    const polar = createPolarProvider({ client, webhookSecret: newSecret });

    state.fail = true;
    const first = await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }, { id: "msg_retry" }));
    expect(first.status).toBe(500);
    expect(await subsOf()).toHaveLength(0);

    state.fail = false;
    const retry = await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }, { id: "msg_retry" }));
    expect(retry.status).toBe(200);
    expect(await subsOf()).toHaveLength(1);
  });

  it("ignores unrelated and unknown events with 202", async () => {
    const { client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    expect((await polar.handleWebhook(polarRequest("checkout.created", { id: "chk_1" }))).status).toBe(202);
    expect((await polar.handleWebhook(polarRequest("something.from_the_future", { id: "x" }))).status).toBe(202);
  });

  it("records a one-time order, marks a refund, and a late order.paid can't undo the refund", async () => {
    const { state, client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    state.orders.set("pord_1", polarOrder({}));
    expect((await polar.handleWebhook(polarRequest("order.paid", { id: "pord_1" }))).status).toBe(200);
    expect(await purchasesOf()).toMatchObject([{ providerOrderId: "pord_1", planKey: "lifetime", amountCents: 29900, refunded: false }]);
    expect(computeEntitlement([], await purchasesOf())).toMatchObject({ status: "lifetime" });

    state.orders.set("pord_1", polarOrder({ status: "refunded" }));
    await polar.handleWebhook(polarRequest("refund.created", { id: "ref_1", order_id: "pord_1" }));
    await polar.handleWebhook(polarRequest("order.paid", { id: "pord_1" })); // late redelivery of the original
    const [p] = await purchasesOf();
    expect(p.refunded).toBe(true);
    expect(computeEntitlement([], await purchasesOf())).toMatchObject({ source: "free" });
  });

  it("acknowledges but doesn't apply events for a customer it can't map to a user", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({ customer: { id: "pcus_9", external_id: null }, customer_id: "pcus_9" }));
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    const res = await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "unknown_user" });
    expect((await store.billing.listSubscriptions({})).items).toHaveLength(0);
  });

  it("creates checkouts for the plan's product, tied to the user", async () => {
    const { client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    const plan = (await store.plans.getByKey("pro")) as Plan;
    const price = plan.prices.find((p) => p.interval === "month")!;
    await polar.createCheckout({ user, plan, price, customerId: null, successUrl: "https://app.test/dashboard/billing?checkout=success", cancelUrl: "https://app.test/pricing" });
    expect(client.checkouts.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        products: ["polar_pro_month"],
        external_customer_id: user.id,
        customer_email: user.email,
        metadata: { userId: user.id, planKey: "pro", interval: "month", productId: "polar_pro_month" },
        success_url: "https://app.test/dashboard/billing?checkout=success&checkout_id={CHECKOUT_ID}",
        trial_interval: "day",
        trial_interval_count: 14,
      }),
    );
    await polar.createCheckout({ user, plan, price, customerId: "pcus_1", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c" });
    expect(client.checkouts.create).toHaveBeenLastCalledWith(expect.objectContaining({ customer_id: "pcus_1", success_url: "https://app.test/s?checkout_id={CHECKOUT_ID}" }));
    const portal = await polar.createPortal({ user, customerId: "pcus_1", returnUrl: "https://app.test/dashboard/billing" });
    expect(portal.url).toContain("portal");
  });
});

describe("Polar orders", () => {
  beforeEach(setup);

  it("re-syncs the subscription when a renewal order is paid", async () => {
    const { state, client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    state.subs.set("psub_1", polarSub({ status: "active", current_period_end: future(60) }));
    state.orders.set("pord_r", polarOrder({ id: "pord_r", subscription_id: "psub_1", product_id: "polar_pro_month" }));
    expect((await polar.handleWebhook(polarRequest("order.paid", { id: "pord_r" }))).status).toBe(200);
    expect(await subsOf()).toMatchObject([{ providerSubscriptionId: "psub_1", status: "active", planKey: "pro" }]);
    // A renewal is not a one-time purchase.
    expect(await purchasesOf()).toHaveLength(0);
  });

  it("keeps access after a partial refund, and ignores unpaid orders", async () => {
    const { state, client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    state.orders.set("pord_1", polarOrder({ status: "partially_refunded" }));
    await polar.handleWebhook(polarRequest("order.updated", { id: "pord_1" }));
    expect(computeEntitlement([], await purchasesOf())).toMatchObject({ status: "lifetime" });

    state.orders.set("pord_2", polarOrder({ id: "pord_2", status: "pending", paid: false }));
    const res = await polar.handleWebhook(polarRequest("order.updated", { id: "pord_2" }));
    expect(await res.json()).toMatchObject({ result: "not_paid" });
    expect(await purchasesOf()).toHaveLength(1);
  });

  it("stores a product on no plan with no plan, and uses the checkout's plan key when the product id changed", async () => {
    const { state, client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    // Another product the organisation sells, bought by the same customer.
    state.subs.set("psub_other", polarSub({ id: "psub_other", product_id: "polar_something_else" }));
    expect((await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_other" }))).status).toBe(200);
    expect(await subsOf()).toMatchObject([{ providerSubscriptionId: "psub_other", planKey: null }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("is not on any plan"));
    // Bought through this app's checkout (metadata carries the plan and the product it sold), then the plan's product id was edited.
    state.subs.set("psub_meta", polarSub({ id: "psub_meta", product_id: "polar_old_pro", metadata: { planKey: "pro", productId: "polar_old_pro" } }));
    await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_meta" }));
    expect((await subsOf()).find((s) => s.providerSubscriptionId === "psub_meta")).toMatchObject({ planKey: "pro", interval: "month" });
  });

  it("drops the checkout's plan once the subscription moves to a product no plan sells", async () => {
    const { state, client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    const checkoutMeta = { userId: user.id, planKey: "pro", interval: "month", productId: "polar_pro_month" };
    state.subs.set("psub_1", polarSub({ metadata: checkoutMeta }));
    await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }));
    expect(computeEntitlement(await subsOf(), [])).toMatchObject({ planKey: "pro" });

    // Switched in Polar's customer portal to a cheap product /admin/plans doesn't map. Polar keeps the metadata.
    state.subs.set("psub_1", polarSub({ product_id: "polar_legacy_cheap", metadata: checkoutMeta }));
    await polar.handleWebhook(polarRequest("subscription.updated", { id: "psub_1" }));
    expect(await subsOf()).toMatchObject([{ providerSubscriptionId: "psub_1", planKey: null }]);
    expect(computeEntitlement(await subsOf(), [])).toMatchObject({ source: "free", planKey: null });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("polar_legacy_cheap is not on any plan"));

    // A plan key with no product id (a checkout made before productId was recorded) doesn't count either.
    state.subs.set("psub_old", polarSub({ id: "psub_old", product_id: "polar_legacy_cheap", metadata: { planKey: "pro" } }));
    await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_old" }));
    expect((await subsOf()).find((s) => s.providerSubscriptionId === "psub_old")).toMatchObject({ planKey: null });
  });

  it("applies the same product rule to one-time orders", async () => {
    const { state, client } = fakePolar();
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    state.orders.set("pord_x", polarOrder({ id: "pord_x", product_id: "polar_unmapped", metadata: { planKey: "lifetime", productId: "polar_lifetime" } }));
    await polar.handleWebhook(polarRequest("order.paid", { id: "pord_x" }));
    expect(await purchasesOf()).toMatchObject([{ providerOrderId: "pord_x", planKey: null }]);
    expect(computeEntitlement([], await purchasesOf())).toMatchObject({ source: "free" });
  });
});

describe("the webhook sink seam", () => {
  beforeEach(setup);

  it("hands the adapter's re-fetched, normalised state to an injected sink and claims the event through it", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({ current_period_end: "2031-01-02T03:04:05.123456Z" }));
    state.orders.set("pord_1", polarOrder({ currency: "EUR", metadata: { planKey: "lifetime", productId: "polar_lifetime" } }));
    const subs: ProviderSubscriptionState[] = [];
    const orders: ProviderOrderState[] = [];
    const claimed: string[] = [];
    const sink: BillingWebhookSink = {
      applySubscription: async (s) => (subs.push(s), "applied"),
      applyOrder: async (o) => (orders.push(o), "unchanged"),
      markEventProcessed: async (_provider, id) => (claimed.push(id), true),
    };
    const polar = createPolarProvider({ client, webhookSecret: newSecret, sink });

    const res = await polar.handleWebhook(polarRequest("subscription.updated", { id: "psub_1" }, { id: "msg_sink_1" }));
    expect(await res.json()).toMatchObject({ result: "applied" });
    expect(subs).toEqual([
      {
        provider: "polar",
        providerSubscriptionId: "psub_1",
        providerCustomerId: "pcus_1",
        userIdHints: [user.id, null],
        productId: "polar_pro_month",
        planKeyHint: null,
        checkoutProductId: null,
        orgIdHint: null, // a personal checkout names no organisation
        seats: null,
        interval: "month",
        status: "active",
        currentPeriodEnd: "2031-01-02T03:04:05.123456Z",
        cancelAtPeriodEnd: false,
      },
    ]);
    await polar.handleWebhook(polarRequest("order.paid", { id: "pord_1" }, { id: "msg_sink_2" }));
    expect(orders).toMatchObject([{ providerOrderId: "pord_1", planKeyHint: "lifetime", checkoutProductId: "polar_lifetime", currency: "eur", refunded: false }]);
    expect(claimed).toEqual(["msg_sink_1", "msg_sink_2"]);
    // The adapter itself wrote nothing.
    expect(await subsOf()).toHaveLength(0);
    expect(await auditCount()).toBe(0);
  });

  it("audits the first customer link, and not a repeat", async () => {
    const { state, client } = fakePolar();
    state.subs.set("psub_1", polarSub({}));
    const polar = createPolarProvider({ client, webhookSecret: newSecret });
    await polar.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }));
    await polar.handleWebhook(polarRequest("subscription.updated", { id: "psub_1" }));
    const links = (await store.audit.list({ limit: 200 })).items.filter((e) => e.action === "billing.customer_link");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ entity: "billing_customer", entityId: user.id, before: null, after: { provider: "polar", customerId: "pcus_1" } });
  });
});

describe("period-end timestamps", () => {
  it("normalise any ISO-8601 instant to the store's form, and refuse garbage", () => {
    expect(normalizeInstant("2031-01-02T03:04:05Z")).toBe("2031-01-02T03:04:05.000Z");
    expect(normalizeInstant("2031-01-02T03:04:05.123456Z")).toBe("2031-01-02T03:04:05.123Z");
    expect(normalizeInstant("2031-01-02T05:04:05+02:00")).toBe("2031-01-02T03:04:05.000Z");
    expect(normalizeInstant(null)).toBeNull();
    expect(normalizeInstant("")).toBeNull();
    // "No period end" would read as entitled forever, so garbage is an error (the webhook 500s and is retried).
    expect(() => normalizeInstant("next tuesday")).toThrow(/Unparseable/);
  });

  it("compare as instants", () => {
    expect(sameInstant("2031-01-02T03:04:05Z", "2031-01-02T03:04:05.000Z")).toBe(true);
    expect(sameInstant(null, null)).toBe(true);
    expect(sameInstant(null, "2031-01-02T03:04:05Z")).toBe(false);
    expect(sameInstant("2031-01-02T03:04:05Z", "2031-01-02T03:04:06Z")).toBe(false);
  });
});

// The memory store hands back whatever string it was given, which hides the
// Postgres behaviour: timestamptz(3) comes back as toISOString(). Run the
// redelivery rules on the real SQL too.
describe("Polar webhooks on Postgres (PGlite)", () => {
  let client: PGlite | undefined;

  beforeEach(async () => {
    client = new PGlite();
    await migrateEmbedded(client);
    await setupOn(createPostgresStore({ db: drizzleOverPglite(client) }));
  });
  afterEach(async () => {
    await client?.close();
  });

  for (const periodEnd of ["2031-01-02T03:04:05Z", "2031-01-02T03:04:05.123456Z", "2031-01-02T05:04:05+02:00"]) {
    it(`treats a redelivery with period end ${periodEnd} as unchanged and audits nothing`, async () => {
      const { state, client: api } = fakePolar();
      state.subs.set("psub_1", polarSub({ current_period_end: periodEnd }));
      const polar = createPolarProvider({ client: api, webhookSecret: newSecret });

      const first = await polar.handleWebhook(polarRequest("subscription.created", { id: "psub_1" }));
      expect(await first.json()).toMatchObject({ result: "applied" });
      const audits = await auditCount();
      // A different event about the same, unchanged subscription (Polar sends several per change).
      const again = await polar.handleWebhook(polarRequest("subscription.updated", { id: "psub_1" }));
      expect(await again.json()).toMatchObject({ result: "unchanged" });
      expect(await auditCount()).toBe(audits);
      const [row] = await subsOf();
      expect(row.currentPeriodEnd).toBe(normalizeInstant(periodEnd));
    });
  }

  it("still records a real change", async () => {
    const { state, client: api } = fakePolar();
    state.subs.set("psub_1", polarSub({ current_period_end: "2031-01-02T03:04:05.123456Z" }));
    const polar = createPolarProvider({ client: api, webhookSecret: newSecret });
    await polar.handleWebhook(polarRequest("subscription.created", { id: "psub_1" }));
    const audits = await auditCount();
    state.subs.set("psub_1", polarSub({ current_period_end: "2031-02-02T03:04:05.123456Z" }));
    const renewed = await polar.handleWebhook(polarRequest("subscription.updated", { id: "psub_1" }));
    expect(await renewed.json()).toMatchObject({ result: "applied" });
    expect(await auditCount()).toBe(audits + 1);
    expect((await subsOf())[0].currentPeriodEnd).toBe("2031-02-02T03:04:05.123Z");
  });
});

// ------------------------------------------------------------------ routes

const SITE = "http://localhost:3000";

function post(path: string, fields: Record<string, string>, opts: { origin?: string | null; json?: boolean } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE;
  if (opts.json) headers["content-type"] = "application/json";
  else headers["content-type"] = "application/x-www-form-urlencoded";
  return new Request(`${SITE}${path}`, {
    method: "POST",
    headers,
    body: opts.json ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
  });
}

const checkout = (fields: Record<string, string>, opts?: { origin?: string | null; json?: boolean }) =>
  checkoutRoute(post("/api/billing/checkout", fields, opts));

describe("billing routes with billing off (the default)", () => {
  beforeEach(setup);

  it("send checkout back to pricing with billing_disabled, before any sign-in", async () => {
    const res = await checkout({ planKey: "pro", interval: "month" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/pricing?error=billing_disabled");
    expect(billingErrorMessage("billing_disabled")).toMatch(/aren’t switched on/);
  });

  it("tell JSON callers how to enable billing", async () => {
    const res = await checkout({ planKey: "pro", interval: "month" }, { json: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "billing_disabled", message: expect.stringContaining("POLAR_ACCESS_TOKEN") });
  });

  it("send the portal back to billing, and 404 the webhook", async () => {
    h.signedIn = user;
    const portal = await portalRoute(post("/api/billing/portal", {}));
    expect(portal.headers.get("location")).toBe("/dashboard/billing?error=billing_disabled");
    const hook = await webhookRoute(new Request(`${SITE}/api/billing/webhook`, { method: "POST", body: "{}" }));
    expect(hook.status).toBe(404);
    expect(await hook.json()).toMatchObject({ error: "billing_disabled" });
  });

  it("render a notice: one line for customers, the setup steps for owners", () => {
    const customer = renderToStaticMarkup(createElement(BillingOffNotice, { audience: "customer" }));
    expect(customer).toContain("Free plans work");
    expect(customer).not.toContain("POLAR_ACCESS_TOKEN");
    const owner = renderToStaticMarkup(createElement(BillingOffNotice, { audience: "owner" }));
    expect(owner).toContain("POLAR_ACCESS_TOKEN");
    expect(owner.match(/<li>/g)).toHaveLength(BILLING_SETUP_STEPS.length);
    expect(owner).not.toContain('role="alert"');
    const named = renderToStaticMarkup(createElement(BillingOffNotice, { audience: "owner", webhookUrl: `${SITE}/api/billing/webhook` }));
    expect(named).toContain(`${SITE}/api/billing/webhook`);
    expect(named).not.toContain("&lt;your site&gt;");
  });
});

describe("billing routes with Polar on", () => {
  let polar: ReturnType<typeof fakePolar>;

  beforeEach(async () => {
    await setup();
    polar = fakePolar();
    h.billing = createPolarProvider({ client: polar.client, webhookSecret: newSecret });
  });

  it("refuse a cross-site post", async () => {
    h.signedIn = user;
    const res = await checkout({ planKey: "pro", interval: "month" }, { origin: "https://evil.example" });
    expect(res.headers.get("location")).toBe("/pricing?error=forbidden");
    expect((await checkout({ planKey: "pro", interval: "month" }, { origin: null })).headers.get("location")).toBe("/pricing?error=forbidden");
    expect(polar.client.checkouts.create).not.toHaveBeenCalled();
  });

  it("send a signed-out visitor to sign-in, returning to pricing", async () => {
    const res = await checkout({ planKey: "pro", interval: "month" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/sign-in?redirect=%2Fpricing");
  });

  it("refuse a malformed request", async () => {
    h.signedIn = user;
    const res = await checkout({ planKey: "pro", interval: "weekly" });
    expect(res.headers.get("location")).toBe("/pricing?error=invalid");
  });

  it("redirect a signed-in user to Polar's checkout for the plan's product", async () => {
    h.signedIn = user;
    const res = await checkout({ planKey: "pro", interval: "month" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://sandbox.polar.sh/checkout/x");
    expect(polar.client.checkouts.create).toHaveBeenCalledWith(
      expect.objectContaining({ products: ["polar_pro_month"], success_url: `${SITE}/dashboard/billing?checkout=success&checkout_id={CHECKOUT_ID}` }),
    );
    const asJson = await checkout({ planKey: "pro", interval: "year" }, { json: true });
    expect(await asJson.json()).toEqual({ url: "https://sandbox.polar.sh/checkout/x" });
  });

  it("refuse a second subscription and a one-time plan on top of a live one, sending the user to billing", async () => {
    h.signedIn = user;
    polar.state.subs.set("psub_1", polarSub({}));
    await h.billing!.handleWebhook(polarRequest("subscription.active", { id: "psub_1" }));

    const again = await checkout({ planKey: "pro", interval: "year" });
    expect(again.headers.get("location")).toBe("/dashboard/billing?error=already_subscribed");
    expect(billingErrorMessage("already_subscribed")).toMatch(/already have a subscription/);
    // A lifetime purchase would not stop the subscription renewing: cancel it first.
    const lifetime = await checkout({ planKey: "lifetime", interval: "one_time" });
    expect(lifetime.headers.get("location")).toBe("/dashboard/billing?error=already_subscribed");
  });

  it("allow a one-time purchase when there is no live subscription", async () => {
    h.signedIn = user;
    const lifetime = await checkout({ planKey: "lifetime", interval: "one_time" });
    expect(lifetime.headers.get("location")).toBe("https://sandbox.polar.sh/checkout/x");
  });

  it("tell a lifetime owner buying again that they own it, not that they have a subscription", async () => {
    h.signedIn = user;
    polar.state.orders.set("pord_1", polarOrder({}));
    await h.billing!.handleWebhook(polarRequest("order.paid", { id: "pord_1" }));
    const again = await checkout({ planKey: "lifetime", interval: "one_time" });
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe("/dashboard/billing?error=already_owned");
    const asJson = await checkout({ planKey: "lifetime", interval: "one_time" }, { json: true });
    expect(asJson.status).toBe(409);
    expect(await asJson.json()).toMatchObject({ error: "already_owned" });
  });

  it("refuse an oversized checkout body before looking at the session", async () => {
    const res = await checkoutRoute(
      new Request(`${SITE}/api/billing/checkout`, {
        method: "POST",
        headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" },
        body: `planKey=pro&interval=month&pad=${"x".repeat(70 * 1024)}`,
      }),
    );
    expect(res.headers.get("location")).toBe("/pricing?error=too_large");
    expect(polar.client.checkouts.create).not.toHaveBeenCalled();
  });

  it("refuse an oversized webhook body before the adapter verifies it", async () => {
    // The route holds the one webhook body cap (the adapter trusts the bytes it is handed).
    const res = await webhookRoute(new Request(`${SITE}/api/billing/webhook`, { method: "POST", body: "x".repeat(1024 * 1024 + 1) }));
    expect(res.status).toBe(413);
    expect(await subsOf()).toHaveLength(0);
  });

  it("stop reading a chunked webhook body with no length at the cap", async () => {
    let sent = 0;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await webhookRoute(
      new Request(`${SITE}/api/billing/webhook`, { method: "POST", body: endless, duplex: "half" } as RequestInit & { duplex: "half" }),
    );
    expect(res.status).toBe(413);
    // Refused just past 1 MB, not after buffering the whole (endless) upload.
    expect(sent).toBeLessThan(2 * 1024 * 1024);
    expect(await subsOf()).toHaveLength(0);
  });

  it("say so when a plan has no Polar product yet", async () => {
    h.signedIn = user;
    const pro = (await store.plans.getByKey("pro")) as Plan;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, updatedAt, ...rest } = pro;
    await store.plans.upsert({ ...rest, prices: pro.prices.map((p) => ({ ...p, polarProductId: null })) });
    const res = await checkout({ planKey: "pro", interval: "month" }, { json: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "unavailable", message: expect.stringContaining("/admin/plans") });
  });

  it("open the portal only for a user with a Polar customer", async () => {
    h.signedIn = user;
    const none = await portalRoute(post("/api/billing/portal", {}));
    expect(none.headers.get("location")).toBe("/dashboard/billing?error=not_found");
    await store.billing.setCustomerId(user.id, "polar", "pcus_1");
    const res = await portalRoute(post("/api/billing/portal", {}));
    expect(res.headers.get("location")).toBe("https://sandbox.polar.sh/portal/x");
    expect(polar.client.customerSessions.create).toHaveBeenCalledWith({ customer_id: "pcus_1", return_url: `${SITE}/dashboard/billing` });
  });

  it("pass the webhook to the adapter, which verifies it", async () => {
    polar.state.subs.set("psub_1", polarSub({}));
    expect((await webhookRoute(polarRequest("subscription.active", { id: "psub_1" }))).status).toBe(200);
    const forged = await webhookRoute(polarRequest("subscription.active", { id: "psub_1" }, { secret: `whsec_${randomBytes(24).toString("base64")}` }));
    expect(forged.status).toBe(403);
    expect(await subsOf()).toHaveLength(1);
  });
});
