"use server";

//
// Put a failed background job back in the queue. requireAdmin() first; the
// service checks it is failed and records the audit entry.
//

import { refresh } from "next/cache";
import { type ActionState } from "@/lib/action-state";
import { text } from "@/lib/form-data";
import { attempt } from "@/server/attempt";
import { retryFailedJob } from "@/server/jobs";
import { actorFor, requireAdmin } from "@/server/session";

export async function retryJobAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = text(form, "id");
  return attempt("admin.jobs.retry", async () => {
    const job = await retryFailedJob(id, actorFor(admin));
    refresh();
    return `${job.kind} is queued again.`;
  });
}
