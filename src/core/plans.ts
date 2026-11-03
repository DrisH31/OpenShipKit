//
// Plan inheritance and rank, pure: no I/O, safe on the client and the server.
//
// A plan includes another when one of its features reads "Everything in
// <Plan>" (the seeded Lifetime and Enterprise plans say "Everything in Pro").
// The pricing cards expand that line into the other plan's features; the
// entitlement layer (src/server/services/billing.ts) reads the same line, so a
// Lifetime buyer passes a `requirePlan(user, ["pro"])` gate and is never sold
// Pro on top. One rule, written once: the UI's plan rules and the billing
// service both build on these.
//
// The line names a plan by its display NAME, so the plan service guards names
// (src/server/services/plans.ts): two plans can't share a name, renaming a
// plan rewrites the lines that name it (renameInInheritance), and a plan
// another plan includes can't be deleted (includers).
//

import type { Plan } from "./types";

/** The fields inheritance and rank read. A full Plan fits. */
export type PlanRef = Pick<Plan, "key" | "name" | "features" | "sortOrder">;

const EVERYTHING_IN = /^everything in (.+?)(?:,? plus)?$/i;
/** The same line in three parts, so a rename can swap just the name: "Everything in " · "Pro" · ", plus". */
const EVERYTHING_IN_PARTS = /^(\s*everything in )(.+?)((?:,? plus)?\s*)$/i;

/** The plan an "Everything in <Plan>" line names (by its display name), if it is one of `plans`. */
export function inheritedPlan<P extends PlanRef>(feature: string, plans: readonly P[]): P | undefined {
  const m = EVERYTHING_IN.exec(feature.trim());
  if (!m) return undefined;
  const name = m[1].trim().toLowerCase();
  return plans.find((p) => p.name.toLowerCase() === name);
}

/**
 * `feature` with the plan it names changed from `oldName` to `newName` when it
 * is an "Everything in <oldName>" line (any case, keeping ", plus"); any other
 * line comes back unchanged.
 */
export function renameInInheritance(feature: string, oldName: string, newName: string): string {
  const m = EVERYTHING_IN_PARTS.exec(feature);
  if (!m || m[2].trim().toLowerCase() !== oldName.trim().toLowerCase()) return feature;
  return `${m[1]}${newName.trim()}${m[3]}`;
}

/** The plans whose own "Everything in <Plan>" line names `plan` (directly). Never `plan` itself. */
export function includers<P extends PlanRef>(plan: PlanRef, plans: readonly P[]): P[] {
  return plans.filter((p) => p.key !== plan.key && p.features.some((f) => inheritedPlan(f, [plan])));
}

/** The plans `plan` builds on through "Everything in <Plan>", directly or not. Never `plan` itself; cycles stop. */
export function includedPlans<P extends PlanRef>(plan: PlanRef, plans: readonly P[], seen = new Set<string>([plan.key])): P[] {
  const out: P[] = [];
  for (const f of plan.features) {
    const base = inheritedPlan(f, plans);
    if (base && !seen.has(base.key)) {
      seen.add(base.key);
      out.push(base, ...includedPlans(base, plans, seen));
    }
  }
  return out;
}

/**
 * Does holding `heldKey` give everything `wantedKey` gives? True for the same
 * key, or for a plan that includes it ("Everything in Pro" covers "pro"). A key
 * that isn't in `plans` (a deleted plan) covers only itself.
 */
export function planCovers(heldKey: string, wantedKey: string, plans: readonly PlanRef[]): boolean {
  if (heldKey === wantedKey) return true;
  const held = plans.find((p) => p.key === heldKey);
  return held ? includedPlans(held, plans).some((p) => p.key === wantedKey) : false;
}

/**
 * Which of two held plans is the better one: > 0 when `aKey` ranks above
 * `bKey`, < 0 below, 0 when they can't be told apart. A plan that includes the
 * other wins; otherwise the higher sortOrder (the pricing page lists plans from
 * the entry tier up); a key missing from `plans` ranks below every known one.
 */
export function comparePlanRank(aKey: string, bKey: string, plans: readonly PlanRef[]): number {
  if (aKey === bKey) return 0;
  if (planCovers(aKey, bKey, plans)) return 1;
  if (planCovers(bKey, aKey, plans)) return -1;
  const a = plans.find((p) => p.key === aKey);
  const b = plans.find((p) => p.key === bKey);
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  return a.sortOrder - b.sortOrder;
}
