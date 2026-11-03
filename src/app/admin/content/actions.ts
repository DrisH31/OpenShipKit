"use server";

//
// Content section writes: save (the editor posts the whole value as JSON) and
// reset to default. requireAdmin() first; the service validates with the
// section's schema and records the audit entry. Both return the stored value,
// so the editor adopts exactly what the server kept.
//

import { refresh } from "next/cache";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { isContentKey } from "@/core/content";
import { attempt, failure, type ActionState } from "@/lib/action-state";
import { json } from "@/lib/form-data";
import { actorFor, requireAdmin } from "@/server/session";
import { resetContent, updateContent } from "@/server/services/content";

export async function saveContent(key: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = json(form, "value");
  if (!parsed.ok) return failure(parsed.reason, [{ path: "", message: parsed.reason }]);
  return attempt("admin.content.update", async () => {
    const saved = await updateContent(key, parsed.value, actorFor(admin));
    refresh();
    return { message: "Saved. It’s live on the site now.", data: { value: JSON.stringify(saved.value) } };
  });
}

export async function resetContentToDefault(key: string): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!isContentKey(key)) return failure(`Unknown section “${key}”.`);
  return attempt("admin.content.reset", async () => {
    await resetContent(key, actorFor(admin));
    refresh();
    return { message: "Back to the default. The old version is in the audit log.", data: { value: JSON.stringify(DEFAULT_CONTENT[key]) } };
  });
}
