"use server";

//
// Take one address off the email list (an admin acting on a request).
// requireAdmin() first; the service records the audit entry.
//

import { refresh } from "next/cache";
import { attempt, type ActionState } from "@/lib/action-state";
import { text } from "@/lib/form-data";
import { actorFor, requireAdmin } from "@/server/session";
import { unsubscribe } from "@/server/services/community";

export async function unsubscribeAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const email = text(form, "email");
  return attempt("admin.subscribers.unsubscribe", async () => {
    const result = await unsubscribe(email, actorFor(admin));
    refresh();
    return result ? `${result.email} is unsubscribed.` : `${email} wasn’t on the list.`;
  });
}
