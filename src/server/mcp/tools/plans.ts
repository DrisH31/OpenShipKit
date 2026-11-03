import "server-only";

//
// Pricing plans: the cards on /pricing and what checkout sells. amountCents
// is what the page SHOWS; what a customer is CHARGED is the Polar product
// (polarProductId). Changing a price here never changes Polar, so the tools
// say so in their replies. Never invent a Polar product id.
//
// Who may change what: a write key edits a plan's copy and presentation
// (name, description, features, highlighted, contactSales, ctaLabel, active,
// sortOrder). Anything that changes what a customer is charged or gets —
// prices (amounts, intervals, currencies, Polar product ids), trialDays, or
// deleting a plan — needs an admin key. Entitlements are derived by matching
// a webhook's product id against these prices, so remapping them is
// remapping who gets paid access (SPEC invariant 4), and a write key is the
// one an agent that reads public feedback holds.
//

import { z } from "zod";
import { planSchema, slugSchema } from "@/core/schemas";
import { ServiceError } from "@/server/services/errors";
import { deletePlan, getPlan, listPlans, patchPlan, upsertPlan } from "@/server/services/plans";
import { DESTRUCTIVE, READ_ONLY, WRITE_IDEMPOTENT, defineTool } from "../types";
import { changesBilling, definedOnly, patchShape, requireScope } from "./shared";

const planKey = slugSchema.describe("The plan's key, e.g. free, pro");

const BILLING_CHANGE = "Changing a plan's prices, Polar product ids or trial";

const PRICE_NOTE =
  "amountCents is what /pricing shows. What a customer is charged is set on the Polar product in polarProductId; if a price changed, the matching Polar product must be changed by someone with Polar access.";

export const plansList = defineTool({
  name: "plans_list",
  title: "List plans",
  description:
    "List the pricing plans in display order, inactive ones included unless activeOnly is true. Each plan has key, name, description, features, prices (interval, amountCents, currency, polarProductId), highlighted, contactSales, ctaLabel, trialDays, active and sortOrder.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({ activeOnly: z.boolean().optional().describe("Only plans shown on /pricing; default false") }),
  async run({ activeOnly }) {
    return { items: await listPlans({ activeOnly: activeOnly ?? false }) };
  },
});

export const planGet = defineTool({
  name: "plan_get",
  title: "Read a plan",
  description: "Read one pricing plan by key, with all its fields and prices.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({ key: planKey }),
  async run({ key }) {
    const plan = await getPlan(key);
    if (!plan) throw new ServiceError("not_found", `No plan "${key}". plans_list shows the keys.`);
    return { ...plan };
  },
});

export const planUpsert = defineTool({
  name: "plan_upsert",
  title: "Create or replace a plan",
  description:
    "Create a plan, or replace an existing one with the same key, from a complete definition. Fields you omit take their defaults (not the old values), so to change a few fields of an existing plan use plan_update. Prices: amountCents in minor units ($24.00 → 2400), at most one per interval (month, year, one_time); no prices = a free plan. Leave polarProductId null unless the person gave you the id. With a write key, prices and trialDays must match what is stored (none, for a new plan); setting or changing them needs an admin key. Returns the saved plan.",
  scope: "write",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject(planSchema.shape),
  async run(args, ctx) {
    if (changesBilling(await getPlan(args.key), args)) requireScope(ctx, "admin", BILLING_CHANGE);
    const plan = await upsertPlan(args, ctx.actor);
    return { plan, note: PRICE_NOTE };
  },
});

const { key: _omitKey, ...planFields } = planSchema.shape; // eslint-disable-line @typescript-eslint/no-unused-vars

export const planUpdate = defineTool({
  name: "plan_update",
  title: "Edit a plan",
  description:
    "Change some fields of an existing plan by key; fields you leave out keep their value. Top-level fields replace whole: to change one price, send the full prices array (read it with plan_get first); to edit one feature line, send the full features list. Changing prices or trialDays needs an admin key; a write key edits the copy, features, highlighted, contactSales, ctaLabel, active and sortOrder. Returns the saved plan.",
  scope: "write",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({ key: planKey, ...patchShape(planFields) }),
  async run({ key, ...changes }, ctx) {
    const patch = definedOnly(changes);
    if (Object.keys(patch).length === 0) throw new ServiceError("invalid", "Pass at least one field to change");
    if (patch.prices !== undefined || patch.trialDays !== undefined) {
      const current = await getPlan(key);
      if (!current) throw new ServiceError("not_found", `No plan "${key}". plans_list shows the keys.`);
      const next = { prices: patch.prices ?? current.prices, trialDays: patch.trialDays !== undefined ? patch.trialDays : current.trialDays };
      if (changesBilling(current, next)) requireScope(ctx, "admin", BILLING_CHANGE);
    }
    const plan = await patchPlan(key, patch, ctx.actor);
    return { plan, ...("prices" in patch ? { note: PRICE_NOTE } : {}) };
  },
});

export const planDelete = defineTool({
  name: "plan_delete",
  title: "Delete a plan",
  description:
    "Delete a plan by key. Only when explicitly asked; to hide a plan from /pricing, use plan_update {active: false} instead. Existing subscribers keep what they paid for. Needs an admin key. The deleted plan is kept in the audit log, so audit_restore can bring it back.",
  scope: "admin",
  annotations: DESTRUCTIVE,
  input: z.strictObject({ key: planKey }),
  async run({ key }, ctx) {
    await deletePlan(key, ctx.actor);
    return { deleted: key };
  },
});

export const PLAN_TOOLS = [plansList, planGet, planUpsert, planUpdate, planDelete];
