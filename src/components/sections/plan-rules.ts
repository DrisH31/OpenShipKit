//
// The plan rules, pure: no I/O, no React, safe on the client and the server.
// The pricing cards, the /pricing comparison table and FAQ, and the dashboard's
// billing page all read the plans through these, so they can't disagree:
//
//   resolveFeatures   "Everything in Pro" expanded into Pro's own list
//   comparisonRows    one row per feature, amounts ("1", "Unlimited") on one row
//   priceFor          the price a card shows for the monthly/yearly switch
//   yearlySaving      the saving computed from the prices, never typed
//   hasIntervalChoice whether there is anything to switch
//
// Inheritance itself ("Everything in <Plan>" names a plan) is NOT decided here:
// it comes from src/core/plans.ts, the same rule the entitlement layer
// (requirePlan, checkout) reads, so a card can never promise a plan the billing
// service doesn't grant. Imports only src/core, so it can move into src/core
// as is.
//

import { includedPlans, inheritedPlan } from "@/core/plans";
import type { Plan, PlanPrice } from "@/core/types";

/** The billing view the monthly/yearly switch selects. */
export type Mode = "month" | "year";

const QUANTITY = /^(\d[\d,.]*|unlimited)\s+(.+)$/i;

/** "1 project" → { amount: "1", noun: "project", key: "project" }; "Unlimited projects" → the same key. Else null. */
export function quantityOf(feature: string): { amount: string; noun: string; key: string } | null {
  const m = QUANTITY.exec(feature.trim());
  if (!m) return null;
  const noun = m[2].trim();
  const amount = /^unlimited$/i.test(m[1]) ? "Unlimited" : m[1];
  return { amount, noun, key: noun.toLowerCase().replace(/s$/, "") };
}

/** The plans `plan` builds on through "Everything in <Plan>", directly or not (src/core/plans.ts). */
export function basePlans(plan: Plan, plans: readonly Plan[]): Plan[] {
  return includedPlans(plan, plans);
}

/**
 * A plan's features with "Everything in <Plan>" expanded into that plan's own
 * list. A quantity the plan states itself replaces the inherited one in place
 * ("Unlimited projects" over Free's "1 project"), so a card never lists both.
 */
export function resolveFeatures(plan: Plan, plans: readonly Plan[], seen = new Set<string>()): string[] {
  seen.add(plan.key);
  const out: string[] = [];
  const add = (f: string, own: boolean) => {
    if (out.includes(f)) return;
    const q = own ? quantityOf(f) : null;
    const at = q ? out.findIndex((x) => quantityOf(x)?.key === q.key) : -1;
    if (at >= 0) out[at] = f;
    else out.push(f);
  };
  for (const f of plan.features) {
    const base = inheritedPlan(f, plans);
    if (base && !seen.has(base.key)) for (const g of resolveFeatures(base, plans, seen)) add(g, false);
    else add(f, true);
  }
  return out;
}

/** A comparison cell: included or not, or the amount ("1", "Unlimited") on a quantity row. */
export type ComparisonCell = boolean | string;

/**
 * The comparison table's rows, one per feature, each with one cell per plan
 * (in `plans` order). Features that differ only in their amount ("1 project",
 * "Unlimited projects") share one row whose cells are the amounts, so a higher
 * plan never shows a dash for the thing a lower plan counts.
 */
export function comparisonRows(plans: Plan[]): { label: string; cells: ComparisonCell[] }[] {
  const resolved = plans.map((p) => resolveFeatures(p, plans));
  // A quantity row only when two or more different lines count the same thing.
  const variants = new Map<string, Set<string>>();
  for (const f of resolved.flat()) {
    const q = quantityOf(f);
    if (q) variants.set(q.key, (variants.get(q.key) ?? new Set()).add(f));
  }
  const rows: { key: string; label: string; cells: ComparisonCell[] }[] = [];
  resolved.forEach((features, col) => {
    for (const f of features) {
      const q = quantityOf(f);
      const shared = q && (variants.get(q.key)?.size ?? 0) > 1 ? q : null;
      const key = shared ? `#${shared.key}` : f;
      let row = rows.find((r) => r.key === key);
      if (!row) {
        // The row is named by the plural form when one is used ("Projects"), else the noun.
        const nouns = shared ? [...(variants.get(shared.key) ?? [])].map((v) => quantityOf(v)?.noun ?? "") : [];
        const noun = nouns.sort((a, b) => b.length - a.length)[0] ?? "";
        row = { key, label: shared ? noun.charAt(0).toUpperCase() + noun.slice(1) : f, cells: plans.map(() => false) };
        rows.push(row);
      }
      row.cells[col] = shared ? shared.amount : true;
    }
  });
  return rows.map(({ label, cells }) => ({ label, cells }));
}

/** The price a card shows in `mode`, or the plan's only price (one-time, or monthly-only). */
export function priceFor(plan: Plan, mode: Mode): PlanPrice | null {
  return (
    plan.prices.find((p) => p.interval === mode) ??
    plan.prices.find((p) => p.interval === "one_time") ??
    plan.prices.find((p) => p.interval !== "one_time") ??
    null
  );
}

/** The largest yearly saving across plans that sell both, as a whole percentage (0 when none). */
export function yearlySaving(plans: Plan[]): number {
  let best = 0;
  for (const plan of plans) {
    const m = plan.prices.find((p) => p.interval === "month");
    const y = plan.prices.find((p) => p.interval === "year");
    if (m && y && m.amountCents > 0 && m.currency === y.currency) {
      best = Math.max(best, 1 - y.amountCents / (m.amountCents * 12));
    }
  }
  return Math.floor(best * 100);
}

/** True when at least one plan has both a monthly and a yearly price — otherwise there's nothing to switch. */
export function hasIntervalChoice(plans: Plan[]): boolean {
  return plans.some((p) => p.prices.some((x) => x.interval === "month") && p.prices.some((x) => x.interval === "year"));
}
