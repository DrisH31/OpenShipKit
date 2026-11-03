import "server-only";

//
// The plan cards, from the plans in the DataStore (listPlans({ activeOnly })).
// Used by the landing page's pricing section and by /pricing.
//
// The monthly/yearly switch needs no JavaScript: two native radios, and CSS
// :has() shows the price and button for the checked one. Without :has() the
// monthly view is shown (the yearly copies are hidden by default). There is
// ONE card per plan: only a plan whose price changes with the switch carries
// both prices, so the heading outline lists each plan once.
//
// Honest pricing: the price in the buyer's terms, what's included, one action;
// the yearly saving is computed from the plans, never typed; no "most popular"
// badge — `highlighted` only raises the surface (in both schemes) and gives
// that plan the one solid button. While payments are off (`billingOn` false)
// a paid plan says "Not on sale yet" on a disabled button, and the one solid
// button moves to the free plan: nothing on the page looks buyable that isn't.
//
// The cards share rows (CSS subgrid): name and price, description, action,
// features — so every plan's button and list start on the same line.
//
// CTAs: free → sign up; contactSales → /contact?topic=sales; paid → checkout.
// For a signed-in viewer (pass `current`, from viewerPlan()), the plan they
// already have says so instead: their subscription → Manage billing (the
// Billing page), a one-time purchase → owned, the free plan → dashboard.
// Any other paid price asks `current.refuse` (getCheckoutGuard, the rule
// startCheckout enforces) first, and a checkout bound to be refused shows the
// refusal's label instead: a Lifetime owner sees "Included in your Lifetime
// plan" on Pro (→ dashboard), a renewing subscriber sees "Cancel your
// subscription first" on Lifetime and "Change plans from Billing" on another
// subscription (→ /dashboard/billing). The entitlement comes from the
// verified-webhook rows (Invariant 4), never from the URL.
//
// The rules the cards read (feature inheritance, the price for the switch, the
// yearly saving) are pure and live in ./plan-rules.ts, which builds on the one
// inheritance rule in src/core/plans.ts, so a product page or a tool can use
// them without importing this server-only section.
//

import Link from "next/link";
import { CheckIcon } from "lucide-react";
import type { Entitlement, Plan, PlanPrice, PriceInterval } from "@/core/types";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCheckoutGuard, getEntitlement, type CheckoutRefusal } from "@/server/services/billing";
import { getCurrentUser } from "@/server/session";
import { formatPrice } from "@/shared/money";
import { hasIntervalChoice, priceFor, resolveFeatures, yearlySaving } from "./plan-rules";

/**
 * What the signed-in viewer has: the plan key (null = the free plan) and how they got it,
 * and `refuse` — whether a checkout for (plan, interval) would be refused for them, and
 * why (getCheckoutGuard). Without `refuse`, every paid price offers its checkout.
 */
export type CurrentPlan = Pick<Entitlement, "planKey" | "source"> & {
  refuse?: (planKey: string, interval: PriceInterval) => CheckoutRefusal | null;
};

/**
 * The viewer's current plan, or null when signed out. Auth failing is treated
 * as signed out (the pricing page must still render); a failed entitlement
 * read throws (Invariant 3: "free" for someone who paid is worse than a 500).
 */
export async function viewerPlan(): Promise<CurrentPlan | null> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  const [{ planKey, source }, refuse] = await Promise.all([getEntitlement(user.id), getCheckoutGuard(user.id)]);
  return { planKey, source, refuse };
}

/** True when `plan` is the one `current` describes (the free plan when they have no paid one). */
export function isCurrentPlan(plan: Plan, current: CurrentPlan | null): boolean {
  if (!current) return false;
  if (current.source === "free") return plan.prices.length === 0 && !plan.contactSales;
  return current.planKey === plan.key;
}

const PERIOD: Record<PriceInterval, string> = { month: "per month", year: "per year", one_time: "one-time" };

function PriceLine({ plan, price }: { plan: Plan; price: PlanPrice | null }) {
  if (!price) {
    return plan.contactSales ? (
      <p className="flex items-baseline gap-2">
        <span className="figure text-h2 leading-none text-ink">Custom</span>
      </p>
    ) : (
      <p className="flex items-baseline gap-2">
        <span className="figure text-h2 leading-none text-ink">{formatPrice(0, "usd")}</span>
        <span className="text-small text-ink-2">forever</span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="figure text-h2 leading-none text-ink">{formatPrice(price.amountCents, price.currency)}</span>
      <span className="text-small text-ink-2">{price.perSeat ? `per seat, ${PERIOD[price.interval]}` : PERIOD[price.interval]}</span>
      {price.interval === "year" && (
        <span className="w-full text-caption text-ink-3">
          {formatPrice(Math.round(price.amountCents / 12), price.currency)} a month, billed yearly
        </span>
      )}
    </p>
  );
}

function PlanAction({
  plan,
  price,
  primary,
  current,
  billingOn,
  offId,
}: {
  plan: Plan;
  price: PlanPrice | null;
  primary: boolean;
  current: CurrentPlan | null;
  billingOn: boolean;
  /** The note that says payments are off, which a "Not on sale yet" button points at. */
  offId: string;
}) {
  const variant = primary ? "default" : "outline";
  const cls = cn(buttonVariants({ variant, size: "lg" }), "w-full");
  if (isCurrentPlan(plan, current)) {
    if (current?.source === "subscription") {
      // The Billing page, not the portal itself: it shows Manage billing where the provider has a
      // portal (Polar, Stripe) and Cancel where it doesn't (Razorpay).
      return (
        <Link href="/dashboard/billing" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
          Manage billing
        </Link>
      );
    }
    return (
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
        {current?.source === "purchase" ? "You own this plan" : "Go to your dashboard"}
      </Link>
    );
  }
  if (plan.contactSales) {
    return (
      <Link href="/contact?topic=sales" className={cls}>
        {plan.ctaLabel || "Contact sales"}
      </Link>
    );
  }
  if (!price || price.amountCents === 0) {
    return (
      <Link href="/sign-up" className={cls}>
        {plan.ctaLabel || "Get started"}
      </Link>
    );
  }
  if (!billingOn) {
    // Focusable while disabled, so a keyboard or screen-reader user still meets it and hears why.
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled
        focusableWhenDisabled
        aria-describedby={offId}
        className="w-full cursor-not-allowed border-line-strong text-ink-2 hover:bg-transparent active:scale-100"
      >
        Not on sale yet
      </Button>
    );
  }
  const refusal = current?.refuse?.(plan.key, price.interval);
  if (refusal) {
    // A checkout that would be refused: say why, and link where it can be sorted out.
    return (
      <Link href={refusal.reason === "already_owned" ? "/dashboard" : "/dashboard/billing"} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
        {refusal.label}
      </Link>
    );
  }
  const label = plan.ctaLabel || "Get started";
  return (
    <CheckoutButton
      planKey={plan.key}
      interval={price.interval}
      label={label}
      variant={variant}
      size="lg"
      className="w-full"
      // Label-in-name (WCAG 2.5.3): the visible label first, then which plan and price it buys.
      ariaLabel={`${label}: ${plan.name}, ${PERIOD[price.interval]}`}
    />
  );
}

/** Shown while the monthly radio is checked (or :has() is unsupported) / while the yearly one is. */
const MONTH_ONLY = "swap-in group-has-[.interval-year:checked]/pricing:hidden";
const YEAR_ONLY = "swap-in hidden group-has-[.interval-year:checked]/pricing:block";

function PlanCard({
  plan,
  plans,
  choice,
  primary,
  current,
  rank,
  billingOn,
  headingLevel,
  idPrefix,
}: {
  plan: Plan;
  plans: Plan[];
  /** True when the monthly/yearly switch is shown. */
  choice: boolean;
  primary: boolean;
  current: CurrentPlan | null;
  /** Mark this card's action as the screen's primary (data-rank="2") for the review checks. */
  rank?: boolean;
  billingOn: boolean;
  headingLevel: 2 | 3;
  idPrefix: string;
}) {
  const month = priceFor(plan, "month");
  const year = priceFor(plan, "year");
  // Only a plan sold both ways changes with the switch; every other card is the same in both views.
  const both = choice && month !== null && year !== null && month !== year;
  const features = resolveFeatures(plan, plans);
  const mine = isCurrentPlan(plan, current);
  const Title = headingLevel === 2 ? "h2" : "h3";
  const offId = `${idPrefix}-${plan.key}-off`;
  const forSale = billingOn || mine || plan.contactSales || !month || month.amountCents === 0;
  const action = (price: PlanPrice | null) => (
    <PlanAction plan={plan} price={price} primary={primary && !mine} current={current} billingOn={billingOn} offId={offId} />
  );
  // Only checkout depends on the interval; the other actions are the same in both views.
  const actionVaries = both && forSale && !mine && !plan.contactSales;
  // A checkout the viewer can't start (see PlanAction): no trial or "no renewals" pitch under its label.
  const refused = Boolean(billingOn && month && month.amountCents > 0 && current?.refuse?.(plan.key, month.interval));

  return (
    <li
      className={cn(
        "row-span-4 grid grid-rows-subgrid gap-y-0 rounded-2xl border p-6",
        // Every card is the full content surface (COL-4: 1.25:1 off the page in light), so no plan reads
        // as disabled. The highlighted one is raised in both schemes without the accent: a ring, a
        // shadow and, in dark, the raised surface (a shadow is invisible on #111).
        plan.highlighted
          ? "border-line-strong bg-card shadow-mockup ring-1 ring-ink/15 dark:bg-raised"
          : "border-line bg-surface",
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Title className="font-sans text-body font-semibold text-ink">{plan.name}</Title>
          {mine && (
            <span className="inline-flex h-6 items-center rounded-full bg-tonal px-2.5 text-caption font-semibold text-ink-2">
              Your plan
            </span>
          )}
        </div>
        {both ? (
          <>
            <div className={MONTH_ONLY}>
              <PriceLine plan={plan} price={month} />
            </div>
            <div className={YEAR_ONLY}>
              <PriceLine plan={plan} price={year} />
            </div>
          </>
        ) : (
          <PriceLine plan={plan} price={month ?? year} />
        )}
      </div>
      <div className="pt-3">{plan.description && <p className="text-small text-ink-2">{plan.description}</p>}</div>
      <div className="flex flex-col gap-2 pt-6" data-rank={rank ? "2" : undefined}>
        {actionVaries ? (
          <>
            <div className={MONTH_ONLY}>{action(month)}</div>
            <div className={YEAR_ONLY}>{action(year)}</div>
          </>
        ) : (
          action(month ?? year)
        )}
        {mine ? (
          <p className="text-center text-caption text-ink-3">
            {current?.source === "subscription" ? "Change plan, card or invoices." : "It’s already on your account."}
          </p>
        ) : refused ? null : !forSale ? (
          <p id={offId} className="text-center text-caption text-ink-3">
            Payments aren’t switched on yet.
          </p>
        ) : plan.trialDays && month && month.interval !== "one_time" ? (
          <p className="text-center text-caption text-ink-3">{plan.trialDays}-day free trial. Cancel any time.</p>
        ) : month?.interval === "one_time" ? (
          <p className="text-center text-caption text-ink-3">No subscription, no renewals.</p>
        ) : !month && !plan.contactSales ? (
          <p className="text-center text-caption text-ink-3">No card needed.</p>
        ) : null}
      </div>
      <div className="pt-6">
        {features.length > 0 && (
          <ul className="flex flex-col gap-3 border-t border-line pt-6 text-small text-ink-2">
            {features.map((f) => (
              <li key={f} className="flex gap-3">
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * The switch and the cards. `id` keeps two instances on one page from sharing
 * radios; `current` (from viewerPlan()) marks the signed-in viewer's plan;
 * `billingOn` (isBillingEnabled()) false turns paid plans' buttons into
 * "Not on sale yet"; `headingLevel` is 3 under a section's h2 (the landing
 * page) and 2 where the section heading is the page's h1 (/pricing).
 */
export function PricingPlans({
  plans,
  id = "plans",
  current = null,
  rankPrimary = false,
  billingOn = true,
  headingLevel = 3,
}: {
  plans: Plan[];
  id?: string;
  current?: CurrentPlan | null;
  /** On a page whose job is the plans (/pricing), the primary plan's action is the page's rank 2. */
  rankPrimary?: boolean;
  billingOn?: boolean;
  headingLevel?: 2 | 3;
}) {
  if (plans.length === 0) {
    return <p className="mt-10 text-small text-ink-3">No plans are published yet. Add one in the admin under Plans.</p>;
  }
  const choice = hasIntervalChoice(plans);
  const saving = yearlySaving(plans);
  const free = plans.find((p) => p.prices.length === 0 && !p.contactSales);
  // One solid button per view: the highlighted plan's, else the first paid one's — or, while
  // nothing can be bought, the free plan's.
  const primaryKey = (
    (!billingOn ? free : undefined) ??
    plans.find((p) => p.highlighted) ??
    plans.find((p) => p.prices.length > 0) ??
    plans[0]
  ).key;
  const cols = plans.length >= 4 ? "lg:grid-cols-4" : plans.length === 3 ? "lg:grid-cols-3" : plans.length === 2 ? "sm:grid-cols-2" : "";

  return (
    <div className="group/pricing">
      {choice && (
        <fieldset className="mb-8 flex flex-wrap items-center gap-3">
          <legend className="sr-only">Billing period</legend>
          <div className="inline-flex rounded-full border border-line-strong bg-surface p-1">
            {(["month", "year"] as const).map((m) => (
              <label
                key={m}
                className="relative inline-flex min-h-10 cursor-pointer items-center rounded-full px-4 text-small font-semibold text-ink-2 transition-[background-color,color] duration-(--dur-hover) ease-out-quart select-none hover:text-ink has-[:checked]:bg-action has-[:checked]:text-action-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus pointer-coarse:min-h-11"
              >
                <input
                  type="radio"
                  name={`${id}-interval`}
                  value={m}
                  id={`${id}-${m}`}
                  defaultChecked={m === "month"}
                  className={cn("sr-only", m === "year" && "interval-year")}
                />
                {m === "month" ? "Monthly" : "Yearly"}
              </label>
            ))}
          </div>
          {saving > 0 && <span className="text-small text-ink-2">Yearly saves up to {saving}%</span>}
        </fieldset>
      )}

      <ul
        aria-label="Plans"
        className={cn("grid gap-4", cols, plans.length >= 3 && "sm:grid-cols-2")}
      >
        {plans.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            plans={plans}
            choice={choice}
            primary={plan.key === primaryKey}
            current={current}
            rank={rankPrimary && plan.key === primaryKey}
            billingOn={billingOn}
            headingLevel={headingLevel}
            idPrefix={id}
          />
        ))}
      </ul>
    </div>
  );
}
