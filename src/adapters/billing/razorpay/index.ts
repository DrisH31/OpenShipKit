import "server-only";

//
// BILLING_PROVIDER=razorpay: Razorpay subscriptions and payment links, for
// selling in India (UPI, cards, netbanking). Razorpay isn't the merchant of
// record; GST invoices are set up in its dashboard.
//
//   RAZORPAY_KEY_ID          rzp_test_… or rzp_live_…
//   RAZORPAY_KEY_SECRET      the key's secret
//   RAZORPAY_WEBHOOK_SECRET  the secret typed when creating the webhook
//
// A recurring plan price carries the Razorpay plan it subscribes to
// (razorpayPlanId, plan_…). A one-time price needs nothing in Razorpay: a
// payment link charges our own amount. Webhook endpoint: <site>/api/billing/webhook,
// with the subscription.* events, payment_link.paid, refund.processed, refund.failed and payment.dispute.lost.
//
// Rules, on top of the Polar adapter's (../polar):
//  - Verify first: an HMAC-SHA256 hex digest of the raw body with the webhook
//    secret, compared in constant time with X-Razorpay-Signature. The event id
//    (deduplication) is the x-razorpay-event-id header.
//  - Ordering-proof: re-fetch the subscription or payment and hand what Razorpay
//    says NOW to the sink (../webhook-sink).
//  - No customer portal: the billing page offers Cancel instead, and
//    cancelAtPeriodEnd() cancels at the end of the cycle through the API.
//    Razorpay keeps such a subscription "active" with no field saying it
//    will end, so its state is cancelAtPeriodEndKnown: false, and the sink
//    keeps the cancellation we recorded within the period it was recorded
//    in (a later period means Razorpay charged again: the cancel didn't take).
//  - One-time purchases: when a payment link is paid, our notes are copied onto
//    the payment, so a refund event (which names only the payment) can be
//    traced back to the purchase.
//  - total_count is required by Razorpay: 120 months or 10 years, renewed by
//    the customer when it runs out (it shows as completed).
//

import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { BillingProviderError, type BillingProvider, type CheckoutInput } from "@/core/billing";
import { priceIdFor } from "@/core/billing";
import type { Actor, SubscriptionStatus } from "@/core/types";
import { requireEnv } from "@/server/env";
import { type BillingWebhookSink, type ProviderOrderState, type ProviderSubscriptionState, type WebhookApplyResult, jsonResponse, logWebhook } from "../shared";

type Notes = Record<string, string | number> | null | undefined;

/** The Razorpay objects this adapter reads: only the fields it uses (what tests fake). */
export type RazorpaySubscription = {
  id: string;
  status: string;
  plan_id: string;
  quantity?: number | null;
  customer_id: string | null;
  notes?: Notes;
  current_start?: number | null;
  paid_count?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  start_at?: number | null;
};
export type RazorpayPayment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  customer_id?: string | null;
  notes?: Notes;
  refund_status?: string | null;
};
export type RazorpayPaymentLink = { id: string; short_url: string; status: string; payments?: { payment_id: string; status: string }[] | null };

/** The subset of the Razorpay client this adapter uses. */
export interface RazorpayClient {
  subscriptions: {
    create(body: Record<string, unknown>): Promise<{ id: string; short_url: string }>;
    fetch(id: string): Promise<RazorpaySubscription>;
    cancel(id: string, cancelAtCycleEnd: boolean): Promise<RazorpaySubscription>;
  };
  paymentLink: {
    create(body: Record<string, unknown>): Promise<{ id: string; short_url: string }>;
    fetch(id: string): Promise<RazorpayPaymentLink>;
  };
  payments: {
    fetch(id: string): Promise<RazorpayPayment>;
    edit(id: string, body: { notes: Record<string, string> }): Promise<unknown>;
  };
  disputes: { fetch(id: string): Promise<{ id: string; payment_id: string; status: string }> };
  plans: { fetch(id: string): Promise<{ id: string; period: string; interval: number; item: { amount: number | string; currency: string } }> };
}

export interface RazorpayProviderOptions {
  client?: RazorpayClient;
  webhookSecret?: string;
  sink?: BillingWebhookSink;
}

/** Razorpay subscription statuses → the app's. Exported for the tests. */
export function mapRazorpayStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "authenticated": // the mandate is set up, the first charge not yet made: a trial only if it starts later (razorpaySubscriptionState)
      return "trialing";
    case "pending": // a charge failed; Razorpay is retrying
      return "past_due";
    case "halted": // retries exhausted
      return "unpaid";
    case "paused":
      return "paused";
    case "cancelled":
    case "completed":
    case "expired":
      return "canceled";
    default: // created: not paid for yet
      return "incomplete";
  }
}

const note = (notes: Notes, key: string): string | null => (notes?.[key] !== undefined && notes?.[key] !== "" ? String(notes[key]) : null);
const iso = (unixSeconds: number | null | undefined): string | null => (typeof unixSeconds === "number" && unixSeconds > 0 ? new Date(unixSeconds * 1000).toISOString() : null);

/** A Razorpay subscription as the sink's state. Exported for the tests. */
export function razorpaySubscriptionState(sub: RazorpaySubscription, now = Date.now()): ProviderSubscriptionState {
  let status = mapRazorpayStatus(sub.status);
  // "authenticated" with no later start (no trial) is the moment between the mandate and the first
  // charge: not paid yet, so no access until subscription.activated. A trial always has its end
  // (start_at); a trialing row with no end would grant access with no end at all.
  if (status === "trialing" && !(typeof sub.start_at === "number" && sub.start_at * 1000 > now)) status = "incomplete";
  // A trial cancelled before its first charge: Razorpay says cancelled, but the person keeps the trial
  // until it would have ended (start_at), as with every other provider. Derived from Razorpay's own
  // object, so a webhook's re-fetch agrees.
  // Only for a real trial: the mandate was set up (Razorpay names the customer on authentication). A
  // checkout abandoned before that and cancelled later never had a trial.
  const trialLeft = typeof sub.start_at === "number" && sub.start_at * 1000 > now && !sub.current_start && !sub.paid_count && Boolean(sub.customer_id);
  const cancelledTrial = status === "canceled" && sub.status === "cancelled" && trialLeft;
  if (cancelledTrial) status = "trialing";
  return {
    provider: "razorpay",
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customer_id ?? null,
    userIdHints: [note(sub.notes, "userId")],
    productId: sub.plan_id,
    planKeyHint: note(sub.notes, "planKey"),
    checkoutProductId: note(sub.notes, "productId"),
    orgIdHint: note(sub.notes, "orgId"),
    seats: typeof sub.quantity === "number" ? sub.quantity : null,
    // Our checkout's notes say which price was sold (Razorpay's plan knows only its period); else the
    // sink takes it from the matching plan price.
    interval: ((i) => (i === "month" || i === "year" ? i : null))(note(sub.notes, "interval")),
    status,
    currentPeriodStart: iso(sub.current_start),
    currentPeriodEnd: cancelledTrial ? iso(sub.start_at) : (iso(sub.ended_at) ?? iso(sub.current_end) ?? (status === "trialing" ? iso(sub.start_at) : null)),
    cancelAtPeriodEnd: cancelledTrial,
    cancelAtPeriodEndKnown: false,
  };
}

/** A captured one-time payment (carrying our notes) as the sink's order state. Exported for the tests. */
export function razorpayOrderState(payment: RazorpayPayment, disputeLost = false): ProviderOrderState {
  return {
    provider: "razorpay",
    providerOrderId: payment.id,
    providerCustomerId: payment.customer_id ?? null,
    userIdHints: [note(payment.notes, "userId")],
    productId: note(payment.notes, "productId"),
    planKeyHint: note(payment.notes, "planKey"),
    checkoutProductId: note(payment.notes, "productId"),
    amountCents: payment.amount,
    currency: payment.currency.toLowerCase(),
    // A full refund ends access; a partial one keeps it. A lost chargeback ends it for good.
    refunded: payment.refund_status === "full",
    chargedBack: disputeLost,
  };
}

/** Constant-time check of X-Razorpay-Signature: hex HMAC-SHA256 of the raw body. Exported for the tests. */
export function validRazorpaySignature(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Subscriptions run for this many cycles at most (Razorpay requires a count). */
const TOTAL_COUNT = { month: 120, year: 10 } as const;

export function createRazorpayProvider(options: RazorpayProviderOptions = {}): BillingProvider {
  let client: RazorpayClient | null = options.client ?? null;
  const razorpay = (): RazorpayClient =>
    (client ??= new Razorpay({
      key_id: requireEnv("RAZORPAY_KEY_ID", "Razorpay billing"),
      key_secret: requireEnv("RAZORPAY_KEY_SECRET", "Razorpay billing"),
    }) as unknown as RazorpayClient);

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

  const syncSubscription = async (id: string) => (await sink()).applySubscription(razorpaySubscriptionState(await razorpay().subscriptions.fetch(id)));

  /** A payment of ours (it carries our notes): grant or revoke the one-time purchase. */
  async function syncPayment(paymentId: string, disputeLost = false): Promise<WebhookApplyResult | "not_paid"> {
    const payment = await razorpay().payments.fetch(paymentId);
    if (!note(payment.notes, "planKey")) return "not_paid"; // not a purchase our checkout made
    if (payment.status !== "captured" && payment.status !== "refunded") return "not_paid";
    return (await sink()).applyOrder(razorpayOrderState(payment, disputeLost));
  }

  /** A paid link: copy our notes onto its captured payments (for later refunds), then record them. */
  async function syncPaymentLink(linkId: string, linkNotes: Record<string, string>): Promise<WebhookApplyResult | "not_paid"> {
    const link = await razorpay().paymentLink.fetch(linkId);
    if (link.status !== "paid") return "not_paid";
    let result: WebhookApplyResult | "not_paid" = "not_paid";
    for (const p of link.payments ?? []) {
      if (p.status !== "captured") continue;
      const payment = await razorpay().payments.fetch(p.payment_id);
      if (!note(payment.notes, "planKey")) await razorpay().payments.edit(p.payment_id, { notes: linkNotes });
      result = await syncPayment(p.payment_id);
    }
    return result;
  }

  return {
    id: "razorpay",
    label: "Razorpay",
    hasPortal: false,

    async createCheckout(input: CheckoutInput) {
      const { user, plan, price } = input;
      const productId = priceIdFor(plan, price, "razorpay");
      if (!productId) throw new Error(`Plan "${plan.key}" (${price.interval}) has no Razorpay plan id`);
      const notes: Record<string, string> = {
        userId: user.id,
        planKey: plan.key,
        interval: price.interval,
        productId,
        ...(input.orgId ? { orgId: input.orgId } : {}),
      };
      if (price.interval === "one_time") {
        const link = await razorpay().paymentLink.create({
          amount: price.amountCents,
          currency: price.currency.toUpperCase(),
          description: plan.name,
          customer: { email: user.email, ...(user.name ? { name: user.name } : {}) },
          notify: { email: false, sms: false },
          notes,
          callback_url: input.successUrl,
          callback_method: "get",
        });
        return { url: link.short_url };
      }
      const startAt = plan.trialDays ? Math.floor(Date.now() / 1000) + plan.trialDays * 86_400 : undefined;
      const sub = await razorpay().subscriptions.create({
        plan_id: productId,
        total_count: TOTAL_COUNT[price.interval],
        quantity: input.seats ?? 1,
        customer_notify: 1,
        notes,
        ...(startAt ? { start_at: startAt } : {}),
      });
      return { url: sub.short_url };
    },

    async createPortal() {
      throw new Error("Razorpay has no customer portal: cancel from the billing page instead.");
    },

    // The intent is written first, as a compare-and-set: the row says "won't renew" before Razorpay
    // is asked (Razorpay allows one cancel call), and a second press at once stops here, not at
    // Razorpay. The sink keeps that intent only while Razorpay reports the same period: if Razorpay
    // charges again (the call never landed), the row renews again and Cancel comes back.
    //   - Refused (a 4xx): the row goes back to renewing, and the person sees Razorpay's reason.
    //   - No answer (a timeout, a 5xx): left as "ending", and the person is told exactly that.
    // A subscription with no billing cycle yet (authenticated: a trial or a mandate before its first
    // charge; created: never paid) can't be cancelled "at cycle end"; Razorpay refuses with "no billing
    // cycle is going on". It is cancelled now, which stops the first charge; a trial keeps its access
    // until its own end (razorpaySubscriptionState).
    async cancelAtPeriodEnd(providerSubscriptionId: string, actor: Actor) {
      const out = await sink();
      const before = await razorpay().subscriptions.fetch(providerSubscriptionId);
      if (mapRazorpayStatus(before.status) === "canceled") {
        await out.applySubscription({ ...razorpaySubscriptionState(before), cancelAtPeriodEndKnown: true }, { actor });
        return;
      }
      if (!(await out.requestCancel("razorpay", providerSubscriptionId, actor))) {
        throw new BillingProviderError("conflict", "It's already set to end.");
      }
      const inCycle = before.status !== "authenticated" && before.status !== "created";
      try {
        await razorpay().subscriptions.cancel(providerSubscriptionId, inCycle);
      } catch (error) {
        const e = error as { statusCode?: number; error?: { description?: string } } | null;
        const reason = e?.error?.description ?? (error instanceof Error ? error.message : "no reason given");
        logWebhook("razorpay", `cancel ${providerSubscriptionId} failed: ${e?.statusCode ?? "?"} ${reason}`);
        if (typeof e?.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
          await out.applySubscription({ ...razorpaySubscriptionState(before), cancelAtPeriodEnd: false, cancelAtPeriodEndKnown: true }, { actor });
          throw new BillingProviderError("refused", `Razorpay refused the cancellation: ${reason}`);
        }
        throw new BillingProviderError(
          "no_answer",
          "Razorpay didn't answer, so it's marked here as ending. If Razorpay charges it again anyway, it shows as renewing on this page and you can cancel it again.",
        );
      }
      // Razorpay accepted: the cancel is done, and the row already says it ends. A failure from here (the
      // re-fetch, the write) isn't the person's problem: logged, and the next webhook settles the row.
      try {
        const state = razorpaySubscriptionState(await razorpay().subscriptions.fetch(providerSubscriptionId));
        await out.applySubscription({ ...state, cancelAtPeriodEnd: state.status !== "canceled" || state.cancelAtPeriodEnd, cancelAtPeriodEndKnown: true }, { actor });
      } catch (error) {
        logWebhook("razorpay", `cancel ${providerSubscriptionId}: accepted by Razorpay, but recording its new state failed; the next webhook will`, error);
      }
    },

    async describePrice(id: string) {
      if (id.endsWith(":one_time")) return "skip" as const; // a payment link for the plan's own amount: ours, nothing to compare
      const plan = await razorpay().plans.fetch(id).catch((error: { statusCode?: number }) => {
        if (error?.statusCode === 400 || error?.statusCode === 404) return null; // Razorpay answers an unknown id with 400
        throw error;
      });
      if (!plan) return null;
      const interval = plan.interval === 1 && plan.period === "monthly" ? "month" : plan.interval === 1 && plan.period === "yearly" ? "year" : "other";
      return { amountCents: Number(plan.item.amount), currency: plan.item.currency, interval };
    },

    async handleWebhook(request: Request) {
      const body = await request.text();
      const signature = request.headers.get("x-razorpay-signature") ?? "";
      const eventId = request.headers.get("x-razorpay-event-id") ?? "";
      const secret = options.webhookSecret ?? requireEnv("RAZORPAY_WEBHOOK_SECRET", "verifying Razorpay webhooks");
      if (!signature || !validRazorpaySignature(body, signature, secret)) {
        logWebhook("razorpay", `rejected webhook ${eventId || "(no id)"}: invalid signature`);
        return jsonResponse(403, { error: "invalid_signature" });
      }
      if (!eventId) return jsonResponse(400, { error: "missing_event_id" });

      let event: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> };
      try {
        event = JSON.parse(body);
      } catch {
        return jsonResponse(400, { error: "invalid_payload" });
      }
      const type = event.event ?? "";
      const entity = (key: string) => event.payload?.[key]?.entity;

      let result: WebhookApplyResult | "not_paid";
      try {
        if (type.startsWith("subscription.")) {
          const id = entity("subscription")?.id;
          if (typeof id !== "string") return jsonResponse(202, { ignored: true });
          result = await syncSubscription(id);
        } else if (type === "payment_link.paid") {
          const link = entity("payment_link");
          if (typeof link?.id !== "string") return jsonResponse(202, { ignored: true });
          const notes = Object.fromEntries(Object.entries((link.notes as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)]));
          result = await syncPaymentLink(link.id, notes);
        } else if (type === "payment.dispute.lost") {
          // A lost chargeback revokes a one-time purchase (the sink keeps it revoked); re-fetched first.
          const id = entity("dispute")?.id;
          if (typeof id !== "string") return jsonResponse(202, { ignored: true });
          const dispute = await razorpay().disputes.fetch(id);
          if (dispute.status !== "lost") return jsonResponse(202, { ignored: true });
          result = await syncPayment(dispute.payment_id, true);
        } else if (type === "refund.processed" || type === "refund.failed") {
          const paymentId = entity("refund")?.payment_id;
          if (typeof paymentId !== "string") return jsonResponse(202, { ignored: true });
          result = await syncPayment(paymentId);
        } else {
          return jsonResponse(202, { ignored: true });
        }
      } catch (error) {
        logWebhook("razorpay", `failed ${type} ${eventId}`, error);
        return jsonResponse(500, { error: "processing_failed" });
      }

      const first = await (await sink()).markEventProcessed("razorpay", eventId);
      logWebhook("razorpay", `${type} ${eventId} → ${result}${first ? "" : " (redelivery)"}`);
      return jsonResponse(200, { received: true, result });
    },
  };
}
