import "server-only";

//
// usage.report: sends one stored usage event to the billing provider's meter
// (Polar or Stripe). The usage service queues it for an event recorded as
// pending (a metric in BILLING_METERED_METRICS), keyed by the event's id; the
// sweep in ../services/usage.ts re-queues any left pending.
//
// What is sent is read from the stored event, never from whoever queued it,
// and an event already reported is skipped: so a repeated recordUsage, a
// re-queue or a retry from /admin/jobs can't charge twice. The one window left
// is a crash between the provider accepting the event and markReported; the
// retry then sends the same event id, which the provider drops as a duplicate
// (Polar external_id; Stripe identifier, within its 24 hours, well inside this
// job's retries).
//
// Whose customer: a person's own; for an organisation, the customer of the
// subscription that gives it access (paid up, even if set to cancel). No
// customer (a free account, a team with no paid plan) means there is nothing
// to bill: the event is settled without sending anything.
//

import { z } from "zod";
import { grantsAccess } from "@/core/types";
import { getBilling } from "../billing";
import { getData } from "../data";
import { PermanentJobError, defineJob } from "./define";

export const usageReportJob = defineJob({
  kind: "usage.report",
  schema: z.strictObject({ eventId: z.string().min(1).max(100) }),
  // 30 s doubling to an hour: about three hours of retries in all, which outlasts a provider outage.
  // The sweep re-queues an event still pending after that.
  maxAttempts: 10,
  run: async ({ eventId }) => {
    const data = await getData();
    const event = await data.usage.get(eventId);
    if (!event || !event.reportPending) return; // gone, or already reported
    const provider = await getBilling();
    if (!provider?.reportUsage) {
      // Billing switched off, or to a provider with no meters, since it was recorded: nothing can be
      // billed, so it's settled rather than left for the sweep to queue again forever.
      await data.usage.markReported(event.id, new Date().toISOString());
      if (provider) throw new PermanentJobError(`${provider.label} has no meters: usage can't be reported to it.`);
      return;
    }
    let customerId: string | null;
    if (event.subject.type === "user") {
      customerId = await data.billing.getCustomerId(event.subject.id, provider.id);
    } else {
      const subs = await data.billing.listSubscriptions({ orgId: event.subject.id, limit: 50 });
      const paying = subs.items.find((s) => s.provider === provider.id && grantsAccess(s));
      customerId = paying ? (paying.providerCustomerId ?? (await data.billing.getCustomerId(paying.userId, provider.id))) : null;
    }
    if (customerId) {
      await provider.reportUsage({ id: event.id, customerId, metric: event.metric, quantity: event.quantity, occurredAt: event.occurredAt });
    }
    await data.usage.markReported(event.id, new Date().toISOString());
  },
});
