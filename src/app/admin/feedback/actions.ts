"use server";

//
// Triage one feedback item: its status and a private note. requireAdmin()
// first; updateFeedback validates (feedbackUpdateSchema) and audits.
//

import { refresh } from "next/cache";
import { type ActionState } from "@/lib/action-state";
import { attempt } from "@/server/attempt";
import { text } from "@/lib/form-data";
import { FEEDBACK_STATUS } from "@/lib/status";
import { actorFor, requireAdmin } from "@/server/session";
import { updateFeedback } from "@/server/services/community";

export async function triageFeedback(id: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const note = text(form, "adminNote");
  return attempt("admin.feedback.update", async () => {
    const f = await updateFeedback(id, { status: text(form, "status"), adminNote: note || null }, actorFor(admin));
    refresh();
    return `Saved: ${FEEDBACK_STATUS[f.status].label.toLowerCase()}.`;
  });
}
