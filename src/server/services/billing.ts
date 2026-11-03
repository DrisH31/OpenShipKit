import "server-only";

//
// Entitlements, checkout and the customer portal, provider-neutral.
//
// What a user may use is DERIVED from the subscriptions and purchases that
// verified webhooks wrote — computeEntitlement(), grantedPlanKeys() and
// checkoutRefusal() are pure and unit-tested. Gate features with hasPlan() /
// requirePlan(); never with a query string.
//
// Rules the pure helpers hold:
//   - A row with planKey null (a Polar product no plan sells) grants nothing.
//   - A plan includes another through "Everything in <Plan>" (src/core/plans.ts):
//     a Lifetime buyer passes requirePlan(user, ["pro"]) and is never sold Pro.
//   - The entitlement shown is the best plan held, not the newest row.
//

import { redirect } from "next/navigation";
import { comparePlanRank, planCovers, type PlanRef } from "@/core/plans";
import { grantsAccess, type Entitlement, type Plan, type PriceInterval, type Purchase, type Subscription, type User } from "@/core/types";
import { getBilling } from "../billing";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { siteProfile, siteUrl } from "../env";
import { ServiceError } from "./errors";

/** Live subscriptions that grant a plan: an entitled status in its period, and a plan to grant. */
function liveSubscriptions(subscriptions: Subscription[], now: number): (Subscription & { planKey: string })[] {
  return subscriptions.filter((s): s is Subscription & { planKey: string } => s.planKey !== null && grantsAccess(s, now));
}

/** Unrefunded purchases of a plan. */
function ownedPurchases(purchases: Purchase[]): (Purchase & { planKey: string })[] {
  return purchases.filter((p): p is Purchase & { planKey: string } => p.planKey !== null && !p.refunded);
}

/** Pure: every plan key a user's live subscriptions and unrefunded purchases grant right now. */
export function grantedPlanKeys(subscriptions: Subscription[], purchases: Purchase[], now = new Date()): string[] {
  const keys = [...liveSubscriptions(subscriptions, now.getTime()), ...ownedPurchases(purchases)].map((r) => r.planKey);
  return [...new Set(keys)];
}

/**
 * Pure: the best current entitlement from a user's subscriptions and purchases.
 * Rows with no plan grant nothing. With `plans`, the best plan wins (one that
 * includes the other, else the higher sortOrder); between equal plans, or
 * without `plans`, a subscription comes before a purchase and the newest row
 * before older ones.
 */
export function computeEntitlement(
  subscriptions: Subscription[],
  purchases: Purchase[],
  now = new Date(),
  plans: readonly PlanRef[] = [],
): Entitlement {
  type Candidate = { planKey: string; at: string; entitlement: Entitlement };
  const candidates: Candidate[] = [
    ...liveSubscriptions(subscriptions, now.getTime()).map((s) => ({
      planKey: s.planKey,
      at: s.updatedAt,
      entitlement: {
        planKey: s.planKey,
        source: "subscription" as const,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      },
    })),
    ...ownedPurchases(purchases).map((p) => ({
      planKey: p.planKey,
      at: p.createdAt,
      entitlement: { planKey: p.planKey, source: "purchase" as const, status: "lifetime" as const, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    })),
  ];
  const sourceOrder = (c: Candidate) => (c.entitlement.source === "subscription" ? 1 : 0);
  candidates.sort(
    (a, b) =>
      comparePlanRank(b.planKey, a.planKey, plans) ||
      sourceOrder(b) - sourceOrder(a) ||
      (b.at > a.at ? 1 : b.at < a.at ? -1 : 0),
  );
  return candidates[0]?.entitlement ?? { planKey: null, source: "free", status: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false };
}

/** Why a checkout is refused: the reason travels as ServiceError("conflict") `details.reason`. */
export interface CheckoutRefusal {
  reason: "already_subscribed" | "already_owned";
  /** The full sentence: the error startCheckout throws. */
  message: string;
  /** A few words to show where the checkout button would be ("Included in your Lifetime plan"). */
  label: string;
}

/**
 * Pure: would a checkout for `planKey` at `interval` be refused, and why?
 * startCheckout enforces it. A page that offers checkout buttons asks first
 * through getCheckoutGuard() and shows `label` instead of a button that is
 * bound to fail.
 *
 *   - A plan the person's purchases already cover (the same one-time plan, or
 *     one that includes it, as Lifetime includes Pro) → "already_owned".
 *   - A subscription on top of a live subscription → "already_subscribed"
 *     (change plans in the portal).
 *   - A one-time plan while a subscription still RENEWS → "already_subscribed":
 *     cancel it first. Once every live subscription is set to end, the
 *     purchase is allowed; the subscription runs out at its period end.
 */
export function checkoutRefusal(input: {
  planKey: string;
  interval: PriceInterval;
  subscriptions: Subscription[];
  purchases: Purchase[];
  plans: readonly PlanRef[];
  now?: Date;
}): CheckoutRefusal | null {
  const { planKey, interval, plans } = input;
  const now = (input.now ?? new Date()).getTime();
  const name = (key: string) => plans.find((p) => p.key === key)?.name ?? key;
  const live = liveSubscriptions(input.subscriptions, now);

  if (interval !== "one_time" && live.length > 0) {
    return {
      reason: "already_subscribed",
      message: "You already have a subscription. Change or cancel it from Billing.",
      label: "Change plans from Billing",
    };
  }
  const covering = ownedPurchases(input.purchases).find((p) => planCovers(p.planKey, planKey, plans));
  if (covering) {
    return {
      reason: "already_owned",
      message:
        covering.planKey === planKey
          ? `You already own ${name(planKey)}. Nothing more to pay.`
          : `Your ${name(covering.planKey)} plan already includes ${name(planKey)}. Nothing more to pay.`,
      label: covering.planKey === planKey ? "You own this plan" : `Included in your ${name(covering.planKey)} plan`,
    };
  }
  if (interval === "one_time" && live.some((s) => !s.cancelAtPeriodEnd)) {
    // A one-time purchase on top would not stop the subscription renewing.
    return {
      reason: "already_subscribed",
      message: "You have a subscription that would keep renewing. Cancel it from Billing first (it stays active until the period ends), then buy the one-time plan.",
      label: "Cancel your subscription first",
    };
  }
  return null;
}

async function billingRows(userId: string) {
  const data = await getData();
  const [subs, purchases, plans] = await Promise.all([
    data.billing.listSubscriptions({ userId, limit: 50 }),
    data.billing.listPurchases({ userId, limit: 50 }),
    // Every plan, retired ones too: a customer keeps a plan retired with `active: false`.
    data.plans.list({}),
  ]);
  return { subscriptions: subs.items, purchases: purchases.items, plans };
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const { subscriptions, purchases, plans } = await billingRows(userId);
  return computeEntitlement(subscriptions, purchases, new Date(), plans);
}

/**
 * True when the user holds one of `planKeys`, or a plan that includes one
 * ("Everything in Pro" passes ["pro"]). Any paid plan when omitted.
 */
export async function hasPlan(userId: string, planKeys?: string[]): Promise<boolean> {
  const { subscriptions, purchases, plans } = await billingRows(userId);
  const held = grantedPlanKeys(subscriptions, purchases);
  if (held.length === 0) return false;
  return !planKeys || held.some((h) => planKeys.some((wanted) => planCovers(h, wanted, plans)));
}

/**
 * For a page or server action behind a paid plan: redirects to `redirectTo`
 * (the pricing page; the dashboard under OPENSHIPKIT_PROFILE=site, where
 * /pricing is a 404) unless the user holds one of `planKeys` or a plan that
 * includes one (any paid plan when omitted). Lifetime ("Everything in Pro")
 * passes a Pro gate.
 *
 *   const user = await requireUser("/dashboard/reports");
 *   await requirePlan(user, ["pro"]);
 */
export async function requirePlan(user: User, planKeys?: string[], redirectTo?: string): Promise<void> {
  if (!(await hasPlan(user.id, planKeys))) redirect(redirectTo ?? (siteProfile() === "site" ? "/dashboard" : "/pricing"));
}

export async function isBillingEnabled(): Promise<boolean> {
  return (await getBilling()) !== null;
}

/**
 * For the billing and pricing pages: a function that says whether a checkout
 * for (planKey, interval) would be refused for this user, and why — the same
 * rule startCheckout enforces, read once per page. Show `refusal.label` where
 * the checkout button would be:
 *
 *   const refuse = user ? await getCheckoutGuard(user.id) : () => null;
 *   const refusal = refuse(plan.key, price.interval);
 *   refusal ? <p>{refusal.label}</p> : <CheckoutButton … />
 */
export async function getCheckoutGuard(userId: string): Promise<(planKey: string, interval: PriceInterval) => CheckoutRefusal | null> {
  const rows = await billingRows(userId);
  const now = new Date();
  return (planKey, interval) => checkoutRefusal({ planKey, interval, ...rows, now });
}

/**
 * Start a hosted checkout for `planKey` at `interval`. Returns the URL to redirect to.
 * Refuses (ServiceError "conflict", `details.reason`) what checkoutRefusal()
 * refuses: a second subscription or a one-time purchase on top of a renewing
 * one ("already_subscribed"), and a plan the user's purchases already cover
 * ("already_owned").
 */
export async function startCheckout(user: User, planKey: string, interval: PriceInterval): Promise<string> {
  assertNotDemo(user);
  const billing = await getBilling();
  if (!billing) throw new ServiceError("unavailable", "Billing isn't configured (set BILLING_PROVIDER and its keys)");
  const data = await getData();
  const plan: Plan | null = await data.plans.getByKey(planKey);
  if (!plan || !plan.active) throw new ServiceError("not_found", `No active plan "${planKey}"`);
  if (plan.contactSales) throw new ServiceError("invalid", "This plan is sold by contacting sales");
  const price = plan.prices.find((p) => p.interval === interval);
  if (!price) throw new ServiceError("invalid", `Plan "${planKey}" has no ${interval} price`);
  if (!price.polarProductId) {
    throw new ServiceError("unavailable", `Plan "${planKey}" (${interval}) has no Polar product id yet — set it in /admin/plans`);
  }
  const refusal = checkoutRefusal({ planKey, interval, ...(await billingRows(user.id)) });
  if (refusal) throw new ServiceError("conflict", refusal.message, { reason: refusal.reason });
  const customerId = await data.billing.getCustomerId(user.id, billing.id);
  const base = siteUrl();
  const { url } = await billing.createCheckout({
    user,
    plan,
    price,
    customerId,
    successUrl: `${base}/dashboard/billing?checkout=success`,
    cancelUrl: `${base}/pricing?checkout=cancelled`,
  });
  return url;
}

export async function openPortal(user: User): Promise<string> {
  assertNotDemo(user);
  const billing = await getBilling();
  if (!billing) throw new ServiceError("unavailable", "Billing isn't configured");
  const customerId = await (await getData()).billing.getCustomerId(user.id, billing.id);
  if (!customerId) throw new ServiceError("not_found", "No billing account yet; subscribe to a plan first");
  const { url } = await billing.createPortal({ user, customerId, returnUrl: `${siteUrl()}/dashboard/billing` });
  return url;
}
