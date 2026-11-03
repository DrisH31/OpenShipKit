import "server-only";

//
// usage.report: sends one stored usage event to the billing provider's meter
// (Polar or Stripe). The usage service queues it for an event recorded as
// pending (a metric in BILLING_METERED_METRICS), keyed by the event's id; the
// sweep in ../services/usage.ts re-queues any left pending.
//
// What is sent is read from the stored event, never from whoever queued it,
// and an event no longer pending is skipped: so a repeated recordUsage, a
// re-queue or a retry from /admin/jobs can't charge twice. The one window left
// is a crash between the provider accepting the event and settleReport; the
// retry then sends the same event id, which the provider drops as a duplicate
// (Polar external_id; Stripe identifier, within its 24 hours, well inside this
// job's retries).
//
// An event ends in one of two states, never confused: sent (reportedAt, when
// the provider accepted it), or settled with nothing to send, because nobody
// is billed for it (a free account, a team with no paid plan). Billing that is
// off or can't meter in this process (a missing key, a provider with no meters)
// is neither: the attempt fails, the event stays pending, and the job's error
// in /admin/jobs says why. A worker with a bad env file never drops usage.
//
// Whose customer: a person's own; for an organisation, the customer of the
// subscription that gives it access (paid up, even if set to cancel).
//

import { z } from "zod";
import { grantsAccess } from "@/core/types";
import { getBilling } from "../billing";
import { getData } from "../data";
import { log } from "../log";
import { defineJob } from "./define";

export const usageReportJob = defineJob({
  kind: "usage.report",
  schema: z.strictObject({ eventId: z.string().min(1).max(100) }),
  // 30 s doubling to an hour: about three hours of retries in all, which outlasts a provider outage.
  // The sweep re-queues an event still pending after that, for a day.
  maxAttempts: 10,
  run: async ({ eventId }) => {
    const data = await getData();
    const event = await data.usage.get(eventId);
    if (!event || !event.reportPending) return; // gone, or already sent or settled
    const provider = await getBilling();
    if (!provider) throw new Error("Billing is off in this process, so metered usage can't be reported. It stays pending until billing is back.");
    if (!provider.reportUsage) throw new Error(`${provider.label} has no meters, so metered usage can't be reported to it. It stays pending.`);
    let customerId: string | null;
    if (event.subject.type === "user") {
      customerId = await data.billing.getCustomerId(event.subject.id, provider.id);
    } else {
      const subs = await data.billing.listSubscriptions({ orgId: event.subject.id, limit: 50 });
      const paying = subs.items.find((s) => s.provider === provider.id && grantsAccess(s));
      customerId = paying ? (paying.providerCustomerId ?? (await data.billing.getCustomerId(paying.userId, provider.id))) : null;
    }
    if (!customerId) {
      log.info("usage", `${event.metric} event ${event.id}: no ${provider.label} customer to bill; settled without sending`);
      await data.usage.settleReport(event.id, null);
      return;
    }
    await provider.reportUsage({ id: event.id, customerId, metric: event.metric, quantity: event.quantity, occurredAt: event.occurredAt });
    await data.usage.settleReport(event.id, new Date().toISOString());
  },
});
