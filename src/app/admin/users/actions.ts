"use server";

//
// User management: role, ban, delete. requireAdmin() first; the services keep
// the invariants (the last admin can't be demoted, banned or deleted; nobody
// bans themselves) and audit every change.
//

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { attempt, failure, type ActionState } from "@/lib/action-state";
import { text } from "@/lib/form-data";
import { actorFor, requireAdmin } from "@/server/session";
import { deleteUser, setUserBanned, setUserRole } from "@/server/services/users";

export async function setRoleAction(id: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const role = text(form, "role");
  if (role !== "user" && role !== "admin") return failure("Choose a role: user or admin.", [{ path: "role", message: "Choose user or admin." }]);
  return attempt("admin.users.role", async () => {
    const user = await setUserRole(id, role, actorFor(admin));
    refresh();
    return role === "admin" ? `${user.email} is now an admin.` : `${user.email} is no longer an admin.`;
  });
}

export async function setBannedAction(id: string, banned: boolean): Promise<ActionState> {
  const admin = await requireAdmin();
  return attempt("admin.users.ban", async () => {
    const user = await setUserBanned(id, banned, actorFor(admin));
    refresh();
    return banned ? `${user.email} is banned and can’t sign in to the app.` : `${user.email} can use the app again.`;
  });
}

export async function deleteUserAction(id: string): Promise<ActionState> {
  const admin = await requireAdmin();
  if (id === admin.id) return failure("To delete your own account, use Settings → Delete account.");
  const result = await attempt("admin.users.delete", async () => {
    await deleteUser(id, actorFor(admin));
    return "Deleted.";
  });
  if (!result.ok) return result;
  redirect("/admin/users?deleted=1");
}
