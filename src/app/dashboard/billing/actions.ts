"use server";

//
// Cancel a subscription from the billing page, for a provider with no customer
// portal (Razorpay). requireUser() first; the service checks it's theirs and
// still renews, cancels at the end of the period through the provider, and audits.
//

import { refresh } from "next/cache";
import { type ActionState } from "@/lib/action-state";
import { attempt } from "@/server/attempt";
import { cancelSubscription } from "@/server/services/billing";
import { requireUser } from "@/server/session";

export async function cancelSubscriptionAction(subscriptionId: string): Promise<ActionState> {
  const user = await requireUser("/dashboard/billing");
  return attempt("dashboard.billing.cancel", async () => {
    await cancelSubscription(user, subscriptionId);
    refresh();
    return "Cancelled: it won't renew, and stays on until the end of the period you paid for.";
  });
}
