"use server";

//
// Plans: create, save, delete. requireAdmin() first. The editor posts the
// whole plan as JSON; upsertPlan validates it with planSchema (one price per
// interval, Polar product ids as plain strings) and audits it.
//
// A plan's key is its identity (checkouts and entitlements refer to it), so an
// existing plan's key is pinned from the URL — the editor can't rename it into
// a second plan — and "new" refuses a key that's already taken.
//
// Under OPENSHIPKIT_PROFILE=site the pages are a 404 (./layout.tsx), and so are
// these actions: an action is callable by its id without the page.
//

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { attempt, failure, type ActionState } from "@/lib/action-state";
import { json } from "@/lib/form-data";
import { requireSaasProfile } from "@/server/profile";
import { actorFor, requireAdmin } from "@/server/session";
import { deletePlan, getPlan, upsertPlan } from "@/server/services/plans";

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function savePlan(key: string, _state: ActionState, form: FormData): Promise<ActionState> {
  requireSaasProfile();
  const admin = await requireAdmin();
  const parsed = json(form, "value");
  if (!parsed.ok) return failure(parsed.reason, [{ path: "", message: parsed.reason }]);
  const value = asObject(parsed.value);
  if (!value) return failure("A plan is an object with a key, a name and prices.");
  return attempt("admin.plans.update", async () => {
    const plan = await upsertPlan({ ...value, key }, actorFor(admin));
    refresh();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, updatedAt, ...stored } = plan;
    return { message: "Saved. The pricing page shows it now.", data: { value: JSON.stringify(stored) } };
  });
}

export async function createPlan(_state: ActionState, form: FormData): Promise<ActionState> {
  requireSaasProfile();
  const admin = await requireAdmin();
  const parsed = json(form, "value");
  if (!parsed.ok) return failure(parsed.reason, [{ path: "", message: parsed.reason }]);
  const value = asObject(parsed.value);
  const key = typeof value?.key === "string" ? value.key.trim() : "";
  if (!value) return failure("A plan is an object with a key, a name and prices.");
  if (key && (await getPlan(key))) return failure(`A plan with the key “${key}” already exists.`, [{ path: "key", message: "That key is taken. Pick another." }]);
  let saved = "";
  const result = await attempt("admin.plans.create", async () => {
    saved = (await upsertPlan(value, actorFor(admin))).key;
    return "Plan created.";
  });
  if (!result.ok) return result;
  redirect(`/admin/plans/${saved}?created=1`);
}

export async function deletePlanAction(key: string): Promise<ActionState> {
  requireSaasProfile();
  const admin = await requireAdmin();
  const result = await attempt("admin.plans.delete", async () => {
    await deletePlan(key, actorFor(admin));
    return "Deleted.";
  });
  if (!result.ok) return result;
  redirect("/admin/plans?deleted=1");
}
