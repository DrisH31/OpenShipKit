import "server-only";

//
// BILLING_PROVIDER=polar — Polar.sh as merchant of record (it collects and
// remits VAT / sales tax and issues the receipts).
//
//   POLAR_ACCESS_TOKEN    organisation access token (sandbox and production tokens are separate)
//   POLAR_WEBHOOK_SECRET  the endpoint's signing secret, copied exactly as Polar shows it
//   POLAR_SERVER          sandbox | production (default: production in production, else sandbox)
//
// The API version is pinned by the import path (@polar-sh/sdk/2026-10); create
// the webhook endpoint in Polar with the same API version, format "raw", URL
// <site>/api/billing/webhook, and the subscription.*, order.* and refund.* events.
//
// Non-obvious rules:
//  - Both webhook-secret formats work: Polar's original one (the UTF-8 bytes of
//    the whole `whsec_…` string) and the Standard Webhooks one created since
//    8 Sep 2026 (base64 after `whsec_`). The SDK's validateEvent tries both.
//  - Ordering-proof: an event only says "something changed". We re-fetch the
//    subscription / order from the API and store what Polar says NOW, so a
//    late, older event can't resurrect a revoked subscription.
//  - This adapter never touches the DataStore. It verifies, re-fetches, and
//    hands Polar's current state to a BillingWebhookSink (../shared.ts), the
//    app's write path, which resolves the user and plan, writes, audits, and
//    marks the event processed only after the write.
//

import { createPolar, webhooks, type models } from "@polar-sh/sdk/2026-10";
import type { BillingProvider, CheckoutInput } from "@/core/billing";
import { isProduction, optionalEnv, requireEnv } from "@/server/env";
import {
  type BillingWebhookSink,
  type WebhookApplyResult,
  appendRawParam,
  jsonResponse,
  logWebhook,
  mapStatus,
} from "../shared";

/** The subset of the Polar client this adapter uses — what tests fake. */
export interface PolarClient {
  checkouts: { create(body: models.CheckoutCreate): Promise<{ url: string }> };
  customerSessions: {
    create(body: models.CustomerSessionCustomerIDCreate | models.CustomerSessionCustomerExternalIDCreate): Promise<{ customer_portal_url: string }>;
  };
  subscriptions: { get(id: string): Promise<models.Subscription> };
  orders: { get(id: string): Promise<models.Order> };
  events: { ingest(body: models.EventsIngest): Promise<models.EventsIngestResponse> };
  products: { get(id: string): Promise<models.Product> };
}

export interface PolarProviderOptions {
  /** Inject a client (tests). Defaults to the real SDK client, created on first use. */
  client?: PolarClient;
  /** Override POLAR_WEBHOOK_SECRET (tests). */
  webhookSecret?: string;
  /**
   * Where verified, re-fetched state goes — the app's billing write path.
   * Defaults to ../webhook-sink, loaded on the first webhook (transitional:
   * the registry is meant to pass it; see that file's header).
   */
  sink?: BillingWebhookSink;
}

function polarServer(): "sandbox" | "production" {
  const v = optionalEnv("POLAR_SERVER");
  if (!v) return isProduction() ? "production" : "sandbox";
  if (v === "sandbox" || v === "production") return v;
  throw new Error(`POLAR_SERVER="${v}" is not one of: sandbox, production`);
}

export function createPolarProvider(options: PolarProviderOptions = {}): BillingProvider {
  let client: PolarClient | null = options.client ?? null;
  // Lazy: the build and the registry never need the token; the first real call does.
  const polar = (): PolarClient => {
    if (!client) {
      client = createPolar({
        accessToken: requireEnv("POLAR_ACCESS_TOKEN", "Polar billing"),
        environment: polarServer(),
        timeout: 20,
      });
    }
    return client;
  };

  let sinkPromise: Promise<BillingWebhookSink> | null = options.sink ? Promise.resolve(options.sink) : null;
  const sink = (): Promise<BillingWebhookSink> => {
    sinkPromise ??= import("../webhook-sink").then(
      (m) => m.billingWebhookSink,
      (error: unknown) => {
        sinkPromise = null; // don't cache a failed load; the retry tries again
        throw error;
      },
    );
    return sinkPromise;
  };

  /** Re-fetch a subscription and hand Polar's current state for it to the sink. */
  async function syncSubscription(subscriptionId: string): Promise<WebhookApplyResult> {
    const sub = await polar().subscriptions.get(subscriptionId);
    return (await sink()).applySubscription({
      provider: "polar",
      providerSubscriptionId: sub.id,
      providerCustomerId: sub.customer_id,
      userIdHints: [sub.customer?.external_id, metaString(sub.metadata, "userId")],
      productId: sub.product_id,
      planKeyHint: metaString(sub.metadata, "planKey"),
      checkoutProductId: metaString(sub.metadata, "productId"),
      orgIdHint: metaString(sub.metadata, "orgId"),
      seats: typeof sub.seats === "number" ? sub.seats : null,
      interval: sub.recurring_interval === "year" ? "year" : sub.recurring_interval === "month" ? "month" : null,
      status: mapStatus(sub.status),
      currentPeriodStart: sub.current_period_start ?? null,
      currentPeriodEnd: sub.ended_at ?? sub.current_period_end ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });
  }

  /** Re-fetch an order: renewals re-sync their subscription; paid one-time orders go to the sink as purchases. */
  async function syncOrder(orderId: string): Promise<WebhookApplyResult | "not_paid"> {
    const order = await polar().orders.get(orderId);
    if (order.subscription_id) return syncSubscription(order.subscription_id);
    if (!["paid", "refunded", "partially_refunded"].includes(order.status)) return "not_paid";
    return (await sink()).applyOrder({
      provider: "polar",
      providerOrderId: order.id,
      providerCustomerId: order.customer_id,
      userIdHints: [order.customer?.external_id, metaString(order.metadata, "userId")],
      productId: order.product_id,
      planKeyHint: metaString(order.metadata, "planKey"),
      checkoutProductId: metaString(order.metadata, "productId"),
      amountCents: order.total_amount,
      currency: order.currency.toLowerCase(),
      // A partial refund keeps access; a full refund ends it.
      refunded: order.status === "refunded",
    });
  }

  return {
    id: "polar",
    label: "Polar",
    hasPortal: true,

    async createCheckout(input: CheckoutInput) {
      const { user, plan, price, customerId } = input;
      if (!price.polarProductId) throw new Error(`Plan "${plan.key}" (${price.interval}) has no Polar product id`);
      const recurring = price.interval !== "one_time";
      const body: models.CheckoutCreate = {
        products: [price.polarProductId],
        // Polar fills {CHECKOUT_ID}; the page may show "confirming…" with it. It grants nothing.
        success_url: appendRawParam(input.successUrl, "checkout_id={CHECKOUT_ID}"),
        return_url: input.cancelUrl,
        // productId binds planKey to the product sold here: the webhook honours
        // planKey only while the subscription is still on this product.
        // orgId binds the subscription to the organisation it's bought for (teams); never trusted from anywhere else.
        metadata: {
          userId: user.id,
          planKey: plan.key,
          interval: price.interval,
          productId: price.polarProductId,
          ...(input.orgId ? { orgId: input.orgId } : {}),
        },
        ...(input.seats !== undefined ? { seats: input.seats } : {}),
        allow_discount_codes: true,
        ...(customerId
          ? { customer_id: customerId }
          : { external_customer_id: user.id, customer_email: user.email, ...(user.name ? { customer_name: user.name } : {}) }),
        ...(recurring && plan.trialDays ? { trial_interval: "day" as const, trial_interval_count: plan.trialDays } : {}),
      };
      const checkout = await polar().checkouts.create(body);
      return { url: checkout.url };
    },

    async createPortal({ customerId, returnUrl }) {
      const session = await polar().customerSessions.create({ customer_id: customerId, return_url: returnUrl });
      return { url: session.customer_portal_url };
    },

    // A Polar meter filters on the event name (the metric) and sums metadata.quantity. external_id
    // makes a retried job a duplicate Polar skips, not a second charge.
    canMeter: () => Boolean(options.client) || Boolean(optionalEnv("POLAR_ACCESS_TOKEN")),

    async reportUsage({ id, customerId, metric, quantity, occurredAt }) {
      await polar().events.ingest({ events: [{ name: metric, customer_id: customerId, external_id: id, timestamp: occurredAt, metadata: { quantity } }] });
    },

    async describePrice(id: string) {
      const product = await polar().products.get(id).catch((error: { statusCode?: number }) => {
        if (error?.statusCode === 404) return null;
        throw error;
      });
      if (!product) return null;
      const fixed = product.prices.find((p) => !p.is_archived && "amount_type" in p && p.amount_type === "fixed") as { price_amount: number; price_currency: string } | undefined;
      const r = product.recurring_interval;
      return {
        amountCents: fixed?.price_amount ?? null,
        currency: fixed?.price_currency ?? null,
        interval: !product.is_recurring ? "one_time" : (r === "month" || r === "year") && (product.recurring_interval_count ?? 1) === 1 ? r : "other",
      };
    },

    async handleWebhook(request: Request) {
      // The exact bytes Polar signed, as text — never parsed before verifying (a
      // JSON round-trip breaks the signature). Already capped: the route streams
      // the body through readCapped and hands over only what fit.
      const body = await request.text();
      const headers = {
        "webhook-id": request.headers.get("webhook-id") ?? "",
        "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": request.headers.get("webhook-signature") ?? "",
      };
      const secret = options.webhookSecret ?? requireEnv("POLAR_WEBHOOK_SECRET", "verifying Polar webhooks");

      let event: webhooks.WebhookPayload;
      try {
        event = await webhooks.validateEvent(body, headers, secret);
      } catch (error) {
        if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
          // Signed, but newer than the pinned API version knows. Acknowledge so Polar doesn't disable the endpoint.
          logWebhook("polar", `ignored unknown event type ${error.eventType ?? "?"}`);
          return jsonResponse(202, { ignored: true });
        }
        if (error instanceof webhooks.PolarWebhookVerificationError) {
          logWebhook("polar", `rejected webhook ${headers["webhook-id"] || "(no id)"}: ${error.message}`);
          return jsonResponse(403, { error: "invalid_signature" });
        }
        if (error instanceof webhooks.PolarWebhookError) return jsonResponse(400, { error: "invalid_payload" });
        throw error;
      }

      const eventId = headers["webhook-id"];
      let result: WebhookApplyResult | "not_paid";
      try {
        if (event.type.startsWith("subscription.")) {
          result = await syncSubscription((event.data as models.Subscription).id);
        } else if (event.type === "order.paid" || event.type === "order.refunded" || event.type === "order.updated") {
          result = await syncOrder(event.data.id);
        } else if (event.type === "refund.created" || event.type === "refund.updated") {
          result = await syncOrder(event.data.order_id);
        } else {
          return jsonResponse(202, { ignored: true });
        }
      } catch (error) {
        // Non-2xx so Polar retries; nothing was marked processed.
        logWebhook("polar", `failed ${event.type} ${eventId}`, error);
        return jsonResponse(500, { error: "processing_failed" });
      }

      const first = await (await sink()).markEventProcessed("polar", eventId);
      logWebhook("polar", `${event.type} ${eventId} → ${result}${first ? "" : " (redelivery)"}`);
      return jsonResponse(200, { received: true, result });
    },
  };
}

function metaString(meta: Record<string, string | number | boolean> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" && v ? v : null;
}
