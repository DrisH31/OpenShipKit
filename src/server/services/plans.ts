import "server-only";

//
// Pricing plans. The pricing page, checkout and entitlement checks all read
// these. A price's provider ids (polarProductId, stripePriceId, razorpayPlanId:
// src/core/billing.ts) connect it to what it sells there.
//
// A plan someone pays for is load-bearing: every renewal webhook finds the
// plan by its Polar product id. So while a live subscription or an unrefunded
// purchase holds a plan, it can't be deleted and its product ids can't be
// removed or changed — that would silently turn a paying customer into "no
// plan". Retire it with `active: false` instead: it leaves the pricing page and
// checkout, and existing customers keep their access.
//
// Inheritance ("Everything in Pro", src/core/plans.ts) names a plan by its
// display name, and gates what a buyer can open. So names are kept safe too:
// two plans can't share one, renaming a plan rewrites every line that names it
// in the same change (each audited), and a plan another plan includes can't be
// deleted until that line goes.
//

import { ENTITLED_STATUSES, type Actor, type Page, type Plan, type PlanInput, type Purchase, type Subscription } from "@/core/types";
import { MAX_LIMIT } from "@/core/data";
import { includers, renameInInheritance } from "@/core/plans";
import { planSchema } from "@/core/schemas";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { recordAudit } from "./audit";
import { ServiceError, parseInput } from "./errors";
import { PRICE_ID_LABEL, storedPriceIds } from "@/core/billing";

export async function listPlans(opts: { activeOnly?: boolean } = {}): Promise<Plan[]> {
  return (await getData()).plans.list(opts);
}

export async function getPlan(key: string): Promise<Plan | null> {
  return (await getData()).plans.getByKey(key);
}

/** How many live subscriptions and unrefunded purchases hold `key`. */
export async function planHolders(key: string): Promise<{ subscriptions: number; purchases: number }> {
  const billing = (await getData()).billing;
  let subscriptions = 0;
  for (const status of ENTITLED_STATUSES) {
    let cursor: string | null = null;
    do {
      const page: Page<Subscription> = await billing.listSubscriptions({ status, limit: MAX_LIMIT, cursor });
      subscriptions += page.items.filter((s) => s.planKey === key).length;
      cursor = page.nextCursor;
    } while (cursor);
  }
  let purchases = 0;
  let cursor: string | null = null;
  do {
    const page: Page<Purchase> = await billing.listPurchases({ limit: MAX_LIMIT, cursor });
    purchases += page.items.filter((p) => p.planKey === key && !p.refunded).length;
    cursor = page.nextCursor;
  } while (cursor);
  return { subscriptions, purchases };
}

function describeHolders({ subscriptions, purchases }: { subscriptions: number; purchases: number }): string {
  const parts = [
    subscriptions ? `${subscriptions} live subscription${subscriptions === 1 ? "" : "s"}` : "",
    purchases ? `${purchases} purchase${purchases === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" and ");
}

async function assertNoHolders(key: string, doing: string): Promise<void> {
  const holders = await planHolders(key);
  if (holders.subscriptions + holders.purchases === 0) return;
  throw new ServiceError(
    "conflict",
    `Can't ${doing}: ${describeHolders(holders)} use plan "${key}", and their renewals find it by its billing provider's id for the price. Set it inactive instead (active: false) to hide it from pricing and checkout.`,
  );
}

/** Provider ids `before` sells that `after` no longer sells at the same interval, whichever provider. */
function droppedProductIds(before: Plan, after: { prices: Plan["prices"] }): string[] {
  return before.prices.flatMap((p) =>
    storedPriceIds(p)
      .filter(({ field, id }) => !after.prices.some((q) => q.interval === p.interval && (q[field] ?? null) === id))
      .map(({ id }) => id),
  );
}

/**
 * Refuse a change from `current` to `next` (null: deleted) that would orphan
 * paying customers. Used by upsert, delete and the audit restore.
 */
export async function assertSafePlanChange(key: string, current: Plan | null, next: { prices: Plan["prices"] } | null): Promise<void> {
  if (!current) return;
  if (!next) {
    await assertNotIncluded(current);
    return assertNoHolders(key, "delete it");
  }
  if (droppedProductIds(current, next).length > 0) await assertNoHolders(key, "remove or change a price's billing provider id");
}

/** Refuse deleting a plan another plan includes: that plan's buyers would silently lose it. */
async function assertNotIncluded(plan: Plan): Promise<void> {
  const by = includers(plan, await listPlans());
  if (by.length === 0) return;
  const names = by.map((p) => `"${p.name}"`).join(", ");
  throw new ServiceError(
    "conflict",
    `Can't delete it: ${names} ${by.length === 1 ? "includes" : "include"} it ("Everything in ${plan.name}"), so their buyers would lose it. Remove that line first, or set this plan inactive.`,
  );
}

/** Inheritance finds a plan by name, so two plans with one name would make "Everything in <name>" ambiguous. */
async function assertUniqueName(key: string, name: string): Promise<void> {
  const clash = (await listPlans()).find((p) => p.key !== key && p.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (clash) {
    throw new ServiceError("conflict", `Plan "${clash.key}" is already called ${clash.name}. Each plan needs its own name.`, [
      { path: "name", message: `Already used by plan "${clash.key}"` },
    ]);
  }
}

/**
 * After `before` was renamed to `after.name`: rewrite every other plan's
 * "Everything in <old name>" line to the new name and audit each, so a rename
 * never takes the included plan away from anyone. Used by upsertPlan and the
 * audit restore. Returns the plans it changed.
 */
export async function carryPlanRename(before: Plan | null, after: Plan, actor: Actor): Promise<Plan[]> {
  assertNotDemo(actor);
  if (!before || before.name.trim().toLowerCase() === after.name.trim().toLowerCase()) return [];
  const data = await getData();
  const changed: Plan[] = [];
  for (const other of await listPlans()) {
    if (other.key === after.key) continue;
    const features = other.features.map((f) => renameInInheritance(f, before.name, after.name));
    if (features.every((f, i) => f === other.features[i])) continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, updatedAt, ...rest } = other;
    const updated = await data.plans.upsert({ ...rest, features });
    await recordAudit(actor, "plan.update", "plan", other.key, other, updated);
    changed.push(updated);
  }
  return changed;
}

/**
 * One Polar product, one price: the webhook files a buyer under the first plan
 * whose price carries the product id, so a product pasted onto a second price
 * (here or on another plan) would silently hand that plan's customers to the
 * wrong one.
 */
async function assertUniqueProductIds(key: string, prices: Plan["prices"]): Promise<void> {
  const taken = new Map<string, string>(); // provider:id → where it is already used
  for (const plan of await listPlans()) {
    if (plan.key === key) continue;
    for (const p of plan.prices) for (const { provider, id } of storedPriceIds(p)) taken.set(`${provider}:${id}`, `plan "${plan.key}" (${p.interval})`);
  }
  prices.forEach((price, i) => {
    for (const { provider, field, id } of storedPriceIds(price)) {
      const usedBy = taken.get(`${provider}:${id}`);
      if (usedBy) {
        throw new ServiceError("conflict", `${PRICE_ID_LABEL[provider]} ${id} is already used by ${usedBy}. Each price needs its own.`, [
          { path: `prices.${i}.${field}`, message: `Already used by ${usedBy}` },
        ]);
      }
      taken.set(`${provider}:${id}`, `plan "${key}" (${price.interval})`);
    }
  });
}

/**
 * Every check a plan must pass before it is written, whoever writes it: the
 * schema, trimmed product ids, one price per interval, one Polar product per
 * price and a name no other plan uses. Used by upsertPlan and the audit restore (src/server/services/audit.ts),
 * so an undo can't put back what an edit would refuse. Returns the plan to write.
 */
export async function validatePlanWrite(input: unknown): Promise<PlanInput> {
  const raw = parseInput(planSchema, input);
  // A pasted id often carries a space, which would never match Polar's: trim it (empty → none).
  const parsed = {
    ...raw,
    prices: raw.prices.map((p) => ({
      ...p,
      polarProductId: p.polarProductId?.trim() || null,
      ...(p.stripePriceId !== undefined ? { stripePriceId: p.stripePriceId?.trim() || null } : {}),
      ...(p.razorpayPlanId !== undefined ? { razorpayPlanId: p.razorpayPlanId?.trim() || null } : {}),
    })),
  };
  const intervals = parsed.prices.map((p) => p.interval);
  if (new Set(intervals).size !== intervals.length) throw new ServiceError("invalid", "At most one price per interval");
  await assertUniqueProductIds(parsed.key, parsed.prices);
  await assertUniqueName(parsed.key, parsed.name);
  return parsed;
}

export async function upsertPlan(input: unknown, actor: Actor): Promise<Plan> {
  assertNotDemo(actor);
  const parsed = await validatePlanWrite(input);
  const data = await getData();
  const before = await data.plans.getByKey(parsed.key);
  await assertSafePlanChange(parsed.key, before, parsed);
  const plan = await data.plans.upsert(parsed);
  await recordAudit(actor, before ? "plan.update" : "plan.create", "plan", plan.key, before, plan);
  await carryPlanRename(before, plan, actor);
  return plan;
}

/** Merge a partial change into an existing plan (top-level fields replace). */
export async function patchPlan(key: string, patch: Record<string, unknown>, actor: Actor): Promise<Plan> {
  assertNotDemo(actor);
  const current = await getPlan(key);
  if (!current) throw new ServiceError("not_found", `No plan "${key}"`);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, updatedAt, ...rest } = current;
  return upsertPlan({ ...rest, ...patch, key }, actor);
}

/** Delete a plan nobody holds and no other plan includes. One that customers pay for is refused: set it inactive instead. */
export async function deletePlan(key: string, actor: Actor): Promise<void> {
  assertNotDemo(actor);
  const data = await getData();
  const before = await data.plans.getByKey(key);
  if (!before) throw new ServiceError("not_found", `No plan "${key}"`);
  await assertSafePlanChange(key, before, null);
  await data.plans.delete(key);
  await recordAudit(actor, "plan.delete", "plan", key, before, null);
}
