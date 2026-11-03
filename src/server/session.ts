import "server-only";

//
// Who is signed in, as the app's own User — the only way pages, route
// handlers and server actions should ask.
//
//   getCurrentUser()  → User | null     (cached per request)
//   requireUser(path) → User            (redirects to sign-in, returning to `path`;
//                                         a banned person lands there with ?error=banned)
//   requireAdmin()    → User            (404s for everyone else — /admin does not admit it exists)
//
// The proxy (src/proxy.ts) only redirects optimistically; THESE are the real
// checks. Never trust the proxy alone (CVE-2025-29927).
//
// Reading is cheap: the app's row is looked up with a plain SELECT and returned
// as is. It is written (upsertFromIdentity) only when something changed — a new
// person, a new email or picture, an ADMIN_EMAILS promotion — or when
// lastSeenAt is more than LAST_SEEN_REFRESH_MS old.
//
// users.name is the one source of the person's name. It is copied from the
// identity once, when the row is created; after that only settings
// (updateOwnProfile) change it, so a name cleared or edited there sticks even
// while the auth provider still reports the sign-up name. A row is never CREATED from
// a cached session: the identity is re-read from the session store first, so a
// person deleted a moment ago on another device can't come back as a ghost row.
//
// A banned person gets no User: requireUser() sends them to sign-in with
// ?error=banned (the page shows BANNED_MESSAGE), and any session they still
// hold is ended, so they can't bounce between sign-in and the dashboard.
//
// ADMIN_EMAILS promotes only an address its owner has verified (in production;
// the zero-config development demo signs up unverified). Each promotion and
// each new row is written to the audit log.
//

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { BANNED_ERROR, type AuthAdapter } from "@/core/auth";
import type { Actor, Identity, User } from "@/core/types";
import { getAuth } from "./auth";
import { getData } from "./data";
import { adminEmails, isProduction } from "./env";
import { isDemoUser } from "./demo";
import { recordAudit } from "./services/audit";
import { log } from "@/server/log";

/** How stale users.lastSeenAt may get before a request refreshes it. */
export const LAST_SEEN_REFRESH_MS = 5 * 60_000;

const SIGN_IN_ACTOR: Actor = { type: "system", id: null, label: "sign-in" };

/** Does ADMIN_EMAILS make this identity an admin? Only a verified address, outside development. */
export function promotesToAdmin(identity: Identity): boolean {
  if (!adminEmails().includes(identity.email.toLowerCase())) return false;
  return identity.emailVerified || !isProduction();
}

/** True when the stored row already says everything the identity would write, and lastSeenAt is fresh. */
function upToDate(user: User, identity: Identity, makeAdmin: boolean, now: number): boolean {
  return (
    user.authProvider === identity.provider &&
    user.authProviderUserId === identity.providerUserId &&
    user.email === identity.email.toLowerCase() &&
    (identity.image === null || identity.image === user.image) &&
    (!makeAdmin || user.role === "admin") &&
    user.lastSeenAt !== null &&
    now - Date.parse(user.lastSeenAt) < LAST_SEEN_REFRESH_MS
  );
}

const resolveUser = cache(async (): Promise<{ user: User | null; banned: boolean }> => {
  const auth = await getAuth();
  let identity = await auth.getIdentity();
  if (!identity) return { user: null, banned: false };
  const data = await getData();
  const existing = await data.users.getByEmail(identity.email.toLowerCase());
  let makeAdmin = promotesToAdmin(identity);

  let user: User;
  if (existing && upToDate(existing, identity, makeAdmin, Date.now())) {
    user = existing;
  } else {
    if (!existing) {
      // About to create a row: ask the session store, not the cookie cache.
      identity = await auth.getIdentity({ fresh: true });
      if (!identity) return { user: null, banned: false };
      makeAdmin = promotesToAdmin(identity);
    }
    // An existing row keeps its own name (see the header): the store fills an
    // empty name from the identity, so it is given none to fill with.
    user = await data.users.upsertFromIdentity(existing ? { ...identity, name: null } : identity, { makeAdmin });
    if (!existing && Date.now() - Date.parse(user.createdAt) < 60_000) {
      await recordAudit(SIGN_IN_ACTOR, "user.create", "user", user.id, null, { email: user.email, role: user.role });
    } else if (existing && existing.role !== "admin" && user.role === "admin") {
      await recordAudit({ ...SIGN_IN_ACTOR, label: "ADMIN_EMAILS" }, "user.promote", "user", user.id, { role: existing.role }, { role: user.role });
    }
  }
  if (user.banned) {
    await endBannedSessions(auth, user);
    return { user: null, banned: true };
  }
  return { user, banned: false };
});

/**
 * A banned person who still holds a session (the ban's own revocation failed,
 * or `banned` was set straight in the database): end it here, so the auth
 * provider's endpoints close too and sign-in shows the form with the reason.
 */
async function endBannedSessions(auth: AuthAdapter, user: User): Promise<void> {
  if (!auth.revokeSessions || user.authProvider !== auth.id) return;
  try {
    await auth.revokeSessions(user.authProviderUserId);
  } catch (error) {
    log.error("session", `banned user ${user.id} still signed in; revoking their sessions failed`, error);
  }
}

export const getCurrentUser = cache(async (): Promise<User | null> => (await resolveUser()).user);

export async function requireUser(returnTo = "/dashboard"): Promise<User> {
  const { user, banned } = await resolveUser();
  if (!user) {
    const auth = await getAuth();
    const target = auth.urls.signIn;
    const sep = target.includes("?") ? "&" : "?";
    redirect(`${target}${sep}redirect=${encodeURIComponent(returnTo)}${banned ? `&error=${BANNED_ERROR}` : ""}`);
  }
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();
  return user;
}

/** The actor a person's writes are recorded as. The read-only demo admin's carries `readOnly`, which every write service refuses. */
export function actorFor(user: User): Actor {
  return { type: "user", id: user.id, label: user.email, ...(isDemoUser(user) ? { readOnly: true as const } : {}) };
}
