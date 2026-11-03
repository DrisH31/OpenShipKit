import "server-only";

//
// Teams (OPENSHIPKIT_TENANCY=org): the one write path for organisations,
// memberships and invitations. Pages, server actions and MCP tools call these.
//
// Every write:
//  1. refuses when teams are off (assertTeams) and for the read-only demo admin;
//  2. checks the caller's role in that organisation against the permission map
//     (can(), canManage() in src/core/orgs.ts). Not being a member is "not found",
//     so an outsider can't tell an organisation exists;
//  3. keeps at least one owner (the last owner can't be demoted, removed or
//     leave; they transfer ownership or delete the organisation);
//  4. audits, with the organisation's id in the entity id.
//
// Invitations: the link carries a random token; only its SHA-256 is stored.
// It works once, for INVITATION_TTL_DAYS, and only for a signed-in account
// with the invited email address. Inviting the same address again replaces
// the open invitation (a resend).
//
// Seats (Phase 2.4) aren't checked here yet: billing for organisations comes next.
//

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DataError } from "@/core/data";
import {
  INVITATION_TTL_DAYS,
  ORG_NAME_MAX,
  SLUG_MAX,
  SLUG_RE,
  can,
  canManage,
  invitationState,
  orgSlug,
  type Org,
  type OrgAction,
  type OrgInvitation,
  type OrgMember,
  type OrgRole,
} from "@/core/orgs";
import { emailSchema } from "@/core/schemas";
import type { Actor, User } from "@/core/types";
import { getData } from "../data";
import { assertNotDemo } from "../demo";
import { sendEmail } from "../email";
import { orgInvitationTemplate } from "../email-templates";
import { siteUrl, tenancy } from "../env";
import { log } from "../log";
import { recordAudit } from "./audit";
import { ServiceError, fromDataError, parseInput } from "./errors";

export function teamsEnabled(): boolean {
  return tenancy() === "org";
}

/** Every team write and read starts here: with teams off, organisations don't exist. */
export function assertTeams(): void {
  if (!teamsEnabled()) throw new ServiceError("not_found", "Teams are off on this site (OPENSHIPKIT_TENANCY=org turns them on).");
}

const actorOf = (user: User): Actor => ({ type: "user", id: user.id, label: user.email });

/** Run a store write, turning its DataErrors into ServiceErrors. */
async function store<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DataError) fromDataError(error);
    throw error;
  }
}

export type OrgAccess = { org: Org; role: OrgRole };

/** The caller's place in an organisation, or "not found" when they have none (an outsider learns nothing). */
export async function orgAccess(user: User, orgId: string): Promise<OrgAccess> {
  assertTeams();
  const data = await getData();
  const [org, member] = await Promise.all([data.orgs.get(orgId), data.orgs.getMember(orgId, user.id)]);
  if (!org || !member) throw new ServiceError("not_found", "No such organisation.");
  return { org, role: member.role };
}

/** orgAccess, then the permission map: "forbidden" with the role it takes. */
export async function requireOrgPermission(user: User, orgId: string, action: OrgAction): Promise<OrgAccess> {
  const access = await orgAccess(user, orgId);
  if (!can(access.role, action)) throw new ServiceError("forbidden", `Your role (${access.role}) can't do that here.`);
  return access;
}

export async function listMyOrgs(user: User): Promise<OrgAccess[]> {
  assertTeams();
  return (await getData()).orgs.listForUser(user.id);
}

// ---------------------------------------------------------------- organisations

const nameSchema = z.string().trim().min(1, "Give it a name.").max(ORG_NAME_MAX, `Use ${ORG_NAME_MAX} characters or fewer.`);
const slugSchema = z.string().trim().toLowerCase().max(SLUG_MAX).regex(SLUG_RE, "Use lower-case letters, digits and single hyphens.");

/** A free slug from `base`: base, base-2, base-3 … */
async function freeSlug(base: string): Promise<string> {
  const data = await getData();
  const root = base || "team";
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? root : `${root.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!(await data.orgs.getBySlug(candidate))) return candidate;
  }
  return `${root.slice(0, SLUG_MAX - 9)}-${randomBytes(4).toString("hex")}`;
}

export async function createOrg(user: User, input: { name: string; slug?: string }): Promise<Org> {
  assertNotDemo(user);
  assertTeams();
  const name = parseInput(nameSchema, input.name);
  const slug = input.slug ? parseInput(slugSchema, input.slug) : await freeSlug(orgSlug(name));
  const org = await store(() => getData().then((d) => d.orgs.create({ name, slug, ownerId: user.id })));
  await recordAudit(actorOf(user), "org.create", "org", org.id, null, org);
  return org;
}

export async function updateOrg(user: User, orgId: string, input: { name?: string; slug?: string }): Promise<Org> {
  assertNotDemo(user);
  const { org: before } = await requireOrgPermission(user, orgId, "org.rename");
  const patch = {
    ...(input.name !== undefined ? { name: parseInput(nameSchema, input.name) } : {}),
    ...(input.slug !== undefined ? { slug: parseInput(slugSchema, input.slug) } : {}),
  };
  const after = await store(() => getData().then((d) => d.orgs.update(orgId, patch)));
  await recordAudit(actorOf(user), "org.update", "org", orgId, before, after);
  return after;
}

export async function deleteOrg(user: User, orgId: string): Promise<void> {
  assertNotDemo(user);
  const { org } = await requireOrgPermission(user, orgId, "org.delete");
  await (await getData()).orgs.delete(orgId);
  await recordAudit(actorOf(user), "org.delete", "org", orgId, org, null);
}

// ---------------------------------------------------------------- members

async function ownersOf(orgId: string): Promise<OrgMember[]> {
  return (await (await getData()).orgs.listMembers(orgId)).filter((m) => m.role === "owner");
}

async function targetMember(orgId: string, userId: string): Promise<OrgMember> {
  const m = await (await getData()).orgs.getMember(orgId, userId);
  if (!m) throw new ServiceError("not_found", "That person isn't a member.");
  return m;
}

export async function listMembers(user: User, orgId: string): Promise<OrgMember[]> {
  await requireOrgPermission(user, orgId, "members.view");
  return (await getData()).orgs.listMembers(orgId);
}

export async function setMemberRole(user: User, orgId: string, targetUserId: string, role: OrgRole): Promise<OrgMember> {
  assertNotDemo(user);
  const { role: mine } = await requireOrgPermission(user, orgId, "members.setRole");
  if (targetUserId === user.id) throw new ServiceError("conflict", "You can't change your own role. Ask another owner, or transfer ownership.");
  const target = await targetMember(orgId, targetUserId);
  if (!canManage(mine, target.role, role)) throw new ServiceError("forbidden", `Your role (${mine}) can't make a ${target.role} ${role === "admin" ? "an admin" : `a ${role}`}.`);
  if (target.role === role) return target;
  const after = await store(() => getData().then((d) => d.orgs.setMemberRole(orgId, targetUserId, role)));
  await recordAudit(actorOf(user), "org.member.role", "org", orgId, { userId: targetUserId, role: target.role }, { userId: targetUserId, role });
  return after;
}

export async function removeMember(user: User, orgId: string, targetUserId: string): Promise<void> {
  assertNotDemo(user);
  if (targetUserId === user.id) throw new ServiceError("conflict", "To remove yourself, leave the organisation.");
  const { role: mine } = await requireOrgPermission(user, orgId, "members.remove");
  const target = await targetMember(orgId, targetUserId);
  if (!canManage(mine, target.role)) throw new ServiceError("forbidden", `Your role (${mine}) can't remove a ${target.role}.`);
  await (await getData()).orgs.removeMember(orgId, targetUserId);
  await recordAudit(actorOf(user), "org.member.remove", "org", orgId, { userId: targetUserId, role: target.role }, null);
}

export async function leaveOrg(user: User, orgId: string): Promise<void> {
  assertNotDemo(user);
  const { role } = await requireOrgPermission(user, orgId, "org.leave");
  if (role === "owner" && (await ownersOf(orgId)).length === 1) {
    throw new ServiceError("conflict", "You're the only owner. Transfer ownership to someone first, or delete the organisation.");
  }
  await (await getData()).orgs.removeMember(orgId, user.id);
  await recordAudit(actorOf(user), "org.member.leave", "org", orgId, { userId: user.id, role }, null);
}

/** Makes another member an owner and the caller an admin. */
export async function transferOwnership(user: User, orgId: string, toUserId: string): Promise<void> {
  assertNotDemo(user);
  await requireOrgPermission(user, orgId, "ownership.transfer");
  if (toUserId === user.id) throw new ServiceError("conflict", "You're already an owner.");
  const target = await targetMember(orgId, toUserId);
  const data = await getData();
  await store(() => data.orgs.setMemberRole(orgId, toUserId, "owner"));
  await store(() => data.orgs.setMemberRole(orgId, user.id, "admin"));
  await recordAudit(actorOf(user), "org.ownership.transfer", "org", orgId, { owner: user.id, was: target.role }, { owner: toUserId, previousOwnerNow: "admin" });
}

// ---------------------------------------------------------------- invitations

const inviteSchema = z.strictObject({ email: emailSchema, role: z.enum(["admin", "member"]) });

export const hashInvitationToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function listInvitations(user: User, orgId: string): Promise<OrgInvitation[]> {
  await requireOrgPermission(user, orgId, "members.invite");
  return (await getData()).orgs.listInvitations(orgId);
}

/**
 * Invites an address with a role and emails the link. Returns the invitation
 * and the link (for the person sending it, when email is off in development).
 */
export async function inviteMember(user: User, orgId: string, input: { email: string; role: "admin" | "member" }): Promise<{ invitation: OrgInvitation; url: string }> {
  assertNotDemo(user);
  const { org, role: mine } = await requireOrgPermission(user, orgId, "members.invite");
  const { email, role } = parseInput(inviteSchema, input);
  if (!canManage(mine, role)) throw new ServiceError("forbidden", `Your role (${mine}) can't invite ${role === "admin" ? "an admin" : "a member"}.`);
  const data = await getData();
  if ((await data.orgs.listMembers(orgId)).some((m) => m.email === email)) throw new ServiceError("conflict", `${email} is already a member.`);

  // A second invitation to the same address replaces the first, expired or not: the old link stops working.
  for (const open of await data.orgs.listInvitations(orgId, { all: true })) {
    if (open.email === email && !open.acceptedAt && !open.revokedAt) await data.orgs.revokeInvitation(open.id);
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();
  const invitation = await store(() => data.orgs.createInvitation({ orgId, email, role, tokenHash: hashInvitationToken(token), invitedBy: user.id, expiresAt }));
  const url = `${siteUrl()}/invite/${token}`;
  try {
    await sendEmail({ to: email, ...(await orgInvitationTemplate({ orgName: org.name, inviterName: user.name ?? user.email, role, url, expiresInDays: INVITATION_TTL_DAYS })) });
  } catch (error) {
    // The invitation stands: the inviter can copy the link, or send it again.
    log.warn("orgs", `invitation ${invitation.id} created but its email wasn't sent`, error instanceof Error ? error.message : error);
  }
  await recordAudit(actorOf(user), "org.invite", "org", orgId, null, { invitationId: invitation.id, email, role });
  return { invitation, url };
}

export async function revokeInvitation(user: User, orgId: string, invitationId: string): Promise<void> {
  assertNotDemo(user);
  await requireOrgPermission(user, orgId, "members.invite");
  const data = await getData();
  const inv = await data.orgs.getInvitation(invitationId);
  if (!inv || inv.orgId !== orgId) throw new ServiceError("not_found", "No such invitation.");
  if (!(await data.orgs.revokeInvitation(invitationId))) throw new ServiceError("conflict", "That invitation was already used or revoked.");
  await recordAudit(actorOf(user), "org.invite.revoke", "org", orgId, { invitationId, email: inv.email }, null);
}

export type InvitationPreview = {
  state: ReturnType<typeof invitationState>;
  orgName: string;
  email: string;
  role: "admin" | "member";
  inviterName: string | null;
};

/** What the /invite page shows. Null for a token that matches nothing. */
export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  assertTeams();
  const data = await getData();
  const inv = await data.orgs.findInvitationByTokenHash(hashInvitationToken(token));
  if (!inv) return null;
  const org = await data.orgs.get(inv.orgId);
  if (!org) return null;
  const inviter = inv.invitedBy ? await data.users.getById(inv.invitedBy) : null;
  return { state: invitationState(inv), orgName: org.name, email: inv.email, role: inv.role, inviterName: inviter?.name ?? inviter?.email ?? null };
}

/** Joins the organisation an invitation is for. The signed-in account's email must be the invited one. */
export async function acceptInvitation(user: User, token: string): Promise<Org> {
  assertNotDemo(user);
  assertTeams();
  const data = await getData();
  const inv = await data.orgs.findInvitationByTokenHash(hashInvitationToken(token));
  if (!inv) throw new ServiceError("not_found", "That invitation link isn't valid.");
  const state = invitationState(inv);
  if (state !== "pending") throw new ServiceError("conflict", `That invitation was ${state === "expired" ? "sent too long ago and has expired" : state}. Ask for a new one.`);
  if (inv.email !== user.email.toLowerCase()) {
    throw new ServiceError("forbidden", `This invitation is for ${inv.email}. Sign in with that address to accept it.`);
  }
  const result = await store(() => data.orgs.acceptInvitation(inv.id, user.id)).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "conflict") throw new ServiceError("conflict", "You're already a member of this organisation.");
    throw error;
  });
  if (!result) throw new ServiceError("conflict", "That invitation was just used or revoked. Ask for a new one.");
  const org = (await data.orgs.get(inv.orgId))!;
  await recordAudit(actorOf(user), "org.join", "org", org.id, null, { userId: user.id, role: result.member.role, invitationId: inv.id });
  return org;
}

// ---------------------------------------------------------------- account deletion

/**
 * Before an account is deleted (src/server/services/users.ts): refuses while
 * it is the only owner of an organisation that has other members, and
 * returns the organisations it owns alone, which go with it.
 */
export async function orgsBlockingDeletion(userId: string): Promise<{ blocking: Org[]; soleOwned: Org[] }> {
  const data = await getData();
  const blocking: Org[] = [];
  const soleOwned: Org[] = [];
  for (const { org, role } of await data.orgs.listForUser(userId)) {
    if (role !== "owner") continue;
    const members = await data.orgs.listMembers(org.id);
    if (members.length === 1) soleOwned.push(org);
    else if (members.filter((m) => m.role === "owner").length === 1) blocking.push(org);
  }
  return { blocking, soleOwned };
}
