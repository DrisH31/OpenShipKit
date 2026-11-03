import "server-only";

//
// The billing registry: Polar (merchant of record — it handles VAT and sales
// tax and issues receipts), Stripe, or Razorpay (BILLING_PROVIDER, one at a
// time), or null when billing is off (the default). Callers
// must handle "billing is off": pricing still renders; checkout buttons say so.
// Under OPENSHIPKIT_PROFILE=site it is always off (billingProvider() says none),
// checked on every call rather than cached, so the profile always wins.
//

import type { BillingProvider } from "@/core/billing";
import { billingProvider } from "./env";

let provider: Promise<BillingProvider> | null = null;

export async function getBilling(): Promise<BillingProvider | null> {
  const id = billingProvider();
  if (id === "none") return null;
  provider ??=
    id === "stripe"
      ? import("@/adapters/billing/stripe").then((m) => m.createStripeProvider())
      : id === "razorpay"
        ? import("@/adapters/billing/razorpay").then((m) => m.createRazorpayProvider())
        : import("@/adapters/billing/polar").then((m) => m.createPolarProvider());
  return provider;
}
