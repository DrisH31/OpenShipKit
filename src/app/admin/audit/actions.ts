"use server";

//
// Undo from the audit log: put an entry's `before` value back (content, posts
// and plans). requireAdmin() first; the service writes its own audit entry,
// so a restore can itself be undone.
//

import { redirect } from "next/navigation";
import { type ActionState } from "@/lib/action-state";
import { attempt } from "@/server/attempt";
import { actorFor, requireAdmin } from "@/server/session";
import { restoreAuditEntry } from "@/server/services/audit";

export async function restoreAction(id: string): Promise<ActionState> {
  const admin = await requireAdmin();
  const result = await attempt("admin.audit.restore", async () => {
    await restoreAuditEntry(id, actorFor(admin));
    return "Restored.";
  });
  if (!result.ok) return result;
  redirect(`/admin/audit/${id}?restored=1`);
}
