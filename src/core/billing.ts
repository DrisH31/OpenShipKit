//
// The billing contract, implemented by Polar (src/adapters/billing/polar):
// merchant of record — it handles VAT and sales tax and issues receipts.
// Optional: with BILLING_PROVIDER none (the default) the pricing page shows
// the plans and free plans still work; nothing can be bought.
//
// Rule that is never bent: access comes ONLY from a signature-verified webhook
// written into the DataStore (subscriptions / purchases). Never from the
// checkout redirect, a query string, or the client.
//

import type { BillingProviderId, Plan, PlanPrice, User } from "./types";

export type PaidProviderId = Exclude<BillingProviderId, "none">;
export const PAID_PROVIDERS: readonly PaidProviderId[] = ["polar", "stripe", "razorpay"];

export const PROVIDER_LABEL: Record<PaidProviderId, string> = { polar: "Polar", stripe: "Stripe", razorpay: "Razorpay" };

/** Which field of a plan price holds each provider's id, and what that id is called. */
export const PRICE_ID_FIELD = { polar: "polarProductId", stripe: "stripePriceId", razorpay: "razorpayPlanId" } as const satisfies Record<PaidProviderId, keyof PlanPrice>;
export const PRICE_ID_LABEL: Record<PaidProviderId, string> = { polar: "Polar product id", stripe: "Stripe price id", razorpay: "Razorpay plan id" };

/**
 * The id `provider` checks this price out by, and matches its webhooks against: the price's
 * provider field, or null when it hasn't been set (the price shows but can't be bought). A one-time
 * Razorpay price needs no Razorpay object (a payment link charges our amount), so its id is our own:
 * "<plan key>:one_time", stable however the amount is edited.
 */
export function priceIdFor(plan: Pick<Plan, "key">, price: PlanPrice, provider: PaidProviderId): string | null {
  if (provider === "razorpay" && price.interval === "one_time") return `${plan.key}:one_time`;
  const id = price[PRICE_ID_FIELD[provider]];
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Every provider id stored on a price (for uniqueness and for "don't orphan paying customers"). */
export function storedPriceIds(price: PlanPrice): { provider: PaidProviderId; field: (typeof PRICE_ID_FIELD)[PaidProviderId]; id: string }[] {
  return PAID_PROVIDERS.flatMap((provider) => {
    const field = PRICE_ID_FIELD[provider];
    const id = price[field];
    return typeof id === "string" && id.trim() ? [{ provider, field, id: id.trim() }] : [];
  });
}

export interface CheckoutInput {
  user: User;
  plan: Plan;
  price: PlanPrice;
  /** Existing provider customer id for this user, if any. */
  customerId: string | null;
  /**
   * The organisation it's bought for (OPENSHIPKIT_TENANCY=org), carried in the checkout's metadata so
   * the verified webhook binds the subscription to it. Absent for a personal plan.
   */
  orgId?: string;
  /** Seats to buy, for a per-seat price (price.perSeat). */
  seats?: number;
  successUrl: string;
  cancelUrl: string;
}

export interface BillingProvider {
  readonly id: Exclude<BillingProviderId, "none">;
  readonly label: string;
  /**
   * Whether the provider hosts a self-serve page (Polar, Stripe). Without one (Razorpay), the
   * billing page offers cancelAtPeriodEnd instead of Manage billing.
   */
  readonly hasPortal: boolean;
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  /** The provider's self-serve page: cancel, change card, invoices. Only when hasPortal. */
  createPortal(input: { user: User; customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /**
   * For a provider with no portal: stop a subscription renewing (it runs to the end of the period),
   * then hand its new state to the webhook sink, the same write path as a webhook.
   */
  cancelAtPeriodEnd?(providerSubscriptionId: string): Promise<void>;
  /**
   * Verify the signature, then apply the event through the DataStore
   * (idempotent via billing.claimWebhookEvent). Returns the HTTP response the
   * provider should get: 2xx when handled or ignored, 4xx on a bad signature.
   */
  handleWebhook(request: Request): Promise<Response>;
}
