import "server-only";

//
// usage.report: sends one recorded usage event to the billing provider's meter
// (Polar or Stripe), for a metric listed in BILLING_METERED_METRICS. recordUsage()
// in ../services/usage.ts queues it, one job per event, keyed by the event's id.
//
// Whose customer: a person's own; for an organisation, the customer of whoever
// pays its renewing subscription (the same payer billing uses). No customer (a
// free account, a team with no paid plan) means there is nothing to bill: the
// job ends without sending anything.
//
// At least once, like every job: the event's id goes to the provider as its
// idempotency id (Polar external_id, Stripe identifier), so a retry is a
// duplicate the provider drops, never a second charge.
//

import { z } from "zod";
import { isRenewing } from "@/core/types";
import { PermanentJobError, defineJob } from "./define";

export const usageReportJob = defineJob({
  kind: "usage.report",
  schema: z.strictObject({
    eventId: z.string().min(1).max(100),
    subject: z.strictObject({ type: z.enum(["user", "org"]), id: z.string().min(1).max(100) }),
    metric: z.string().min(1).max(40),
    quantity: z.number().int().min(0),
    occurredAt: z.iso.datetime({ offset: true }),
  }),
  // 30 s doubling to an hour, about 8 hours in all: a provider outage, not a lost event. Stripe takes
  // events up to 35 days old, Polar any.
  maxAttempts: 10,
  run: async ({ eventId, subject, metric, quantity, occurredAt }) => {
    const [{ getBilling }, { getData }] = await Promise.all([import("../billing"), import("../data")]);
    const provider = await getBilling();
    if (!provider) return; // billing switched off since it was queued
    if (!provider.reportUsage) throw new PermanentJobError(`${provider.label} has no meters: usage can't be reported to it.`);
    const data = await getData();
    let customerId: string | null;
    if (subject.type === "user") {
      customerId = await data.billing.getCustomerId(subject.id, provider.id);
    } else {
      const subs = await data.billing.listSubscriptions({ orgId: subject.id, limit: 50 });
      const paying = subs.items.find((s) => s.provider === provider.id && isRenewing(s));
      customerId = paying ? (paying.providerCustomerId ?? (await data.billing.getCustomerId(paying.userId, provider.id))) : null;
    }
    if (!customerId) return;
    await provider.reportUsage({ id: eventId, customerId, metric, quantity, occurredAt });
  },
});
