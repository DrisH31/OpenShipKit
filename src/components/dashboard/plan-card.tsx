//
// The person's current plan, in one card: name, status (a word, not a colour),
// what happens next (renews / ends / lifetime) and the way to billing. The
// entitlement comes from verified webhooks only (getEntitlement); this card
// never infers access from anything else. Server component.
//

import Link from "next/link";
import type { Entitlement, Plan } from "@/core/types";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/product/status-badge";
import { formatDate } from "@/lib/format";
import { entitlementStatus } from "@/lib/status";

/** "Renews Oct 6, 2026" / "Ends …" / "Paid once, yours to keep" / free copy. */
export function entitlementNextStep(e: Entitlement): string {
  if (e.source === "free") return "You’re on the free plan.";
  if (e.source === "purchase") return "Paid once. It’s yours to keep.";
  if (!e.currentPeriodEnd) return "Active until you cancel.";
  if (e.status === "past_due") return `The last payment failed. Update your card before ${formatDate(e.currentPeriodEnd)} to keep access.`;
  if (e.cancelAtPeriodEnd) return `Ends ${formatDate(e.currentPeriodEnd)}. You keep access until then.`;
  if (e.status === "trialing") return `Trial ends ${formatDate(e.currentPeriodEnd)}.`;
  return `Renews ${formatDate(e.currentPeriodEnd)}.`;
}

export function PlanCard({ entitlement, plan, showLink = true }: { entitlement: Entitlement; plan: Plan | null; showLink?: boolean }) {
  const status = entitlementStatus(entitlement);
  const name = plan?.name ?? (entitlement.planKey ? entitlement.planKey : "Free");
  return (
    <section aria-labelledby="plan-title" className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="plan-title" className="font-sans text-small text-ink-3">
            Your plan
          </h2>
          <p className="font-display text-h3 font-bold text-ink">{name}</p>
        </div>
        {entitlement.source === "free" ? null : <StatusBadge label={status.label} tone={status.tone} />}
      </div>
      <p className="text-small text-ink-2">{entitlementNextStep(entitlement)}</p>
      {showLink ? (
        <div>
          <Link href="/dashboard/billing" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {entitlement.source === "free" ? "See plans" : "Billing"}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
