"use server";

//
// The overview's one action: an admin marks the subscriptions still renewing at
// a provider this site no longer uses as handled (endStrandedSubscriptions).
//

import { refresh } from "next/cache";
import { PAID_PROVIDERS, type PaidProviderId } from "@/core/billing";
import { failure, type ActionState } from "@/lib/action-state";
import { attempt } from "@/server/attempt";
import { requireSaasProfile } from "@/server/profile";
import { requireAdmin } from "@/server/session";
import { endStrandedSubscriptions } from "@/server/services/billing";

export async function endStrandedAction(provider: string): Promise<ActionState> {
  const admin = await requireAdmin();
  requireSaasProfile();
  if (!(PAID_PROVIDERS as readonly string[]).includes(provider)) return failure("Unknown provider.");
  return attempt("admin.billing.end_stranded", async () => {
    const n = await endStrandedSubscriptions(admin, provider as PaidProviderId);
    refresh();
    return n === 1 ? "1 subscription stops renewing at the end of its period." : `${n} subscriptions stop renewing at the end of their periods.`;
  });
}
