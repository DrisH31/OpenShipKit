import "server-only";

//
// The billing webhook WRITE PATH: what happens to a provider's verified,
// re-fetched subscription or order once its adapter hands it over (the
// BillingWebhookSink port in ./shared.ts). Resolve the app user, match the
// product to a plan (or, failing that, the plan key our checkout put in the
// metadata — only while the object is still on the product that checkout
// sold; see planFromCheckout), remember the customer, upsert, audit a real
// change, and claim the event id last. A product on no plan is stored with
// planKey null and grants nothing (see warnUnmatched).
//
// TRANSITIONAL HOME. This is a service (SPEC §2: validate → DataStore → audit)
// and belongs at src/server/services/billing-webhooks.ts, with the port types
// in src/core/billing.ts and the registry (src/server/billing.ts) passing it
// as createPolarProvider({ sink }). It is written to move verbatim: it imports
// nothing from src/adapters except those types. Until then the Polar adapter
// loads it lazily as its default sink.
//
// Change detection compares INSTANTS, not strings: the store returns
// toISOString() (milliseconds, "Z") while Polar sends "Z" or microseconds, so
// a string compare would call every redelivery a change and audit it.
//

import type { PaidProvider } from "@/core/data";
import type { Actor, Plan, PriceInterval, PurchaseInput, SubscriptionUpsert } from "@/core/types";
import { getData } from "@/server/data";
import { log as appLog } from "@/server/log";
import { recordAudit } from "@/server/services/audit";
import type { BillingWebhookSink, ProviderOrderState, ProviderSubscriptionState, WebhookApplyResult } from "./shared";

export function webhookActor(provider: PaidProvider): Actor {
  return { type: "system", id: null, label: `webhook:${provider}` };
}

/** Ids and outcomes only — never payloads, emails or secrets. */
function log(provider: PaidProvider, message: string, loud = false): void {
  if (loud) appLog.error(`billing:${provider}`, message);
  else appLog.info(`billing:${provider}`, message);
}

/**
 * An ISO-8601 instant in the store's canonical form (toISOString: milliseconds,
 * UTC), or null. Throws on garbage rather than storing "no period end" — that
 * would read as entitled forever.
 */
export function normalizeInstant(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp from the billing provider: ${JSON.stringify(value)}`);
  return new Date(ms).toISOString();
}

/** True when both are null, or both name the same instant to the millisecond. */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

export interface PlanMatch {
  planKey: string;
  interval: PriceInterval;
}

/**
 * Which plan and interval a Polar product id belongs to (set per price in
 * /admin/plans). Inactive plans count: a customer can still hold one.
 */
export async function findPlanByProductId(productId: string | null | undefined): Promise<PlanMatch | null> {
  if (!productId) return null;
  const plans: Plan[] = await (await getData()).plans.list();
  for (const plan of plans) {
    for (const price of plan.prices) {
      if (price.polarProductId && price.polarProductId === productId) return { planKey: plan.key, interval: price.interval };
    }
  }
  return null;
}

/**
 * The app user a provider object belongs to, trying each hint in order, then
 * the stored customer mapping. Only ids of users that exist count — a write
 * for a deleted user would fail on Postgres's foreign key forever.
 */
export async function resolveUserId(
  provider: PaidProvider,
  hints: { candidates: (string | null | undefined)[]; customerId: string | null | undefined },
): Promise<string | null> {
  const data = await getData();
  for (const id of hints.candidates) {
    if (typeof id === "string" && id && (await data.users.getById(id))) return id;
  }
  if (hints.customerId) {
    const mapped = await data.billing.findUserIdByCustomerId(provider, hints.customerId);
    if (mapped && (await data.users.getById(mapped))) return mapped;
  }
  return null;
}

/** Remember the provider customer for the user, so later checkouts and the portal reuse it. Audited when it changes. */
export async function rememberCustomer(provider: PaidProvider, userId: string, customerId: string | null | undefined): Promise<void> {
  if (!customerId) return;
  const data = await getData();
  const previous = await data.billing.getCustomerId(userId, provider);
  if (previous === customerId) return;
  await data.billing.setCustomerId(userId, provider, customerId);
  await recordAudit(
    webhookActor(provider),
    "billing.customer_link",
    "billing_customer",
    userId,
    previous ? { provider, customerId: previous } : null,
    { provider, customerId },
  );
}

const SUBSCRIPTION_FIELDS = [
  "userId",
  "planKey",
  "interval",
  "status",
  "cancelAtPeriodEnd",
  "providerCustomerId",
] as const satisfies readonly (keyof SubscriptionUpsert)[];

/** Upsert the canonical subscription state; audit only a real change. Returns whether anything changed. */
export async function upsertSubscription(input: SubscriptionUpsert): Promise<boolean> {
  const data = await getData();
  const normalized: SubscriptionUpsert = { ...input, currentPeriodEnd: normalizeInstant(input.currentPeriodEnd) };
  const before = await data.billing.getSubscription(normalized.provider, normalized.providerSubscriptionId);
  const changed =
    !before ||
    SUBSCRIPTION_FIELDS.some((k) => before[k] !== normalized[k]) ||
    !sameInstant(before.currentPeriodEnd, normalized.currentPeriodEnd);
  if (!changed) return false;
  const after = await data.billing.upsertSubscription(normalized);
  await recordAudit(
    webhookActor(normalized.provider),
    before ? "subscription.update" : "subscription.create",
    "subscription",
    after.id,
    before,
    after,
  );
  return true;
}

/** Record (or re-record) a one-time purchase; audit only a real change. */
export async function upsertPurchase(input: PurchaseInput): Promise<boolean> {
  const data = await getData();
  // There is no getPurchase(provider, orderId); a user's purchases are a short list.
  const existing = (await data.billing.listPurchases({ userId: input.userId, limit: 200 })).items.find(
    (p) => p.provider === input.provider && p.providerOrderId === input.providerOrderId,
  );
  const changed =
    !existing ||
    existing.refunded !== input.refunded ||
    existing.planKey !== input.planKey ||
    existing.amountCents !== input.amountCents ||
    existing.currency !== input.currency;
  if (!changed) return false;
  const after = await data.billing.recordPurchase(input);
  const action = !existing ? "purchase.create" : input.refunded && !existing.refunded ? "purchase.refund" : "purchase.update";
  await recordAudit(webhookActor(input.provider), action, "purchase", after.id, existing ?? null, after);
  return true;
}

/**
 * The plan our own checkout sold, from the provider object's metadata — or
 * null. It counts only while the object is still on the product that checkout
 * sold (checkoutProductId === productId). That keeps a customer's plan when an
 * admin edits the plan's product id in /admin/plans after they bought it, but
 * a subscription moved (in the customer portal, or by hand in Polar) to a
 * product no plan sells gets nothing: Polar keeps the metadata across a
 * product change, so trusting the plan key alone would keep the old paid plan
 * on whatever product they pay for now (SPEC §3.4).
 */
export function planFromCheckout(state: { productId: string | null; planKeyHint: string | null; checkoutProductId: string | null }): string | null {
  if (!state.planKeyHint || !state.checkoutProductId || !state.productId) return null;
  return state.checkoutProductId === state.productId ? state.planKeyHint : null;
}

/**
 * A subscription or order for a product on no plan, with no plan key from our
 * own checkout for that product either: another product the Polar
 * organisation sells, a product the customer switched to, or a
 * price whose product id was never entered in /admin/plans. It is stored with
 * planKey null — a true record for payment history — and must grant no plan:
 * computeEntitlement (src/server/services/billing.ts) has to skip rows with no
 * plan, so one can't open a paid gate or block a real checkout. Loud, because
 * a customer may have paid for access.
 */
function warnUnmatched(provider: PaidProvider, what: string, productId: string | null): void {
  log(
    provider,
    `${what}: product ${productId ?? "?"} is not on any plan — stored with no plan, grants nothing. If it should grant a plan, add its product id in /admin/plans; Polar's next event for it applies it.`,
    true,
  );
}

async function applySubscription(state: ProviderSubscriptionState): Promise<WebhookApplyResult> {
  const { provider } = state;
  const userId = await resolveUserId(provider, { candidates: state.userIdHints, customerId: state.providerCustomerId });
  if (!userId) {
    // Acknowledge, but loudly: someone may have paid and has no access.
    log(provider, `subscription ${state.providerSubscriptionId}: no app user for customer ${state.providerCustomerId ?? "?"} — not applied`, true);
    return "unknown_user";
  }
  const plan = await findPlanByProductId(state.productId);
  const planKey = plan?.planKey ?? planFromCheckout(state);
  if (!planKey) warnUnmatched(provider, `subscription ${state.providerSubscriptionId}`, state.productId);
  await rememberCustomer(provider, userId, state.providerCustomerId);
  const changed = await upsertSubscription({
    userId,
    provider,
    providerSubscriptionId: state.providerSubscriptionId,
    providerCustomerId: state.providerCustomerId,
    planKey,
    interval: plan?.interval ?? state.interval,
    status: state.status,
    currentPeriodEnd: state.currentPeriodEnd,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
  });
  return changed ? "applied" : "unchanged";
}

async function applyOrder(state: ProviderOrderState): Promise<WebhookApplyResult> {
  const { provider } = state;
  const userId = await resolveUserId(provider, { candidates: state.userIdHints, customerId: state.providerCustomerId });
  if (!userId) {
    log(provider, `order ${state.providerOrderId}: no app user for customer ${state.providerCustomerId ?? "?"} — not applied`, true);
    return "unknown_user";
  }
  const plan = await findPlanByProductId(state.productId);
  const planKey = plan?.planKey ?? planFromCheckout(state);
  if (!planKey) warnUnmatched(provider, `order ${state.providerOrderId}`, state.productId);
  await rememberCustomer(provider, userId, state.providerCustomerId);
  const changed = await upsertPurchase({
    userId,
    provider,
    providerOrderId: state.providerOrderId,
    planKey,
    amountCents: state.amountCents,
    currency: state.currency.toLowerCase(),
    refunded: state.refunded,
  });
  return changed ? "applied" : "unchanged";
}

/** The sink the Polar adapter uses by default. */
export const billingWebhookSink: BillingWebhookSink = {
  applySubscription,
  applyOrder,
  async markEventProcessed(provider, eventId) {
    return (await getData()).billing.claimWebhookEvent(provider, eventId);
  },
};
