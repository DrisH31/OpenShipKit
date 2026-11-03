"use server";

//
// The team page's forms (OPENSHIPKIT_TENANCY=org). requireUser() first in
// every one; the services (src/server/services/orgs.ts) check the role in
// that organisation, keep an owner, and audit. The organisation id is bound by
// the page, and the service checks the caller's membership of it whatever it is.
//

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { failure, type ActionState } from "@/lib/action-state";
import { text } from "@/lib/form-data";
import type { OrgRole } from "@/core/orgs";
import { attempt } from "@/server/attempt";
import { rememberOrg } from "@/server/orgs";
import {
  acceptInvitation,
  createOrg,
  deleteOrg,
  inviteMember,
  leaveOrg,
  orgAccess,
  removeMember,
  revokeInvitation,
  setMemberRole,
  transferOwnership,
  updateOrg,
} from "@/server/services/orgs";
import { requireUser } from "@/server/session";

const TEAM = "/dashboard/team";

export async function createOrgAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(TEAM);
  const name = text(form, "name");
  return attempt("dashboard.team.create", async () => {
    const org = await createOrg(user, { name });
    await rememberOrg(org.id);
    refresh();
    return `${org.name} is ready. Invite your team next.`;
  });
}

export async function switchOrgAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(TEAM);
  const orgId = text(form, "orgId");
  return attempt("dashboard.team.switch", async () => {
    const { org } = await orgAccess(user, orgId);
    await rememberOrg(org.id);
    refresh();
    return `Now working in ${org.name}.`;
  });
}

export async function renameOrgAction(orgId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(TEAM);
  const name = text(form, "name");
  const slug = text(form, "slug");
  return attempt("dashboard.team.rename", async () => {
    const org = await updateOrg(user, orgId, { name, ...(slug ? { slug } : {}) });
    refresh();
    return `Saved: ${org.name} (${org.slug}).`;
  });
}

export async function inviteAction(orgId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(TEAM);
  const email = text(form, "email");
  const role = text(form, "role") === "admin" ? "admin" : "member";
  return attempt("dashboard.team.invite", async () => {
    const { invitation } = await inviteMember(user, orgId, { email, role });
    refresh();
    return `Invitation sent to ${invitation.email}. The link works for 7 days.`;
  });
}

export async function revokeInviteAction(orgId: string, invitationId: string): Promise<ActionState> {
  const user = await requireUser(TEAM);
  return attempt("dashboard.team.revoke", async () => {
    await revokeInvitation(user, orgId, invitationId);
    refresh();
    return "Invitation revoked: its link no longer works.";
  });
}

export async function setRoleAction(orgId: string, userId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(TEAM);
  const role = text(form, "role") as OrgRole;
  if (role !== "admin" && role !== "member") return failure("Choose admin or member.", [{ path: "role", message: "Choose admin or member." }]);
  return attempt("dashboard.team.role", async () => {
    const m = await setMemberRole(user, orgId, userId, role);
    refresh();
    return `${m.name ?? m.email} is now ${role === "admin" ? "an admin" : "a member"}.`;
  });
}

export async function removeMemberAction(orgId: string, userId: string): Promise<ActionState> {
  const user = await requireUser(TEAM);
  return attempt("dashboard.team.remove", async () => {
    await removeMember(user, orgId, userId);
    refresh();
    return "Removed from the organisation.";
  });
}

export async function transferAction(orgId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(TEAM);
  const to = text(form, "userId");
  if (!to) return failure("Choose who becomes the owner.", [{ path: "userId", message: "Choose a member." }]);
  return attempt("dashboard.team.transfer", async () => {
    await transferOwnership(user, orgId, to);
    refresh();
    return "Ownership transferred. You're an admin now.";
  });
}

export async function leaveAction(orgId: string): Promise<ActionState> {
  const user = await requireUser(TEAM);
  const result = await attempt("dashboard.team.leave", async () => {
    await leaveOrg(user, orgId);
    return "You left the organisation.";
  });
  if (result.ok) redirect(TEAM);
  return result;
}

export async function deleteOrgAction(orgId: string, orgName: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(TEAM);
  if (text(form, "confirm") !== orgName) return failure(`Type “${orgName}” to confirm.`, [{ path: "confirm", message: "Type the organisation's name exactly." }]);
  const result = await attempt("dashboard.team.delete", async () => {
    await deleteOrg(user, orgId);
    return `${orgName} is deleted.`;
  });
  if (result.ok) redirect(TEAM);
  return result;
}

/** From /invite/[token]: join, open that organisation, and go to the team page. */
export async function acceptInviteAction(token: string): Promise<ActionState> {
  // Tokens are base64url (src/server/services/orgs.ts), safe in a path as they are.
  const user = await requireUser(`/invite/${token}`);
  const result = await attempt("dashboard.team.accept", async () => {
    const org = await acceptInvitation(user, token);
    await rememberOrg(org.id);
    return `You joined ${org.name}.`;
  });
  if (result.ok) redirect(TEAM);
  return result;
}
