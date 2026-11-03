import "server-only";

//
// The provider-neutral half of billing webhooks that needs no app data:
// status mapping, logging, and the PORT a provider adapter hands its verified,
// re-fetched state to (BillingWebhookSink). The body cap is not here: the one
// caller, /api/billing/webhook, streams the body through readCapped
// (src/server/http.ts) and hands the adapter only bytes under its cap.
//
// Adapters never read or write the DataStore themselves (SPEC §2). An adapter
// verifies the signature, re-fetches the canonical object from its provider,
// normalises it into a ProviderSubscriptionState / ProviderOrderState, and
// calls the sink. The sink — the app's write path — resolves the user and the
// plan, writes, audits, and claims the event id.
//
// The idempotency design, in one place:
//   - Every handler RE-FETCHES the canonical object (subscription, order)
//     from the provider and writes THAT, as an upsert keyed by
//     (provider, providerSubscriptionId | providerOrderId). Applying it twice
//     is a no-op, and a late, older event can't regress state: whatever it
//     says, we write what the provider says now.
//   - The event id is claimed only AFTER the write succeeded. There is no
//     "claimed but not saved" window to lose an event in: if the process dies
//     mid-way, the provider redelivers and the work simply runs again.
//   - Audit rows are written only when the stored state actually changed, so
//     redeliveries don't flood /admin/audit.
//

import type { PaidProvider } from "@/core/data";
import type { Actor, PriceInterval, SubscriptionStatus } from "@/core/types";
import { log } from "@/server/log";

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Log a line about a webhook. Ids and event types only — never payloads, emails or secrets. */
export function logWebhook(provider: PaidProvider, message: string, error?: unknown): void {
  // The error's name and message only: a provider SDK's error can carry the request it failed on.
  if (error === undefined) log.info(`billing:${provider}`, message);
  else log.error(`billing:${provider}`, message, error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
}

/** Provider statuses → the app's. Anything unknown is treated as not entitled. */
export function mapStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "incomplete":
    case "unpaid":
    case "paused":
      return status;
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}

/** Append a query parameter to a URL that may already have a query, without encoding `{PLACEHOLDER}` braces. */
export function appendRawParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

// ------------------------------------------------------------------ the port

/** What applying one re-fetched object did — echoed in the webhook response and the log line. */
export type WebhookApplyResult = "applied" | "unchanged" | "unknown_user";

/** A provider subscription as the provider says it is NOW, normalised. No app ids resolved yet. */
export interface ProviderSubscriptionState {
  provider: PaidProvider;
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  /** Candidate app user ids, best first (the external customer id set at checkout, then metadata). */
  userIdHints: (string | null | undefined)[];
  /** Matched against the Polar product ids in /admin/plans. */
  productId: string | null;
  /**
   * The plan key our checkout put in metadata. Used only when the product isn't
   * on any plan (its id was edited in /admin/plans since), and only while
   * productId still equals checkoutProductId — see the sink's planFromCheckout.
   */
  planKeyHint: string | null;
  /** The product id our checkout sold, from the same metadata. Binds planKeyHint to that product. */
  checkoutProductId: string | null;
  /** The organisation our checkout bought it for (metadata), or null for a personal plan. */
  orgIdHint?: string | null;
  /** Seats on a seat-based subscription; null otherwise. */
  seats?: number | null;
  /** The provider's own billing interval, used only when the product isn't on any plan. */
  interval: PriceInterval | null;
  status: SubscriptionStatus;
  /** Any ISO-8601 instant (the provider's precision and offset); the sink normalises it. */
  /** When the current period began, where the provider says (it anchors the usage period). */
  currentPeriodStart?: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /**
   * False when the provider's object can't say whether it is set to end (Razorpay keeps a pending
   * cycle-end cancellation "active" with no field for it): the sink then keeps what it recorded,
   * until the subscription actually ends.
   */
  cancelAtPeriodEndKnown?: boolean;
}

/** A provider one-time order as the provider says it is NOW, normalised. */
export interface ProviderOrderState {
  provider: PaidProvider;
  providerOrderId: string;
  providerCustomerId: string | null;
  userIdHints: (string | null | undefined)[];
  productId: string | null;
  /** The plan key our checkout put in metadata; same rule as ProviderSubscriptionState.planKeyHint. */
  planKeyHint: string | null;
  /** The product id our checkout sold, from the same metadata. */
  checkoutProductId: string | null;
  amountCents: number;
  currency: string;
  /** A FULL refund ends access; a partial refund keeps it. Follows the provider (a failed refund comes back). */
  refunded: boolean;
  /** A chargeback the merchant lost: ends access for good (the sink keeps it). */
  chargedBack?: boolean;
}

/**
 * The app's billing write path, as a provider adapter sees it. Implemented in
 * src/adapters/billing/webhook-sink.ts for now (bound for
 * src/server/services/billing-webhooks.ts); tests may pass their own.
 */
export interface BillingWebhookSink {
  /** `actor`: who caused it, when it isn't a webhook (a person cancelling in the app). Default webhook:<provider>. */
  applySubscription(state: ProviderSubscriptionState, opts?: { actor?: Actor }): Promise<WebhookApplyResult>;
  applyOrder(state: ProviderOrderState): Promise<WebhookApplyResult>;
  /** Claim the event id — call LAST, after the write succeeded. False when it was already claimed. */
  markEventProcessed(provider: PaidProvider, eventId: string): Promise<boolean>;
}
