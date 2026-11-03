import "server-only";

//
// BILLING_PROVIDER=stripe: Stripe Checkout, the Stripe customer portal, and
// signed webhooks. Unlike Polar, Stripe isn't the merchant of record: tax
// (Stripe Tax) and receipts are set up in your Stripe dashboard.
//
//   STRIPE_SECRET_KEY      sk_test_… or sk_live_…
//   STRIPE_WEBHOOK_SECRET  whsec_…, the endpoint's signing secret
//
// Each plan price carries the Stripe price it sells (stripePriceId, price_…).
// Webhook endpoint: <site>/api/billing/webhook, with the events
// customer.subscription.created / updated / deleted / paused / resumed,
// checkout.session.completed, checkout.session.async_payment_succeeded and
// charge.refunded.
//
// The same rules as the Polar adapter (../polar):
//  - Verify first: the raw body against the stripe-signature header, before parsing.
//  - Ordering-proof: an event only says "something changed". The subscription or
//    payment intent is re-fetched, and what Stripe says NOW goes to the sink.
//  - This adapter never touches the DataStore; the sink (../webhook-sink) resolves,
//    writes, audits, and claims the event id last.
//  - Who and what it was bought for travel in the metadata our checkout sets
//    (userId, planKey, productId = the price sold, orgId for a team). Stripe copies
//    subscription_data / payment_intent_data metadata onto the subscription or
//    payment intent, which is what the re-fetch reads.
//  - A subscription's quantity is passed as seats; the sink keeps it only for a per-seat price.
//

import Stripe from "stripe";
import type { BillingProvider, CheckoutInput } from "@/core/billing";
import { priceIdFor } from "@/core/billing";
import { requireEnv } from "@/server/env";
import { type BillingWebhookSink, type ProviderOrderState, type ProviderSubscriptionState, type WebhookApplyResult, appendRawParam, jsonResponse, logWebhook, mapStatus } from "../shared";

/** The subset of the Stripe client this adapter uses: what tests fake. */
export interface StripeClient {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
  subscriptions: { retrieve(id: string): Promise<Stripe.Subscription> };
  paymentIntents: { retrieve(id: string, params?: Stripe.PaymentIntentRetrieveParams): Promise<Stripe.PaymentIntent> };
  disputes: { retrieve(id: string): Promise<Stripe.Dispute> };
  prices: { retrieve(id: string): Promise<Stripe.Price> };
  billing: { meterEvents: { create(params: Stripe.Billing.MeterEventCreateParams, options?: Stripe.RequestOptions): Promise<unknown> } };
  webhooks: { constructEventAsync(payload: string, header: string, secret: string): Promise<Stripe.Event> };
}

export interface StripeProviderOptions {
  /** Inject a client (tests). Defaults to the real SDK client, created on first use. */
  client?: StripeClient;
  /** Override STRIPE_WEBHOOK_SECRET (tests). */
  webhookSecret?: string;
  /** Where verified, re-fetched state goes. Defaults to ../webhook-sink, loaded on the first webhook. */
  sink?: BillingWebhookSink;
}

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : (v?.id ?? null));
const iso = (unixSeconds: number | null | undefined): string | null => (typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null);
const meta = (m: Stripe.Metadata | null | undefined, key: string): string | null => (m?.[key] ? String(m[key]) : null);

/** A Stripe subscription as the sink's state. Exported for the tests. */
export function subscriptionState(sub: Stripe.Subscription): ProviderSubscriptionState {
  const item = sub.items?.data?.[0];
  const recurring = item?.price?.recurring?.interval;
  return {
    provider: "stripe",
    providerSubscriptionId: sub.id,
    providerCustomerId: idOf(sub.customer),
    userIdHints: [meta(sub.metadata, "userId")],
    productId: item?.price?.id ?? null,
    planKeyHint: meta(sub.metadata, "planKey"),
    checkoutProductId: meta(sub.metadata, "productId"),
    orgIdHint: meta(sub.metadata, "orgId"),
    seats: typeof item?.quantity === "number" ? item.quantity : null,
    interval: recurring === "year" ? "year" : recurring === "month" ? "month" : null,
    status: mapStatus(sub.status),
    // Ended: the end. Otherwise the item's period end (where Stripe keeps it in this API version).
    currentPeriodStart: iso(item?.current_period_start),
    currentPeriodEnd: iso(sub.ended_at) ?? iso(item?.current_period_end),
    // cancel_at set (a scheduled cancellation) also means it won't renew.
    cancelAtPeriodEnd: sub.cancel_at_period_end || (sub.cancel_at !== null && sub.cancel_at !== undefined && sub.status !== "canceled"),
  };
}

/** A paid one-time payment intent as the sink's order state. Exported for the tests. */
export function orderState(pi: Stripe.PaymentIntent, disputeLost = false): ProviderOrderState {
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge !== null ? pi.latest_charge : null;
  return {
    provider: "stripe",
    providerOrderId: pi.id,
    providerCustomerId: idOf(pi.customer as string | { id: string } | null),
    userIdHints: [meta(pi.metadata, "userId")],
    // The price our checkout sold: a payment intent has no line items of its own.
    productId: meta(pi.metadata, "productId"),
    planKeyHint: meta(pi.metadata, "planKey"),
    checkoutProductId: meta(pi.metadata, "productId"),
    amountCents: pi.amount_received,
    currency: pi.currency.toLowerCase(),
    // A FULL refund ends access; a partial one keeps it. A lost chargeback ends it for good.
    refunded: charge?.refunded === true,
    chargedBack: disputeLost,
  };
}

/**
 * A one-time checkout that cost nothing (a 100%-off promotion code): Stripe makes no payment intent,
 * so the session is the order. Exported for the tests.
 */
export function freeOrderState(session: Stripe.Checkout.Session): ProviderOrderState {
  return {
    provider: "stripe",
    providerOrderId: session.id,
    providerCustomerId: idOf(session.customer as string | { id: string } | null),
    userIdHints: [meta(session.metadata, "userId"), session.client_reference_id ?? null],
    productId: meta(session.metadata, "productId"),
    planKeyHint: meta(session.metadata, "planKey"),
    checkoutProductId: meta(session.metadata, "productId"),
    amountCents: session.amount_total ?? 0,
    currency: (session.currency ?? "usd").toLowerCase(),
    refunded: false,
  };
}

export function createStripeProvider(options: StripeProviderOptions = {}): BillingProvider {
  let client: StripeClient | null = options.client ?? null;
  // Lazy: the build and the registry never need the key; the first real call does.
  const stripe = (): StripeClient => (client ??= new Stripe(requireEnv("STRIPE_SECRET_KEY", "Stripe billing"), { timeout: 20_000, maxNetworkRetries: 1 }) as unknown as StripeClient);

  let sinkPromise: Promise<BillingWebhookSink> | null = options.sink ? Promise.resolve(options.sink) : null;
  const sink = (): Promise<BillingWebhookSink> => {
    sinkPromise ??= import("../webhook-sink").then(
      (m) => m.billingWebhookSink,
      (error: unknown) => {
        sinkPromise = null;
        throw error;
      },
    );
    return sinkPromise;
  };

  async function syncSubscription(id: string): Promise<WebhookApplyResult> {
    return (await sink()).applySubscription(subscriptionState(await stripe().subscriptions.retrieve(id)));
  }

  /** A $0 one-time checkout: re-fetched like everything else, granted only when Stripe says it's complete and free. */
  async function syncFreeCheckout(sessionId: string): Promise<WebhookApplyResult | "not_paid"> {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    if (session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "no_payment_required") return "not_paid";
    if (!meta(session.metadata, "planKey")) return "not_paid";
    return (await sink()).applyOrder(freeOrderState(session));
  }

  async function syncPayment(paymentIntentId: string, disputeLost = false): Promise<WebhookApplyResult | "not_paid"> {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    if (pi.status !== "succeeded") return "not_paid";
    // A subscription's invoice payments are the subscription's business, not a one-time purchase.
    if (!meta(pi.metadata, "planKey")) return "not_paid";
    return (await sink()).applyOrder(orderState(pi, disputeLost));
  }

  return {
    id: "stripe",
    label: "Stripe",
    hasPortal: true,

    async createCheckout(input: CheckoutInput) {
      const { user, plan, price, customerId } = input;
      const priceId = priceIdFor(plan, price, "stripe");
      if (!priceId) throw new Error(`Plan "${plan.key}" (${price.interval}) has no Stripe price id`);
      const recurring = price.interval !== "one_time";
      const metadata: Record<string, string> = {
        userId: user.id,
        planKey: plan.key,
        interval: price.interval,
        productId: priceId,
        ...(input.orgId ? { orgId: input.orgId } : {}),
      };
      const session = await stripe().checkout.sessions.create({
        mode: recurring ? "subscription" : "payment",
        line_items: [{ price: priceId, quantity: input.seats ?? 1 }],
        // {CHECKOUT_SESSION_ID} is filled by Stripe; the page may show "confirming…" with it. It grants nothing.
        success_url: appendRawParam(input.successUrl, "session_id={CHECKOUT_SESSION_ID}"),
        cancel_url: input.cancelUrl,
        client_reference_id: user.id,
        metadata,
        allow_promotion_codes: true,
        ...(customerId ? { customer: customerId } : { customer_email: user.email }),
        ...(recurring
          ? { subscription_data: { metadata, ...(plan.trialDays ? { trial_period_days: plan.trialDays } : {}) } }
          : { payment_intent_data: { metadata }, ...(customerId ? {} : { customer_creation: "always" as const }) }),
      });
      if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
      return { url: session.url };
    },

    async createPortal({ customerId, returnUrl }) {
      const session = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return { url: session.url };
    },

    // A Stripe meter's event_name is the metric; it sums payload.value per stripe_customer_id.
    // identifier makes a retried job a duplicate Stripe drops (within its 24-hour window), and the
    // request's idempotency key covers a retry of the same request.
    async reportUsage({ id, customerId, metric, quantity, occurredAt }) {
      await stripe().billing.meterEvents.create(
        { event_name: metric, identifier: id, timestamp: Math.floor(Date.parse(occurredAt) / 1000), payload: { stripe_customer_id: customerId, value: String(quantity) } },
        { idempotencyKey: `usage-${id}` },
      );
    },

    async describePrice(id: string) {
      const price = await stripe().prices.retrieve(id).catch((error: { statusCode?: number }) => {
        if (error?.statusCode === 404) return null;
        throw error;
      });
      if (!price) return null;
      const r: string | undefined = price.recurring?.interval;
      const every = price.recurring?.interval_count ?? 1;
      const interval = !r ? ("one_time" as const) : (r === "month" || r === "year") && every === 1 ? r : ("other" as const);
      return { amountCents: price.unit_amount ?? null, currency: price.currency, interval };
    },

    async handleWebhook(request: Request) {
      // The exact bytes Stripe signed, never parsed before verifying.
      const body = await request.text();
      const signature = request.headers.get("stripe-signature") ?? "";
      const secret = options.webhookSecret ?? requireEnv("STRIPE_WEBHOOK_SECRET", "verifying Stripe webhooks");

      let event: Stripe.Event;
      try {
        event = await stripe().webhooks.constructEventAsync(body, signature, secret);
      } catch (error) {
        logWebhook("stripe", `rejected webhook: ${error instanceof Error ? error.message : "invalid signature"}`);
        return jsonResponse(403, { error: "invalid_signature" });
      }

      let result: WebhookApplyResult | "not_paid";
      try {
        if (SUBSCRIPTION_EVENTS.has(event.type)) {
          result = await syncSubscription((event.data.object as Stripe.Subscription).id);
        } else if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode === "subscription" && session.subscription) result = await syncSubscription(idOf(session.subscription)!);
          else if (session.mode === "payment" && session.payment_intent) result = await syncPayment(idOf(session.payment_intent)!);
          else if (session.mode === "payment" && session.payment_status === "no_payment_required") result = await syncFreeCheckout(session.id);
          else return jsonResponse(202, { ignored: true });
        } else if (event.type === "charge.dispute.closed") {
          // A lost chargeback revokes a one-time purchase (the sink keeps it revoked). The dispute is
          // re-fetched: the event's copy decides nothing. A subscription's disputed invoice is left to
          // the subscription's own status.
          const dispute = await stripe().disputes.retrieve((event.data.object as Stripe.Dispute).id);
          const pi = idOf(dispute.payment_intent);
          if (dispute.status !== "lost" || !pi) return jsonResponse(202, { ignored: true });
          result = await syncPayment(pi, true);
        } else if (event.type === "charge.refunded") {
          const pi = idOf((event.data.object as Stripe.Charge).payment_intent);
          if (!pi) return jsonResponse(202, { ignored: true });
          result = await syncPayment(pi);
        } else {
          return jsonResponse(202, { ignored: true });
        }
      } catch (error) {
        // Non-2xx so Stripe retries; nothing was marked processed.
        logWebhook("stripe", `failed ${event.type} ${event.id}`, error);
        return jsonResponse(500, { error: "processing_failed" });
      }

      const first = await (await sink()).markEventProcessed("stripe", event.id);
      logWebhook("stripe", `${event.type} ${event.id} → ${result}${first ? "" : " (redelivery)"}`);
      return jsonResponse(200, { received: true, result });
    },
  };
}
