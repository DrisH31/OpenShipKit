//
// /dashboard/billing — what you pay for and how to change it.
//
//   - The plan and its status come from getEntitlement(): rows written by the
//     verified provider webhook. `?checkout=success` only changes the message on
//     this page; it never grants anything (SPEC invariant 4).
//   - With billing off (no POLAR_ACCESS_TOKEN) the page says so and shows the
//     plans without buttons.
//   - Upgrades post to /api/billing/checkout (CheckoutButton: works without JS);
//     "Manage billing" opens the provider's portal (Polar, Stripe). Razorpay has
//     none: the page lists what can be cancelled instead, and a plan change is
//     cancel, then buy again. Every provider word comes from the provider in
//     use (PROVIDER_LABEL, hasPortal), never a hard-coded "Polar".
//   - The list shows only what can be bought or asked about: a plan with no
//     paid price and no "contact sales" (the free plan) has nothing to offer
//     here. Features read exactly as on /pricing ("Everything in Pro" expanded).
//   - Each option leads with its price as the card's figure, under the name.
//     Only a real CheckoutButton is button-shaped; "not on sale yet" and
//     "switch in Manage billing" are plain captions.
//   - Names come from every plan, retired ones too: a customer on a plan
//     retired with `active: false` keeps it, so their card and history must
//     still say "Pro", not the raw key. Only the options are active-only.
//   - Every price asks getCheckoutGuard() first, the rule startCheckout
//     enforces: a price that would be refused shows the refusal's label
//     ("Cancel your subscription first") instead of a button bound to fail, a
//     second subscription says "switch in Manage billing", and a plan the
//     person's purchases already cover (Pro under Lifetime) isn't offered.
//   - Usage: this period's usage against the plan's limits (usageSummary), for
//     the person or, with teams on, the organisation. A count limit (projects,
//     seats) shows its limit only: the app keeps that count, not the usage table.
//   - Under OPENSHIPKIT_PROFILE=site there is no Billing page: a 404.
//

import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheckIcon, ClockIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { Plan, PlanPrice, PriceInterval } from "@/core/types";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PortalButton } from "@/components/billing/portal-button";
import { billingErrorMessage, intervalLabel, priceLabel } from "@/components/billing/format";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { PlanCard } from "@/components/dashboard/plan-card";
import { resolveFeatures } from "@/components/sections/plan-rules";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS } from "@/lib/status";
import { requireSaasProfile } from "@/server/profile";
import { requireUser } from "@/server/session";
import { billingHasPortal, getCheckoutGuard, getOrgBillingView, isBillingEnabled, listCancellable, paysForAnything, type CheckoutRefusal } from "@/server/services/billing";
import { ActionForm, FormMessage, SubmitButton } from "@/components/product/action-form";
import { cancelSubscriptionAction } from "./actions";
import { teamsEnabled } from "@/server/services/orgs";
import { billingProvider } from "@/server/env";
import { PROVIDER_LABEL, priceIdFor, type PaidProviderId } from "@/core/billing";
import { listPlans } from "@/server/services/plans";
import { getUserDetail } from "@/server/services/users";
import { formatPrice } from "@/shared/money";
import { usageSubject, usageSummary, type UsageLine } from "@/server/services/usage";
import { humanize } from "@/lib/schema-form";

export const metadata: Metadata = { title: "Billing" };

function Notice({ tone, title, children }: { tone: "positive" | "warning" | "info"; title: string; children: React.ReactNode }) {
  const Icon = tone === "positive" ? CircleCheckIcon : tone === "warning" ? TriangleAlertIcon : InfoIcon;
  return (
    <div role={tone === "warning" ? "alert" : "status"} className="flex gap-3 rounded-xl border border-line-strong bg-card p-4">
      <Icon aria-hidden className={tone === "positive" ? "mt-0.5 size-5 shrink-0 text-positive" : tone === "warning" ? "mt-0.5 size-5 shrink-0 text-warning" : "mt-0.5 size-5 shrink-0 text-info"} />
      <div className="flex flex-col gap-1">
        <p className="text-small font-semibold text-ink">{title}</p>
        <div className="text-small text-ink-2">{children}</div>
      </div>
    </div>
  );
}

/** Something to buy or ask about: a paid price, or "contact sales". */
const forSale = (plan: Plan) => plan.contactSales || plan.prices.some((p) => p.amountCents > 0);

/** The price as a figure: "$19 / month", "$299 one-time". */
function PriceFigure({ price }: { price: PlanPrice }) {
  return (
    <p className="font-display text-h3 font-bold text-ink tabular">
      {formatPrice(price.amountCents, price.currency)}
      <span className="font-sans text-small font-normal text-ink-3">
        {" "}
        {price.perSeat ? "per seat " : ""}
        {price.interval === "one_time" ? "one-time" : `/ ${price.interval}`}
      </span>
    </p>
  );
}

/** startCheckout's rule for this user, read once per page (getCheckoutGuard). */
type Guard = (planKey: string, interval: PriceInterval) => CheckoutRefusal | null;

/** True when every paid price of `plan` is refused because the person's purchases already cover it. */
const ownedOutright = (plan: Plan, refuse: Guard) => {
  const paid = plan.prices.filter((p) => p.amountCents > 0);
  return paid.length > 0 && paid.every((p) => refuse(plan.key, p.interval)?.reason === "already_owned");
};

function PlanOption({ plan, plans, current, provider, refuse, hasPortal }: { plan: Plan; plans: Plan[]; current: boolean; provider: PaidProviderId | null; refuse: Guard; hasPortal: boolean }) {
  const paid = plan.prices.filter((p) => p.amountCents > 0);
  const features = resolveFeatures(plan, plans);
  // What can actually be bought here; anything else gets one line of caption, not a button shape.
  const offered = plan.contactSales || current ? [] : paid;
  const refusal = (p: PlanPrice) => refuse(plan.key, p.interval);
  // A second subscription: the provider's portal switches plans, not a new checkout (with no portal: cancel first).
  const viaPortal = (p: PlanPrice) => p.interval !== "one_time" && refusal(p)?.reason === "already_subscribed";
  const buyable = offered.filter((p) => !refusal(p) && provider !== null && priceIdFor(plan, p, provider));
  const switchOnly = offered.some(viaPortal);
  // Any other refusal reads as its own label, once ("Cancel your subscription first").
  const refusedLabels = [...new Set(offered.filter((p) => !viaPortal(p)).flatMap((p) => refusal(p)?.label ?? []))];
  const unavailable = offered.filter((p) => !refusal(p) && !buyable.includes(p));
  const notOnSale =
    unavailable.length === 0 ? null : unavailable.length === offered.length ? "Not on sale yet." : `${unavailable.map((p) => intervalLabel(p.interval, "adverb")).join(" and ")}: not on sale yet.`;
  return (
    <li className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5 data-[current=true]:border-line-strong" data-current={current}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="font-sans text-body font-semibold text-ink">{plan.name}</h3>
            {plan.description ? <p className="text-small text-ink-2">{plan.description}</p> : null}
          </div>
          {current ? <StatusBadge label="Current plan" tone="positive" /> : null}
        </div>
        {paid.length ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {paid.map((price) => (
              <PriceFigure key={price.interval} price={price} />
            ))}
          </div>
        ) : null}
      </div>
      {features.length ? (
        <ul className="flex flex-col gap-1.5 text-small text-ink-2">
          {features.map((f) => (
            <li key={f} className="flex gap-2">
              <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              {f}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.contactSales || buyable.length || switchOnly || refusedLabels.length || notOnSale ? (
        <div className="mt-auto flex flex-col gap-2">
          {plan.contactSales ? (
            <Link href="/contact" className="inline-flex min-h-10 items-center text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
              Contact us about {plan.name}
            </Link>
          ) : null}
          {buyable.length ? (
            <div className="flex flex-wrap gap-2">
              {buyable.map((price) => (
                <CheckoutButton
                  key={price.interval}
                  planKey={plan.key}
                  interval={price.interval}
                  label={priceLabel(price)}
                  variant={plan.highlighted ? "default" : "outline"}
                  size="sm"
                  ariaLabel={`Buy ${plan.name}, ${priceLabel(price)} (${intervalLabel(price.interval, "adverb")})`}
                />
              ))}
            </div>
          ) : null}
          {switchOnly ? (
            <p className="text-caption text-ink-3">
              {hasPortal ? `To move to ${plan.name}, switch in Manage billing.` : `To move to ${plan.name}, cancel your current plan above; once it ends, buy ${plan.name} here.`}
            </p>
          ) : null}
          {refusedLabels.map((label) => (
            <p key={label} className="text-caption text-ink-3">
              {label}.
            </p>
          ))}
          {notOnSale ? <p className="text-caption text-ink-3 first-letter:uppercase">{notOnSale}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** One metric this period: "7 of 100", with a meter when it's limited and metered. */
function UsageRow({ line }: { line: UsageLine & { inUse?: boolean } }) {
  const metered = line.used > 0 || line.limit === null;
  const period = line.inUse ? "in use" : "this period";
  const full = line.limit !== null && line.used >= line.limit;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-small">
        <span className="text-ink">{humanize(line.metric)}</span>
        <span className="tabular text-ink-2">
          {line.limit === null
            ? `${line.used.toLocaleString("en-US")} ${period} · no limit`
            : metered || line.inUse
              ? `${line.used.toLocaleString("en-US")} of ${line.limit.toLocaleString("en-US")} ${period}`
              : `Up to ${line.limit.toLocaleString("en-US")}`}
        </span>
      </div>
      {line.limit !== null && (metered || line.inUse) ? (
        <meter
          min={0}
          max={line.limit}
          value={Math.min(line.used, line.limit)}
          low={line.limit * 0.8}
          high={line.limit * 0.95}
          optimum={0}
          aria-label={`${humanize(line.metric)}: ${line.used} of ${line.limit} used${full ? ", the limit" : ""}`}
          className="h-2 w-full"
        />
      ) : null}
    </li>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // OPENSHIPKIT_PROFILE=site: no billing, so no Billing page (a 404 in the dashboard's frame).
  requireSaasProfile();
  const user = await requireUser("/dashboard/billing");
  const sp = await searchParams;
  const checkout = typeof sp.checkout === "string" ? sp.checkout : null;
  const errorMessage = billingErrorMessage(typeof sp.error === "string" ? sp.error : null);

  // With teams on, everything below is the organisation's (getOrgBillingView): its plan, seats and payments.
  const teams = teamsEnabled();
  const configured = billingProvider();
  const paidProvider: PaidProviderId | null = configured === "none" ? null : configured;
  const orgView = teams ? await getOrgBillingView(user) : null;
  if (teams && !orgView) {
    // In no team, but perhaps still paying for one they've left: Manage billing stays reachable.
    const pays = (await isBillingEnabled()) && (await paysForAnything(user));
    return (
      <>
        <PageHeader title="Billing" answer="With teams, plans belong to an organisation." action={pays ? <PortalButton /> : undefined} />
        <EmptyState
          title="Create an organisation first"
          body="Your organisation holds the plan, and everyone in it shares it."
          action={
            <Link href="/dashboard/team" className="text-small font-semibold text-ink underline underline-offset-4">
              Go to Team
            </Link>
          }
        />
      </>
    );
  }

  // With teams, Manage billing is the person's own billing: shown when they pay for anything (openPortal
  // opens exactly that). An owner who doesn't pay sees who does in the notice below instead.
  const showPortal = orgView ? await paysForAnything(user) : null;

  // A provider with no portal (Razorpay): the page lists what can be cancelled instead of Manage billing.
  const [hasPortal, cancellable, rawUsage] = await Promise.all([
    billingHasPortal(),
    listCancellable(user),
    // The same subject limits and metered billing use (usageSubject): with teams, the organisation,
    // unless it has no plan and the person has their own.
    usageSubject(user, orgView ? { orgId: orgView.org.id } : {}).then(async (subject) => ({ subject, ...(await usageSummary(subject)) })),
  ]);

  // Every plan, retired ones included, for names; only active plans are offered.
  const [detail, plans, billingOn, personalRefuse] = await Promise.all([
    orgView ? null : getUserDetail(user.id),
    listPlans(),
    isBillingEnabled(),
    orgView ? null : getCheckoutGuard(user.id),
  ]);
  // Seats are the team's (members and open invitations against what it bought or its plan allows),
  // the same figures as the notice above; for a person on their own they mean nothing.
  const usage = {
    ...rawUsage,
    lines: rawUsage.lines.flatMap((l) => (l.metric !== "seats" ? [l] : orgView && rawUsage.subject.type === "org" ? [{ metric: "seats", used: orgView.seats.used, limit: orgView.seats.limit, inUse: true }] : [])),
  };
  // In a team, but the person's own plan applies (the team has none): say so, or the card reads as the team's.
  const usageIsOwn = orgView !== null && rawUsage.subject.type === "user";
  const entitlement = orgView ? orgView.entitlement : detail!.entitlement;
  const subscriptions = orgView ? orgView.subscriptions : detail!.subscriptions;
  const purchases = orgView ? [] : detail!.purchases;
  const refuse = orgView ? orgView.refuse : personalRefuse!;
  const plan = plans.find((p) => p.key === entitlement.planKey) ?? null;
  const providerLabel = paidProvider ? PROVIDER_LABEL[paidProvider] : null;
  const handledBy = providerLabel && billingOn ? ` Payments are handled by ${providerLabel}, which issues the receipts.` : "";
  const planName = (key: string | null) => plans.find((p) => p.key === key)?.name ?? key;
  const hasAccount = subscriptions.length > 0 || purchases.length > 0;
  const subscribed = entitlement.source === "subscription";
  // Not offered: the plan they already own outright, and a plan their purchases cover (Pro under Lifetime).
  const options = plans.filter((p) => p.active && forSale(p) && (p.key !== entitlement.planKey || subscribed) && !ownedOutright(p, refuse));

  return (
    <>
      <PageHeader
        title={orgView ? `Billing · ${orgView.org.name}` : "Billing"}
        answer={
          orgView
            ? `${orgView.org.name}'s plan, shared by everyone in it, and its payments.${handledBy}`
            : `Your plan, what it costs, and your payment history.${handledBy}`
        }
        action={billingOn && hasPortal && (orgView ? showPortal : hasAccount) ? <PortalButton /> : undefined}
      />
      {orgView ? (
        <Notice tone="info" title={orgView.seats.limit === null ? `${orgView.seats.used} in the team` : `${orgView.seats.used} of ${orgView.seats.limit} seats in use`}>
          {orgView.seats.limit === null
            ? "Members and open invitations. Your plan doesn't limit seats."
            : hasPortal
              ? "Members and open invitations. To add seats, change the subscription in Manage billing."
              : "Members and open invitations. Seats are set when the subscription is bought."}
          {orgView.payerEmail ? ` Payment is managed by ${orgView.payerEmail}.` : null}
        </Notice>
      ) : null}

      {checkout === "success" ? (
        entitlement.source === "free" ? (
          <Notice tone="info" title="Payment received. Activating your plan…">
            {providerLabel ?? "The payment provider"} confirms the payment to us in the background, usually within a few seconds. Refresh this page in a moment. If nothing changes after a few
            minutes, <Link href="/dashboard/feedback" className="font-semibold text-ink underline underline-offset-4">tell us</Link> and we’ll sort it out.
          </Notice>
        ) : (
          <Notice tone="positive" title="Thank you, you’re all set">
            Your plan is active. A receipt is on its way to {user.email}.
          </Notice>
        )
      ) : null}
      {errorMessage ? (
        <Notice tone="warning" title="That didn’t go through">
          {errorMessage}
        </Notice>
      ) : null}
      {!billingOn ? (
        <Notice tone="info" title="Payments aren’t turned on yet">
          {user.role === "admin" ? (
            <>
              Set <code className="font-mono text-caption">POLAR_ACCESS_TOKEN</code> and <code className="font-mono text-caption">POLAR_WEBHOOK_SECRET</code> to sell plans. Until then,
              everyone is on the free plan.
            </>
          ) : (
            "This site doesn’t sell plans yet. Everything that’s free stays free."
          )}
        </Notice>
      ) : null}

      {cancellable.length > 0 ? (
        <section aria-labelledby="cancel-title" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
          <h2 id="cancel-title" className="font-sans text-body font-semibold text-ink">
            Your subscriptions
          </h2>
          <ul className="flex flex-col gap-3 text-small">
            {cancellable.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink">
                  {planName(s.planKey) ?? "Subscription"}
                  {s.currentPeriodEnd ? <span className="text-ink-3"> · renews {formatDate(s.currentPeriodEnd)}</span> : null}
                </span>
                <ActionForm action={cancelSubscriptionAction.bind(null, s.id)} className="inline-flex flex-col items-end gap-1">
                  <SubmitButton variant="outline" size="sm" aria-label={`Cancel ${planName(s.planKey) ?? "the subscription"} at the end of the period`}>
                    Cancel at period end
                  </SubmitButton>
                  <FormMessage className="max-w-64 text-left whitespace-normal" />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Your plan across the top, then the plans side by side at the full width: three sit in one row
          on a desktop, and no column is left empty beside a short card. */}
      <PlanCard entitlement={entitlement} plan={plan} showLink={false} />
      {usage.lines.length > 0 ? (
        <section aria-labelledby="usage-title" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="usage-title" className="font-sans text-body font-semibold text-ink">
              Usage
            </h2>
            <p className="text-caption text-ink-3">
              Resets {formatDate(usage.period.to)}
            </p>
          </div>
          {usageIsOwn ? (
            <p className="-mt-1 text-caption text-ink-2">
              Your own {planName(usage.plan) ?? "plan"} plan, which applies while {orgView?.org.name} has no plan of its own.
            </p>
          ) : null}
          <ul className="flex flex-col gap-4">
            {usage.lines.map((line) => (
              <UsageRow key={line.metric} line={line} />
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="plans-title" className="flex flex-col gap-3">
        <h2 id="plans-title" className="font-sans text-body font-semibold text-ink">
          {subscribed ? "Plans" : "Upgrade"}
        </h2>
        {subscribed && billingOn ? (
          <p className="text-small text-ink-2">
            {hasPortal ? "To switch plans or cancel, use Manage billing." : "To switch plans, cancel your subscription above; once it ends, buy the new plan here."}
          </p>
        ) : null}
        {options.length === 0 ? (
          <EmptyState title="Nothing to upgrade to" body="There are no paid plans on sale right now." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
            {options.map((p) => (
              <PlanOption key={p.key} plan={p} plans={plans} current={p.key === entitlement.planKey} provider={billingOn ? paidProvider : null} refuse={refuse} hasPortal={hasPortal} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-title" className="flex flex-col gap-3">
        <h2 id="history-title" className="font-sans text-body font-semibold text-ink">
          Payment history
        </h2>
        {subscriptions.length === 0 && purchases.length === 0 ? (
          <EmptyState title="No payments yet" body="When you buy a plan, the subscription and every one-time purchase show up here." />
        ) : (
          <div className="rounded-xl border border-line bg-card">
            <Table label="Payment history">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">What</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="px-4">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s) => {
                  const st = SUBSCRIPTION_STATUS[s.status];
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="px-4 font-semibold text-ink">
                        {planName(s.planKey) ?? "Subscription"}
                        {s.interval ? ` · ${intervalLabel(s.interval, "adverb")}` : null}
                      </TableCell>
                      <TableCell>
                        <StatusBadge label={s.cancelAtPeriodEnd && s.status === "active" ? "Cancels at period end" : st.label} tone={st.tone} />
                      </TableCell>
                      <TableCell className="text-ink-3">Subscription</TableCell>
                      <TableCell className="px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <ClockIcon aria-hidden className="size-3.5 text-ink-3" />
                          {s.currentPeriodEnd ? `Period ends ${formatDate(s.currentPeriodEnd)}` : `Started ${formatDate(s.createdAt)}`}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {purchases.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="px-4 font-semibold text-ink">{planName(p.planKey) ?? "Purchase"} · one-time</TableCell>
                    <TableCell>
                      <StatusBadge label={p.chargedBack ? "Charged back" : p.refunded ? "Refunded" : "Paid"} tone={p.refunded ? "neutral" : "positive"} />
                    </TableCell>
                    <TableCell className="tabular">{formatPrice(p.amountCents, p.currency)}</TableCell>
                    <TableCell className="px-4 whitespace-nowrap">{formatDate(p.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
