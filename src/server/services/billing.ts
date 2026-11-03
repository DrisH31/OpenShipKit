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
// Teams (OPENSHIPKIT_TENANCY=org): the organisation holds the subscription.
// A person's own entitlement reads only their personal rows (orgId null), so a
// subscription bought for an organisation never grants its buyer a plan.
// requirePlan(), startCheckout() and openPortal() act for the organisation the
// person is working in (src/server/orgs.ts), and only an owner may buy or
// manage (billing.manage). Per-seat prices buy one seat per member and open
// invitation; the seat limit is enforced in src/server/services/orgs.ts.
//

import { redirect } from "next/navigation";
import { comparePlanRank, planCovers, type PlanRef } from "@/core/plans";
import { grantsAccess, type Entitlement, type Plan, type PriceInterval, type Purchase, type Subscription, type User } from "@/core/types";
import { getBilling } from "../billing";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { siteProfile, siteUrl } from "../env";
import { currentOrg } from "../orgs";
import { ServiceError } from "./errors";
import { liveOrgSubscriptions, orgSeats, requireOrgPermission, teamsEnabled } from "./orgs";

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
  /** not_owner, org_one_time: an organisation's checkout (teams); the others apply to everyone. */
  reason: "already_subscribed" | "already_owned" | "not_owner" | "org_one_time";
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
    // Personal rows only: an organisation's subscription is the organisation's, not its buyer's.
    data.billing.listSubscriptions({ userId, orgId: null, limit: 50 }),
    data.billing.listPurchases({ userId, limit: 50 }),
    // Every plan, retired ones too: a customer keeps a plan retired with `active: false`.
    data.plans.list({}),
  ]);
  return { subscriptions: subs.items, purchases: purchases.items, plans };
}

/** An organisation's rows, in the same shape (organisations buy subscriptions only). */
async function orgBillingRows(orgId: string) {
  const data = await getData();
  const [subs, plans] = await Promise.all([data.billing.listSubscriptions({ orgId, limit: 50 }), data.plans.list({})]);
  return { subscriptions: subs.items, purchases: [] as Purchase[], plans };
}

export async function getOrgEntitlement(orgId: string): Promise<Entitlement> {
  const { subscriptions, purchases, plans } = await orgBillingRows(orgId);
  return computeEntitlement(subscriptions, purchases, new Date(), plans);
}

/** hasPlan() for an organisation. */
export async function hasOrgPlan(orgId: string, planKeys?: string[]): Promise<boolean> {
  const { subscriptions, purchases, plans } = await orgBillingRows(orgId);
  const held = grantedPlanKeys(subscriptions, purchases);
  if (held.length === 0) return false;
  return !planKeys || held.some((h) => planKeys.some((wanted) => planCovers(h, wanted, plans)));
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
  const fallback = redirectTo ?? (siteProfile() === "site" ? "/dashboard" : "/pricing");
  if (teamsEnabled()) {
    // With teams, the plan is the organisation's: the one this person is working in.
    const access = await currentOrg(user);
    if (!access) redirect("/dashboard/team");
    if (!(await hasOrgPlan(access.org.id, planKeys))) redirect(fallback);
    return;
  }
  if (!(await hasPlan(user.id, planKeys))) redirect(fallback);
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
  if (teamsEnabled()) {
    const access = await currentOrg(user);
    if (!access) throw new ServiceError("conflict", "Create an organisation first: with teams, the organisation holds the plan.", { reason: "no_org" });
    return startOrgCheckout(user, access.org.id, planKey, interval);
  }
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
  if (teamsEnabled()) {
    const access = await currentOrg(user);
    if (!access) throw new ServiceError("not_found", "No organisation yet; create one first.");
    return openOrgPortal(user, access.org.id);
  }
  const billing = await getBilling();
  if (!billing) throw new ServiceError("unavailable", "Billing isn't configured");
  const customerId = await (await getData()).billing.getCustomerId(user.id, billing.id);
  if (!customerId) throw new ServiceError("not_found", "No billing account yet; subscribe to a plan first");
  const { url } = await billing.createPortal({ user, customerId, returnUrl: `${siteUrl()}/dashboard/billing` });
  return url;
}

/** A plan and price that can be checked out, or a ServiceError saying why not. */
async function sellable(planKey: string, interval: PriceInterval): Promise<{ plan: Plan; price: Plan["prices"][number] }> {
  const plan: Plan | null = await (await getData()).plans.getByKey(planKey);
  if (!plan || !plan.active) throw new ServiceError("not_found", `No active plan "${planKey}"`);
  if (plan.contactSales) throw new ServiceError("invalid", "This plan is sold by contacting sales");
  const price = plan.prices.find((p) => p.interval === interval);
  if (!price) throw new ServiceError("invalid", `Plan "${planKey}" has no ${interval} price`);
  if (!price.polarProductId) {
    throw new ServiceError("unavailable", `Plan "${planKey}" (${interval}) has no Polar product id yet — set it in /admin/plans`);
  }
  return { plan, price };
}

/**
 * Checkout for an organisation: owners only (billing.manage), subscriptions only, one live
 * subscription at a time (changes go through the portal). A per-seat price buys a seat for every
 * member and open invitation. The verified webhook binds the subscription to the organisation
 * through the checkout's metadata; nothing here grants anything.
 */
export async function startOrgCheckout(user: User, orgId: string, planKey: string, interval: PriceInterval): Promise<string> {
  assertNotDemo(user);
  const billing = await getBilling();
  if (!billing) throw new ServiceError("unavailable", "Billing isn't configured (set BILLING_PROVIDER and its keys)");
  const { org } = await requireOrgPermission(user, orgId, "billing.manage");
  if (interval === "one_time") throw new ServiceError("invalid", "An organisation's plan is a subscription: choose a monthly or yearly price.");
  const { plan, price } = await sellable(planKey, interval);
  if ((await liveOrgSubscriptions(orgId)).some((s) => !s.cancelAtPeriodEnd)) {
    throw new ServiceError("conflict", `${org.name} already has a subscription. Change or cancel it in Billing.`, { reason: "already_subscribed" });
  }
  const seats = price.perSeat ? Math.max(1, (await orgSeats(orgId)).used) : undefined;
  const customerId = await (await getData()).billing.getCustomerId(user.id, billing.id);
  const base = siteUrl();
  const { url } = await billing.createCheckout({
    user,
    plan,
    price,
    customerId,
    orgId,
    ...(seats !== undefined ? { seats } : {}),
    successUrl: `${base}/dashboard/billing?checkout=success`,
    cancelUrl: `${base}/pricing?checkout=cancelled`,
  });
  return url;
}

/**
 * The provider's portal for an organisation's subscription: owners only. Polar ties a subscription
 * to the customer who paid, so the portal opens for that person; after an ownership transfer, the
 * new owner is told who manages payment until it's moved in Polar.
 */
export async function openOrgPortal(user: User, orgId: string): Promise<string> {
  assertNotDemo(user);
  const billing = await getBilling();
  if (!billing) throw new ServiceError("unavailable", "Billing isn't configured");
  const { org } = await requireOrgPermission(user, orgId, "billing.manage");
  const subs = (await (await getData()).billing.listSubscriptions({ orgId, limit: 50 })).items;
  const current = subs[0];
  if (!current) throw new ServiceError("not_found", `${org.name} has no subscription yet; choose a plan first.`);
  if (current.userId !== user.id) {
    const buyer = await (await getData()).users.getById(current.userId);
    throw new ServiceError("conflict", `Payment for ${org.name} is managed by ${buyer?.email ?? "the owner who subscribed"}. They can change the card or plan, or cancel.`, {
      reason: "managed_by_other",
    });
  }
  const customerId = current.providerCustomerId ?? (await (await getData()).billing.getCustomerId(user.id, billing.id));
  if (!customerId) throw new ServiceError("not_found", "No billing account yet; subscribe to a plan first");
  const { url } = await billing.createPortal({ user, customerId, returnUrl: `${siteUrl()}/dashboard/billing` });
  return url;
}

export type OrgBillingView = {
  org: { id: string; name: string };
  role: "owner" | "admin" | "member";
  seats: { limit: number | null; used: number };
  entitlement: Entitlement;
  subscriptions: Subscription[];
  /** Who pays: the owner whose Polar customer holds the subscription, if any. */
  payerEmail: string | null;
  /** startOrgCheckout's rule, for the plan cards: the same shape as getCheckoutGuard. */
  refuse: (planKey: string, interval: PriceInterval) => CheckoutRefusal | null;
};

/**
 * The billing page with teams on: the organisation the person is working in.
 * Null when they belong to none. Any member may look (billing.view); only the
 * owner gets checkout buttons, and a refusal label otherwise.
 */
export async function getOrgBillingView(user: User): Promise<OrgBillingView | null> {
  const access = await currentOrg(user);
  if (!access) return null;
  const { org, role } = await requireOrgPermission(user, access.org.id, "billing.view");
  const [{ subscriptions, purchases, plans }, seats] = await Promise.all([orgBillingRows(org.id), orgSeats(org.id)]);
  const payer = subscriptions[0] ? await (await getData()).users.getById(subscriptions[0].userId) : null;
  const renewing = (await liveOrgSubscriptions(org.id)).some((s) => !s.cancelAtPeriodEnd);
  const refuse = (planKey: string, interval: PriceInterval): CheckoutRefusal | null => {
    if (role !== "owner") return { reason: "not_owner", message: "Only an owner can choose the organisation's plan.", label: "Only an owner can buy a plan" };
    if (interval === "one_time") return { reason: "org_one_time", message: "An organisation's plan is a subscription.", label: "Organisations subscribe monthly or yearly" };
    if (renewing) return { reason: "already_subscribed", message: `${org.name} already has a subscription.`, label: "Switch in Manage billing" };
    void planKey;
    return null;
  };
  return {
    org: { id: org.id, name: org.name },
    role,
    seats,
    entitlement: computeEntitlement(subscriptions, purchases, new Date(), plans),
    subscriptions,
    payerEmail: payer?.email ?? null,
    refuse,
  };
}
