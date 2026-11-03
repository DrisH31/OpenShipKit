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
import { RENEWING_STATUSES, grantsAccess, isRenewing, type Entitlement, type Plan, type PriceInterval, type Purchase, type Subscription, type User } from "@/core/types";
import { getBilling } from "../billing";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { siteProfile, siteUrl } from "../env";
import { currentOrg } from "../orgs";
import { ServiceError } from "./errors";
import { orgSeats, requireOrgPermission, teamsEnabled } from "./orgs";
import { BillingProviderError, PRICE_ID_LABEL, PROVIDER_LABEL, priceIdFor, type PaidProviderId } from "@/core/billing";
import { recordAudit } from "./audit";

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
        ...(s.currentPeriodStart ? { currentPeriodStart: s.currentPeriodStart } : {}),
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
    // With teams, the plan is the organisation's: the one this person is working in. A personal plan
    // bought before teams were turned on still counts, so turning them on cuts nobody off.
    if (await hasPlan(user.id, planKeys)) return;
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
  const billingFor = await getBilling();
  if (billingFor && !priceIdFor(plan, price, billingFor.id)) {
    throw new ServiceError("unavailable", `Plan "${planKey}" (${interval}) has no ${PRICE_ID_LABEL[billingFor.id]} yet — set it in /admin/plans`);
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
    // Manage billing is the payer's own portal: everything they pay for (ownBilling). An owner who
    // doesn't pay is told who does on the billing page, not here.
    const provider = await getBilling();
    if (!provider) throw new ServiceError("unavailable", "Billing isn't configured");
    if (!provider.hasPortal) throw new ServiceError("invalid", `${provider.label} has no customer portal: cancel from the billing page.`);
    const own = await ownBilling(user);
    if (!own) throw new ServiceError("not_found", "You haven't bought anything here, so there's no billing to manage.");
    return (await own.billing.createPortal({ user, customerId: own.customerId, returnUrl: `${siteUrl()}/dashboard/billing` })).url;
  }
  const billing = await getBilling();
  if (!billing) throw new ServiceError("unavailable", "Billing isn't configured");
  if (!billing.hasPortal) throw new ServiceError("invalid", `${billing.label} has no customer portal: cancel from the billing page.`);
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
  const billingFor = await getBilling();
  if (billingFor && !priceIdFor(plan, price, billingFor.id)) {
    throw new ServiceError("unavailable", `Plan "${planKey}" (${interval}) has no ${PRICE_ID_LABEL[billingFor.id]} yet — set it in /admin/plans`);
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
  // One subscription at a time, including one that is set to end but still running: buying now, and
  // the old one being resumed in Polar, would charge the team twice.
  const subs = (await (await getData()).billing.listSubscriptions({ orgId, limit: 50 })).items;
  if (subs.some(isRenewing)) {
    throw new ServiceError("conflict", `${org.name} already has a subscription. Change or cancel it on the Billing page.`, { reason: "already_subscribed" });
  }
  const running = subs.find((s) => s.planKey !== null && grantsAccess(s));
  if (running) {
    throw new ServiceError(
      "conflict",
      `${org.name}'s current plan runs until ${running.currentPeriodEnd?.slice(0, 10) ?? "the end of its period"}. Choose a new one after that, or ask whoever pays to resume it.`,
      { reason: "already_subscribed" },
    );
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
 * What this person pays for, and the provider customer that holds it: the one question behind
 * Manage billing, asked by both the page (paysForAnything) and the portal (openPortal), so they
 * can't disagree. Subscriptions (personal, or a team's they bought, whether or not they're still in
 * it) and one-time purchases alike: a buyer reaches their receipts and refunds too. Polar keys all of
 * it to the customer who paid, so the portal belongs to the payer, not to a team or a role.
 */
async function ownBilling(user: User): Promise<{ customerId: string; billing: NonNullable<Awaited<ReturnType<typeof getBilling>>> } | null> {
  const billing = await getBilling();
  if (!billing) return null;
  const data = await getData();
  const [subs, purchases] = await Promise.all([data.billing.listSubscriptions({ userId: user.id, limit: 50 }), data.billing.listPurchases({ userId: user.id, limit: 1 })]);
  if (subs.items.length === 0 && purchases.items.length === 0) return null;
  const customerId = (await data.billing.getCustomerId(user.id, billing.id)) ?? subs.items.find((s) => s.providerCustomerId)?.providerCustomerId ?? null;
  return customerId ? { customerId, billing } : null;
}

export type OrgBillingView = {
  org: { id: string; name: string };
  role: "owner" | "admin" | "member";
  seats: { limit: number | null; used: number };
  entitlement: Entitlement;
  subscriptions: Subscription[];
  /** Who pays: the person whose Polar customer holds the subscription, if any. */
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
  const paying = subscriptions.find(isRenewing) ?? subscriptions[0];
  const payerUser = paying ? await (await getData()).users.getById(paying.userId) : null;
  // A payer who has left is shown as such: their address isn't the business of people who joined since.
  const payerStillHere = payerUser ? (await (await getData()).orgs.getMember(org.id, payerUser.id)) !== null : false;
  const payer = payerUser ? { id: payerUser.id, email: payerStillHere ? payerUser.email : "a former member" } : null;
  const renewing = subscriptions.some((s) => isRenewing(s) || (s.planKey !== null && grantsAccess(s)));
  const refuse = (planKey: string, interval: PriceInterval): CheckoutRefusal | null => {
    if (role !== "owner") return { reason: "not_owner", message: "Only an owner can choose the organisation's plan.", label: "Only an owner can buy a plan" };
    if (interval === "one_time") return { reason: "org_one_time", message: "An organisation's plan is a subscription.", label: "Organisations subscribe monthly or yearly" };
    if (renewing) return { reason: "already_subscribed", message: `${org.name} already has a subscription.`, label: "Switch plans from Billing" };
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

/** Whether Manage billing would open for this person (ownBilling, the same question openPortal asks). */
export async function paysForAnything(user: User): Promise<boolean> {
  return (await ownBilling(user)) !== null;
}

/**
 * For a provider with no customer portal (Razorpay): the subscriptions this person pays for that
 * still renew, which the billing page offers to cancel. Empty with a portal provider, or billing off.
 */
export async function listCancellable(user: User): Promise<Subscription[]> {
  const billing = await getBilling();
  if (!billing || billing.hasPortal) return [];
  return (await (await getData()).billing.listSubscriptions({ userId: user.id, limit: 50 })).items.filter(isRenewing);
}

/**
 * Stop a subscription this person pays for from renewing, through the provider's API (for a provider
 * with no portal). It runs to the end of the period. Only its payer may. The provider records the
 * request first (audited as this person, and refused if a press at the same time got there first),
 * then asks; its new state goes through the webhook sink like any webhook. A failure comes back in
 * words that say what happened: refused (with the provider's reason, and nothing changed), or no
 * answer (marked as ending; if the provider renews it anyway, it renews here again).
 */
export async function cancelSubscription(user: User, subscriptionId: string): Promise<void> {
  assertNotDemo(user);
  const billing = await getBilling();
  if (!billing) throw new ServiceError("unavailable", "Billing isn't configured");
  if (!billing.cancelAtPeriodEnd) throw new ServiceError("invalid", `Cancel in ${billing.label}'s portal: Manage billing.`);
  const sub = (await (await getData()).billing.listSubscriptions({ userId: user.id, limit: 50 })).items.find((s) => s.id === subscriptionId);
  if (!sub) throw new ServiceError("not_found", "No such subscription of yours.");
  if (!isRenewing(sub)) throw new ServiceError("conflict", "It's already set to end, or has ended.");
  try {
    await billing.cancelAtPeriodEnd(sub.providerSubscriptionId, { type: "user", id: user.id, label: user.email });
  } catch (error) {
    if (error instanceof BillingProviderError) throw new ServiceError(error.kind === "no_answer" ? "unavailable" : "conflict", error.message);
    throw error;
  }
}

/** Whether Manage billing can open a portal (Polar, Stripe) or the page offers Cancel instead (Razorpay). */
export async function billingHasPortal(): Promise<boolean> {
  return (await getBilling())?.hasPortal ?? false;
}

/**
 * Subscriptions the app last saw renewing at a provider other than the one configured, by provider.
 * After BILLING_PROVIDER changes, that provider's webhooks are refused (they can't be verified), so
 * these rows never change on their own: the customers keep being charged there while access runs
 * out here. No time filter: a row whose period has passed is the same customer, still charged. An
 * admin clears them once handled (endStrandedSubscriptions). Shown on the admin overview and logged
 * at startup; docs/billing.md#switching-providers.
 */
export async function strandedSubscriptions(): Promise<Partial<Record<PaidProviderId, number>>> {
  const current = (await getBilling())?.id ?? "none";
  const counts = await (await getData()).billing.countRenewingByProvider();
  return Object.fromEntries(Object.entries(counts).filter(([p, n]) => p !== current && (n ?? 0) > 0));
}

/**
 * An admin's "handled": stop every subscription still renewing at `provider` (not the one configured)
 * from renewing here, once they've been cancelled there or the people told. Each keeps the access its
 * customer paid for, to the end of its period, then lapses on its own; no row is cut short. Each is
 * audited as the admin. Refused for the provider in use, whose own webhooks keep its rows true, and
 * while billing is off (every live subscriber would look stranded).
 */
export async function endStrandedSubscriptions(admin: User, provider: PaidProviderId): Promise<number> {
  assertNotDemo(admin);
  if (admin.role !== "admin") throw new ServiceError("forbidden", "Only an admin can do that.");
  const inUse = (await getBilling())?.id;
  if (!inUse) throw new ServiceError("invalid", "Billing is off, so every live subscription looks stranded. Turn billing back on first.");
  if (inUse === provider) throw new ServiceError("invalid", `${PROVIDER_LABEL[provider]} is the provider in use: its webhooks keep these subscriptions up to date.`);
  const data = await getData();
  // Collect first, then end: ending rows while paging would shift the pages under the cursor.
  const stranded: Subscription[] = [];
  for (const status of RENEWING_STATUSES) {
    let cursor: string | undefined;
    do {
      const page = await data.billing.listSubscriptions({ status, limit: 200, cursor });
      stranded.push(...page.items.filter((s) => s.provider === provider && isRenewing(s)));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  const actor = { type: "user" as const, id: admin.id, label: admin.email };
  for (const sub of stranded) {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = sub; // eslint-disable-line @typescript-eslint/no-unused-vars
    const after = await data.billing.upsertSubscription({ ...rest, cancelAtPeriodEnd: true });
    await recordAudit(actor, "subscription.update", "subscription", sub.id, sub, after);
  }
  return stranded.length;
}

/** Startup: say loudly when people still pay a provider this site no longer listens to. Never throws. */
export async function warnStrandedSubscriptions(): Promise<void> {
  try {
    const stranded = Object.entries(await strandedSubscriptions());
    if (!stranded.length) return;
    const { log } = await import("../log");
    const what = stranded.map(([p, n]) => `${n} with ${p}`).join(", ");
    log.error("billing", `${what} still renew, but billing is now ${(await getBilling())?.id ?? "off"}: their webhooks are refused, so they keep paying and lose access at the period end. Cancel them at the old provider or switch back (docs/billing.md#switching-providers).`);
  } catch {
    // A database that isn't ready yet: the health check reports that, not this.
  }
}

export type PriceCheck = { provider: string; problems: string[]; unchecked: string[] };

/**
 * For /admin/plans/<key>: whether what the plan shows matches what the provider charges for each of its
 * prices (amount, currency, interval). The pricing page shows the plan's amount; the customer pays the
 * provider's. Each price is checked on its own: one the provider couldn't answer for goes in
 * `unchecked`, and the others still report. null when billing is off or the provider can't say.
 * Admin pages only: it calls the provider.
 */
export async function checkPlanPrices(plan: Plan): Promise<PriceCheck | null> {
  const billing = await getBilling();
  if (!billing?.describePrice) return null;
  const { formatPrice } = await import("@/shared/money");
  const word = { month: "monthly", year: "yearly", one_time: "one-time" } as const;
  const problems: string[] = [];
  const unchecked: string[] = [];
  await Promise.all(
    plan.prices
      .filter((p) => p.amountCents > 0)
      .map(async (price) => {
        const id = priceIdFor(plan, price, billing.id);
        if (!id) return;
        const name = `${word[price.interval][0].toUpperCase()}${word[price.interval].slice(1)} (${id})`;
        let at: Awaited<ReturnType<NonNullable<typeof billing.describePrice>>>;
        try {
          at = await billing.describePrice!(id);
        } catch (error) {
          unchecked.push(`${name}: ${billing.label} didn't answer (${error instanceof Error ? error.message : "no reason given"}).`);
          return;
        }
        if (at === "skip") return;
        if (!at) {
          problems.push(`${name}: ${billing.label} has no such price.`);
          return;
        }
        if (at.interval !== price.interval) {
          const schedule = at.interval === "other" ? "on another schedule" : word[at.interval];
          problems.push(price.interval === "one_time" ? `${name}: ${billing.label} bills it ${schedule}; the plan sells it once.` : `${name}: ${billing.label} bills it ${schedule}, not ${word[price.interval]}.`);
        }
        if (at.currency && at.currency.toLowerCase() !== price.currency.toLowerCase()) problems.push(`${name}: ${billing.label} charges in ${at.currency.toUpperCase()}, the plan shows ${price.currency.toUpperCase()}.`);
        else if (at.amountCents !== null && at.amountCents !== price.amountCents)
          problems.push(`${name}: ${billing.label} charges ${formatPrice(at.amountCents, price.currency)}${price.perSeat ? " per seat" : ""}, the plan shows ${formatPrice(price.amountCents, price.currency)}.`);
      }),
  );
  // In the plan's own price order, whatever order the provider answered in.
  const order = (line: string) => plan.prices.findIndex((p) => line.includes(`(${priceIdFor(plan, p, billing.id)})`));
  return { provider: billing.label, problems: problems.sort((a, b) => order(a) - order(b)), unchecked };
}
