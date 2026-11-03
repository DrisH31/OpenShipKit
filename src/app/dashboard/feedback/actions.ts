"use server";

//
// Feedback from a signed-in person. requireUser() first; the service validates
// (feedbackCreateSchema) and fills email and name from the account, so the form
// never asks for them. Five a minute per person keeps a stuck key from flooding
// the admin inbox.
//

import { refresh } from "next/cache";
import { attempt, failure, type ActionState } from "@/lib/action-state";
import { nullableText, text } from "@/lib/form-data";
import { rateLimit } from "@/server/rate-limit";
import { requireUser } from "@/server/session";
import { submitFeedback } from "@/server/services/community";

export async function sendFeedback(_state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser("/dashboard/feedback");
  if (!rateLimit(`feedback:${user.id}`, 5, 60_000).ok) return failure("That’s a lot of feedback at once. Wait a minute and send the rest.");
  return attempt("dashboard.feedback.create", async () => {
    await submitFeedback({ kind: text(form, "kind") || "general", title: nullableText(form, "title"), message: text(form, "message") }, user);
    refresh();
    return "Thanks — it’s in. You’ll see its status change here when we pick it up.";
  });
}
