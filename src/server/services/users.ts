import "server-only";

//
// The app's users. Roles and bans live here, in the app's own table, not in Better Auth.
//
// Invariant 7: the site always keeps at least one USABLE admin — an admin who
// isn't banned. Demoting, banning or deleting the last one is refused. Role and
// ban changes run one at a time in this process and are re-checked after the
// write, so two admins demoting each other at once can't both succeed.
//
// A ban also ends the person's auth sessions (AuthAdapter.revokeSessions), and
// the auth adapter refuses them new ones (isBanned in ./bans.ts). Deleting an
// account is refused while a paid subscription would keep renewing for a user
// who no longer exists.
//
// Demoting, banning or deleting a person also revokes every MCP agent key they
// minted (revokeKeysMintedBy), so their admin access can't outlive them there.
//

import { PROVIDER_LABEL } from "@/core/billing";
import { MAX_LIMIT } from "@/core/data";
import { grantsAccess, isRenewing, type Actor, type Page, type Role, type User } from "@/core/types";
import { getAuth } from "../auth";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { adminEmails } from "../env";
import { revokeKeysMintedBy } from "./agent-keys";
import { recordAudit } from "./audit";
import { getEntitlement } from "./billing";
import { ServiceError } from "./errors";
import { log } from "@/server/log";
import { orgsBlockingDeletion } from "./orgs";

export async function listUsers(query: { search?: string; role?: Role; limit?: number; cursor?: string | null }): Promise<Page<User>> {
  return (await getData()).users.list(query);
}

/**
 * Email by users.id for many people in one read — an audit list naming the
 * people its entries were about. Unknown (deleted) ids are simply absent, so
 * the caller falls back to whatever the entry itself recorded.
 */
export async function emailsByUserId(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const users = await (await getData()).users.getManyByIds(unique);
  return Object.fromEntries(users.map((u) => [u.id, u.email]));
}

/** One user with what they pay for — the admin's user page and the MCP user_get tool. */
export async function getUserDetail(idOrEmail: string) {
  const data = await getData();
  const user = idOrEmail.includes("@") ? await data.users.getByEmail(idOrEmail.toLowerCase()) : await data.users.getById(idOrEmail);
  if (!user) throw new ServiceError("not_found", `No user ${idOrEmail}`);
  const [entitlement, subscriptions, purchases, feedback] = await Promise.all([
    getEntitlement(user.id),
    data.billing.listSubscriptions({ userId: user.id, limit: 20 }),
    data.billing.listPurchases({ userId: user.id, limit: 20 }),
    data.feedback.list({ userId: user.id, limit: 20 }),
  ]);
  return { user, entitlement, subscriptions: subscriptions.items, purchases: purchases.items, feedback: feedback.items };
}

async function requireUserRow(id: string): Promise<User> {
  const user = await (await getData()).users.getById(id);
  if (!user) throw new ServiceError("not_found", `No user ${id}`);
  return user;
}

/** True when an admin who isn't banned exists, other than `exceptId`. */
async function hasUsableAdmin(exceptId?: string): Promise<boolean> {
  const users = (await getData()).users;
  let cursor: string | null = null;
  do {
    const page: Page<User> = await users.list({ role: "admin", limit: MAX_LIMIT, cursor });
    if (page.items.some((u) => !u.banned && u.id !== exceptId)) return true;
    cursor = page.nextCursor;
  } while (cursor);
  return false;
}

/** Refuse a change that would take away the last usable admin. A banned or non-admin target never counts. */
async function assertNotLastAdmin(user: User): Promise<void> {
  if (user.role !== "admin" || user.banned) return;
  if (!(await hasUsableAdmin(user.id))) {
    throw new ServiceError("forbidden", "This is the only admin who can sign in; promote someone else (or unban an admin) first");
  }
}

// Role and ban changes, one at a time (a single self-hosted process is the default).
let adminChanges: Promise<unknown> = Promise.resolve();
function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const run = adminChanges.then(fn, fn);
  adminChanges = run.catch(() => {});
  return run;
}

/** After a write: if no usable admin is left (a race with another instance), put the row back and refuse. */
async function undoIfNoAdminLeft(before: User): Promise<void> {
  if (before.role !== "admin" || before.banned || (await hasUsableAdmin())) return;
  await (await getData()).users.update(before.id, { role: before.role, banned: before.banned });
  throw new ServiceError("forbidden", "This is the only admin who can sign in; promote someone else (or unban an admin) first");
}

export async function setUserRole(id: string, role: Role, actor: Actor): Promise<User> {
  assertNotDemo(actor);
  return serialised(async () => {
    const before = await requireUserRow(id);
    if (before.role === role) return before;
    if (role === "user") {
      if (adminEmails().includes(before.email.toLowerCase())) {
        throw new ServiceError(
          "conflict",
          `${before.email} is in ADMIN_EMAILS, which makes it an admin again on the next request. Remove it from ADMIN_EMAILS (and restart) first.`,
        );
      }
      await assertNotLastAdmin(before);
    }
    const user = await (await getData()).users.update(id, { role });
    await undoIfNoAdminLeft(before);
    await recordAudit(actor, "user.role", "user", id, { role: before.role }, { role });
    if (role === "user") await revokeKeysMintedBy(id, actor, "demoted");
    return user;
  });
}

export async function setUserBanned(id: string, banned: boolean, actor: Actor): Promise<User> {
  assertNotDemo(actor);
  const user = await serialised(async () => {
    const before = await requireUserRow(id);
    if (actor.type === "user" && actor.id === id) throw new ServiceError("forbidden", "You can't ban yourself");
    if (before.banned === banned) return before;
    if (banned) await assertNotLastAdmin(before);
    const updated = await (await getData()).users.update(id, { banned });
    if (banned) await undoIfNoAdminLeft(before);
    await recordAudit(actor, banned ? "user.ban" : "user.unban", "user", id, { banned: before.banned }, { banned });
    if (banned) await revokeKeysMintedBy(id, actor, "banned");
    return updated;
  });
  if (banned) await endSessions(user);
  return user;
}

/** Sign a banned person out everywhere. The ban already closes the app; this closes the auth endpoints too. */
async function endSessions(user: User): Promise<void> {
  const auth = await getAuth();
  if (!auth.revokeSessions || user.authProvider !== auth.id) return;
  try {
    await auth.revokeSessions(user.authProviderUserId);
  } catch (error) {
    // The ban stands either way: getCurrentUser() refuses a banned user on every request.
    log.error("users", `banned ${user.id}, but revoking their sessions failed`, error);
  }
}

/**
 * A signed-in person's own profile (dashboard settings). The app's row is the
 * one source of the name: getCurrentUser() never fills it back in from the
 * identity (src/server/session.ts), so a cleared or edited name sticks. When
 * the auth adapter can (AuthAdapter.updateProfile) the name is written to the
 * provider first too, so the emails it sends greet the new name.
 */
export async function updateOwnProfile(user: User, patch: { name?: string | null }): Promise<User> {
  assertNotDemo(user);
  const name = patch.name === undefined ? user.name : patch.name?.trim().slice(0, 80) || null;
  const auth = await getAuth();
  if (auth.updateProfile && user.authProvider === auth.id) {
    try {
      await auth.updateProfile(user.authProviderUserId, { name });
    } catch (error) {
      log.error("users", `updating the auth provider's name for ${user.id} failed`, error);
      throw new ServiceError("unavailable", "Your name couldn’t be saved just now. Try again in a moment.");
    }
  }
  const updated = await (await getData()).users.update(user.id, { name });
  await recordAudit({ type: "user", id: user.id, label: user.email }, "user.profile", "user", user.id, { name: user.name }, { name });
  return updated;
}

/** A subscription the provider will keep charging: not canceled, and not set to end at the period end. */

async function assertNothingRenews(user: User, self: boolean): Promise<void> {
  const subs = await (await getData()).billing.listSubscriptions({ userId: user.id, limit: 50 });
  // An organisation's subscription the person paid for, still running out its paid period: deleting
  // the account would delete that row (subscriptions.user_id cascades) and cut the team off early.
  const now = Date.now();
  const data = await getData();
  let teamTime: (typeof subs.items)[number] | undefined;
  for (const s of subs.items) {
    // Only a team that still exists can be cut off: a deleted team's subscription grants nothing anyway.
    if (s.orgId !== null && s.cancelAtPeriodEnd && s.planKey !== null && grantsAccess(s, now) && (await data.orgs.get(s.orgId))) {
      teamTime = s;
      break;
    }
  }
  if (teamTime) {
    const end = teamTime.currentPeriodEnd?.slice(0, 10) ?? null;
    throw new ServiceError(
      "conflict",
      self
        ? `You paid for an organisation's plan that is still running${end ? ` until ${end}` : ""}. Deleting your account now would cut the team off early; try again once it ends.`
        : `${user.email} paid for an organisation's plan that is still running${end ? ` until ${end}` : ""}; deleting the account now would end it early for the team. Try again after it ends.`,
    );
  }
  const renewing = subs.items.find(isRenewing);
  if (!renewing) return;
  throw new ServiceError(
    "conflict",
    self
      ? renewing.orgId
        ? "You pay for an organisation's plan that would keep renewing. Cancel it in Billing first (or let it lapse), then delete your account."
        : "You have a paid plan that would keep renewing. Cancel it in Billing first, then delete your account."
      : `${user.email} has a ${renewing.planKey ?? "paid"} subscription${renewing.orgId ? " for an organisation" : ""} that would keep renewing. Cancel it in your ${PROVIDER_LABEL[renewing.provider]} dashboard first, then delete the account.`,
  );
}

/** A signed-in person deleting their own account (dashboard settings → danger zone). */
export async function deleteOwnAccount(user: User): Promise<void> {
  assertNotDemo(user);
  await deleteUser(user.id, { type: "user", id: user.id, label: user.email });
}

/**
 * Delete the app's row and the person's credentials and sessions. Refused for
 * the last usable admin, and while a subscription would keep renewing — the
 * cascade removes the billing rows, but the provider would go on charging.
 */
export async function deleteUser(id: string, actor: Actor): Promise<void> {
  assertNotDemo(actor);
  await serialised(async () => {
    const before = await requireUserRow(id);
    await assertNotLastAdmin(before);
    await assertNothingRenews(before, actor.type === "user" && actor.id === id);
    // An organisation must keep an owner: refuse while this is the only one of a team with others in it.
    const { blocking, renewing, soleOwned } = await orgsBlockingDeletion(id);
    const names = (orgs: { name: string }[]) => orgs.map((o) => `“${o.name}”`).join(", ");
    if (blocking.length > 0) {
      throw new ServiceError("conflict", `${before.email} is the only owner of ${names(blocking)}. Transfer ownership first, so the team keeps someone in charge.`);
    }
    if (renewing.length > 0) {
      throw new ServiceError("conflict", `${names(renewing)} would be deleted with the account, but has a subscription that would keep renewing. Cancel it in Billing first.`);
    }
    const auth = await getAuth();
    // Before the row goes: deleting the user clears agent_keys.created_by.
    await revokeKeysMintedBy(id, actor, "deleted");
    if (auth.deleteIdentity && before.authProvider === auth.id) await auth.deleteIdentity(before.authProviderUserId);
    // Organisations they own alone go with them.
    for (const org of soleOwned) {
      await (await getData()).orgs.delete(org.id);
      await recordAudit(actor, "org.delete", "org", org.id, org, null);
    }
    await (await getData()).users.delete(id);
    await recordAudit(actor, "user.delete", "user", id, before, null);
  });
}
