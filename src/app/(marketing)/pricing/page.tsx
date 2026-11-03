//
// /pricing — which plan, and what's in each. The plans (with the no-JavaScript
// monthly/yearly switch), a comparison table derived from the plans' own
// feature lists, a pricing FAQ generated from the plans (so it can't disagree
// with them), and the close. Checkout errors come back as ?error=<code>.
//
// Signed in, the viewer's own plan is marked and its button opens the billing
// portal (PricingPlans, viewerPlan). While payments are off, paid plans say
// "Not on sale yet" instead of offering a checkout that can only bounce. Plans are read with
// listPlans({ activeOnly: true }); a failed read throws
// (Invariant 3): a pricing page with no prices, or stale ones, is worse than an error.
// Under OPENSHIPKIT_PROFILE=site there is no pricing page: a 404 (src/server/profile.ts).
//

import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { CheckIcon, CircleAlertIcon, MinusIcon } from "lucide-react";
import type { Plan } from "@/core/types";
import { BillingOffNotice } from "@/components/billing/billing-off-notice";
import { billingErrorMessage } from "@/components/billing/format";
import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { Heading } from "@/components/marketing/type";
import { Cta } from "@/components/sections/cta";
import { Faq, type FaqEntry } from "@/components/sections/faq";
import { PricingPlans, viewerPlan } from "@/components/sections/pricing-plans";
import { comparisonRows, hasIntervalChoice, yearlySaving } from "@/components/sections/plan-rules";
import { SoftwareJsonLd } from "@/components/seo/site-json-ld";
import { getSiteSeo, siteFeeds } from "@/components/seo/site-seo";
import { requireSaasProfile } from "@/server/profile";
import { getContent } from "@/server/services/content";
import { isBillingEnabled } from "@/server/services/billing";
import { listPlans } from "@/server/services/plans";
import { formatPrice } from "@/shared/money";
import { pageMetadata } from "@/shared/seo";

export async function generateMetadata(): Promise<Metadata> {
  requireSaasProfile();
  const [{ name, locale, twitterSite, ogImage, cardAlt }, pricing] = await Promise.all([getSiteSeo(), getContent("pricing")]);
  return pageMetadata({
    title: "Pricing",
    description: pricing.subtitle || `Plans and prices for ${name}.`,
    path: "/pricing",
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
    siteName: name,
    feeds: siteFeeds(name),
    locale,
    twitterSite,
  });
}

/** How a plan is billed, in words: "$0", "$19 a month or $190 a year", "$299 once", "Custom". */
function billedAs(plan: Plan, plans: Plan[]): string {
  if (plan.prices.length === 0) {
    if (plan.contactSales) return "Custom";
    // The amount, not the word: a plan called "Free" over "Free" says nothing twice.
    return formatPrice(0, plans.flatMap((p) => p.prices)[0]?.currency ?? "usd");
  }
  const parts = plan.prices.map((p) => {
    const amount = formatPrice(p.amountCents, p.currency);
    return p.interval === "month" ? `${amount} a month` : p.interval === "year" ? `${amount} a year` : `${amount} once`;
  });
  return parts.join(" or ");
}

/** Questions answered from the plans themselves, so the FAQ can't drift from the prices. */
function pricingQuestions(plans: Plan[]): FaqEntry[] {
  const out: FaqEntry[] = [];
  const free = plans.find((p) => p.prices.length === 0 && !p.contactSales);
  if (free) {
    out.push({
      question: `Is there a free plan?`,
      answer: `Yes. ${free.name} costs nothing and needs no card.${free.description ? ` ${free.description}` : ""}`,
    });
  }
  for (const p of plans.filter((x) => x.trialDays && x.prices.some((pr) => pr.interval !== "one_time"))) {
    out.push({
      question: `Is there a free trial of ${p.name}?`,
      answer: `Yes. ${p.name} starts with a ${p.trialDays}-day free trial. Cancel before it ends and you won’t be charged.`,
    });
  }
  if (plans.some((p) => p.prices.some((pr) => pr.interval === "month" || pr.interval === "year"))) {
    out.push({
      question: "Can I cancel any time?",
      answer:
        "Yes. Cancel from Billing in your dashboard, in a couple of clicks. You keep access until the end of the period you’ve already paid for.",
    });
  }
  if (hasIntervalChoice(plans)) {
    const saving = yearlySaving(plans);
    out.push({
      question: "What’s the difference between monthly and yearly?",
      answer: `It’s the same plan, billed once a year instead of every month.${saving > 0 ? ` Paying yearly costs up to ${saving}% less.` : ""} You can switch at renewal.`,
    });
  }
  for (const p of plans.filter((x) => x.prices.length === 1 && x.prices[0].interval === "one_time")) {
    out.push({
      question: `How does ${p.name} work?`,
      answer: `One payment of ${formatPrice(p.prices[0].amountCents, p.prices[0].currency)}, no subscription.${p.description ? ` ${p.description}` : ""}`,
    });
  }
  for (const p of plans.filter((x) => x.contactSales)) {
    out.push({
      question: `Who is ${p.name} for?`,
      answer: `${p.description ? `${p.description} ` : ""}The price depends on what you need: send a message from the contact page and we’ll reply by email.`,
    });
  }
  return out;
}

function Comparison({ plans }: { plans: Plan[] }) {
  const rows = comparisonRows(plans);
  const anyTrial = plans.some((p) => p.trialDays);

  return (
    <section id="compare" aria-labelledby="compare-title" className="pb-section">
      <Container>
        <Heading id="compare-title">Compare plans</Heading>
        {/* relative: the sr-only cell labels are absolutely positioned, and must be clipped by this scroller, not widen the page.
            Its own name (the section already owns "Compare plans": two landmarks, one name). On a phone the feature
            column narrows to 8rem and each plan keeps 7rem, so two plans show beside the labels, and the soft right
            edge (.scroll-shade, base.css) says there are more. */}
        <div
          className="scroll-shade relative mt-10 overflow-x-auto rounded-xl border border-line [--scroll-cover:var(--card)]"
          tabIndex={0}
          role="region"
          aria-label="Plan comparison table"
        >
          <table
            className="w-full min-w-(--compare-min) table-fixed border-collapse text-left text-small sm:min-w-[max(40rem,var(--compare-min))]"
            style={{ "--compare-min": `${8 + plans.length * 7}rem` } as CSSProperties}
          >
            <caption className="sr-only">What each plan includes</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="sticky left-0 z-10 w-32 bg-card px-3 py-4 font-semibold text-ink-3 sm:w-[34%] sm:px-5">
                  <span className="sr-only">Feature</span>
                </th>
                {/* Top-aligned: the plan names share a line even when one price wraps to two or three. */}
                {plans.map((p) => (
                  <th key={p.key} scope="col" className="px-3 py-4 align-top sm:px-5">
                    <span className="block text-body font-semibold text-ink">{p.name}</span>
                    <span className="mt-1 block font-normal text-ink-2">{billedAs(p, plans)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {anyTrial && (
                <tr className="border-b border-line">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-3.5 font-normal text-ink-2 sm:px-5">
                    Free trial
                  </th>
                  {plans.map((p) => (
                    <td key={p.key} className="px-3 py-3.5 text-ink sm:px-5">
                      {p.trialDays ? `${p.trialDays} days` : <span className="text-ink-3">None</span>}
                    </td>
                  ))}
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-line last:border-b-0">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-3.5 font-normal text-ink-2 sm:px-5">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={plans[i].key} className="px-3 py-3.5 sm:px-5">
                      {typeof cell === "string" ? (
                        <span className="text-ink">{cell}</span>
                      ) : cell ? (
                        <>
                          <CheckIcon aria-hidden className="size-4 text-ink" />
                          <span className="sr-only">Included</span>
                        </>
                      ) : (
                        <>
                          <MinusIcon aria-hidden className="size-4 text-ink-faint" />
                          <span className="sr-only">Not included</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  requireSaasProfile();
  const [params, pricing, plans, current, billingOn, seo] = await Promise.all([
    searchParams,
    getContent("pricing"),
    listPlans({ activeOnly: true }),
    viewerPlan(),
    isBillingEnabled(),
    getSiteSeo(),
  ]);
  const errorCode = first(params.error);
  // With payments off, the calm notice below says it; don't repeat it as an error.
  const error = !billingOn && errorCode === "billing_disabled" ? null : billingErrorMessage(errorCode);

  return (
    <>
      {/* The Offers beside the prices they describe — once the plans are the product's own (not the showcase's samples). */}
      {!seo.showcase && <SoftwareJsonLd />}
      <section aria-labelledby="pricing-title" className="pt-12 pb-16 sm:pt-16 lg:pt-24">
        <Container>
          <SectionHeader
            id="pricing-title"
            level={1}
            hero
            eyebrow={pricing.eyebrow || undefined}
            title={pricing.title}
            lead={pricing.subtitle || undefined}
            className="max-w-4xl"
          />
          {error && (
            <p role="alert" className="mt-10 flex max-w-2xl items-start gap-2 rounded-md bg-danger-soft px-4 py-3 text-small text-badge-danger">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          {!billingOn && plans.some((p) => p.prices.length > 0) && <BillingOffNotice audience="customer" className="mt-10" />}
          <div className="mt-12">
            {/* The section heading is this page's h1, so plan names are h2s (no skipped level). */}
            <PricingPlans plans={plans} id="pricing-plans" current={current} billingOn={billingOn} headingLevel={2} rankPrimary />
          </div>
          {pricing.note && <p className="mt-8 text-small text-ink-3">{pricing.note}</p>}
        </Container>
      </section>
      {plans.length > 0 && <Comparison plans={plans} />}
      {/* On the showcase these answers describe the sample plans, so no FAQPage: an answer engine
          reading the markup alone would take "14-day free trial" as this site's own offer. */}
      <Faq id="pricing-faq" title="Pricing questions" items={pricingQuestions(plans)} emitJsonLd={!seo.showcase} />
      <Cta />
    </>
  );
}
