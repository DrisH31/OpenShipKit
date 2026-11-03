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
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  /** The provider's self-serve page: cancel, change card, invoices. */
  createPortal(input: { user: User; customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /**
   * Verify the signature, then apply the event through the DataStore
   * (idempotent via billing.claimWebhookEvent). Returns the HTTP response the
   * provider should get: 2xx when handled or ignored, 4xx on a bad signature.
   */
  handleWebhook(request: Request): Promise<Response>;
}
