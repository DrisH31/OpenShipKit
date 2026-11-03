import "server-only";

//
// The landing page's pricing section: the copy from content ("pricing") around
// the active plans. Plans are not content: a failed read throws (Invariant 3 —
// a page showing no prices, or the wrong ones, is worse than an error).
//

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { isBillingEnabled } from "@/server/services/billing";
import { getContent } from "@/server/services/content";
import { listPlans } from "@/server/services/plans";
import { PricingPlans, viewerPlan } from "./pricing-plans";

export async function Pricing({ moreLink = true }: { moreLink?: boolean }) {
  const [pricing, plans, current, billingOn] = await Promise.all([
    getContent("pricing"),
    listPlans({ activeOnly: true }),
    viewerPlan(),
    isBillingEnabled(),
  ]);

  return (
    <section id="pricing" aria-labelledby="pricing-title" data-tone="page" className="py-section">
      <Container>
        <SectionHeader
          id="pricing-title"
          eyebrow={pricing.eyebrow || undefined}
          title={pricing.title}
          lead={pricing.subtitle || undefined}
          className="max-w-3xl"
        />
        <div className="mt-12">
          <PricingPlans plans={plans} id="home-plans" current={current} billingOn={billingOn} />
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {pricing.note && <p className="text-small text-ink-3">{pricing.note}</p>}
          {moreLink && (
            <Link
              href="/pricing#compare"
              className="group inline-flex min-h-11 items-center gap-1.5 text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink"
            >
              Compare every plan
              <ArrowRightIcon aria-hidden className="size-3.5 transition-transform duration-(--dur-hover) group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </Container>
    </section>
  );
}
