//
// Teams (ROADMAP Phase 2): organisations, their members and invitations, and
// who may do what inside one. Pure data and pure functions: the server reads
// the tenancy and the session (src/server/orgs.ts) and asks can().
//
//   OPENSHIPKIT_TENANCY=personal (default)  no organisations: every account
//                                           stands alone, as before teams existed.
//   OPENSHIPKIT_TENANCY=org                 people belong to organisations and
//                                           invite others in; the organisation
//                                           holds the subscription, per seat.
//
// Roles, highest first: owner > admin > member. These are roles INSIDE one
// organisation; the site's own admin role (users.role) is something else
// and grants nothing inside a customer's organisation.
//
// The permission map below is the one list of what each role may do. A
// service checks it with can() (src/server/services/orgs.ts), and
// tests/orgs-permissions.test.ts checks every role against every action, so a
// change here is a visible decision.
//

export type Tenancy = "personal" | "org";
export const TENANCIES: readonly Tenancy[] = ["personal", "org"];

export type OrgRole = "owner" | "admin" | "member";
export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

const RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

export interface Org {
  id: string;
  name: string;
  /** Lower-case letters, digits and single hyphens; unique across the site. */
  slug: string;
  /** The users.id who created it; null once that account is deleted. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: OrgRole;
  /** The member's account, for lists: email and name as the users table has them. */
  email: string;
  name: string | null;
  joinedAt: string;
}

export interface OrgInvitation {
  id: string;
  orgId: string;
  /** Lower-cased. The invitation can only be accepted by an account with this verified email. */
  email: string;
  /** Never owner: ownership is handed over with transferOwnership, not by invitation. */
  role: Exclude<OrgRole, "owner">;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export function invitationState(inv: Pick<OrgInvitation, "acceptedAt" | "revokedAt" | "expiresAt">, now = Date.now()): InvitationState {
  if (inv.acceptedAt) return "accepted";
  if (inv.revokedAt) return "revoked";
  return Date.parse(inv.expiresAt) <= now ? "expired" : "pending";
}

/** How long an invitation link works. */
export const INVITATION_TTL_DAYS = 7;

/** Everything a member of an organisation might want to do in it. */
export type OrgAction =
  | "org.view"
  | "org.rename"
  | "org.delete"
  | "members.view"
  | "members.invite"
  | "members.remove"
  | "members.setRole"
  | "ownership.transfer"
  | "billing.view"
  | "billing.manage"
  | "org.leave";

/** The least role each action needs. */
export const PERMISSIONS: Readonly<Record<OrgAction, OrgRole>> = {
  "org.view": "member",
  "org.leave": "member",
  "members.view": "member",
  "billing.view": "member",
  "org.rename": "admin",
  "members.invite": "admin",
  "members.remove": "admin",
  "members.setRole": "admin",
  "billing.manage": "owner",
  "org.delete": "owner",
  "ownership.transfer": "owner",
};

export const ORG_ACTIONS = Object.keys(PERMISSIONS) as OrgAction[];

/** Whether `role` may do `action`. */
export function can(role: OrgRole, action: OrgAction): boolean {
  return RANK[role] >= RANK[PERMISSIONS[action]];
}

/**
 * Whether `actor` may change `target`'s membership (remove them, or give them
 * `newRole`), or, with target = the role on offer, invite someone with it.
 * Admins manage members only, and only as members: making an admin is an
 * owner's call, so admin rights don't spread without one. Owners manage
 * admins and members. Nobody gets "owner" this way: ownership moves with
 * transferOwnership.
 */
export function canManage(actor: OrgRole, target: OrgRole, newRole?: OrgRole): boolean {
  if (newRole === "owner") return false;
  if (actor === "owner") return target !== "owner";
  if (actor === "admin") return target === "member" && (newRole === undefined || newRole === "member");
  return false;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 48;
export const ORG_NAME_MAX = 80;

/** A slug from a name: "Acme, Inc." → "acme-inc". Empty when the name has no letters or digits. */
export function orgSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}
