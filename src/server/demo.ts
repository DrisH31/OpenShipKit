import "server-only";

//
// The read-only demo admin, server side: who it is, and the one guard every
// write takes. (The words live in src/core/demo.ts; what it may see of other
// people in src/shared/privacy-mask.ts; how the account is made and signed
// into in ./demo-account.ts.)
//
// The guard is enforced in depth:
//   1. every write service calls assertNotDemo(actor | user) FIRST, before it
//      reads or writes the DataStore (tests/demo.test.ts fails for an exported
//      service that takes an Actor or a User without calling it);
//   2. the route handlers that write outside a service answer it themselves
//      (/api/admin/media, /admin/subscribers/export, billing);
//   3. Better Auth refuses the demo account every credential change
//      (src/adapters/auth/better-auth/instance.ts → demo hook), so one visitor
//      can't change the password, add two-factor or end everyone's sessions.
//
// Who counts as the demo: the address in DEMO_ADMIN_EMAIL, whatever account
// holds it. A stranger's account at that address would be read-only and
// masked too — the safe direction — and ensureDemoAccount() refuses to make
// such an account an admin.
//

import { DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import type { Actor, User } from "@/core/types";
import { NO_MASK, type PrivacyLens } from "@/shared/privacy-mask";
import { demoAdminLogin } from "./env";
import { ServiceError } from "./services/errors";

/** The demo admin's address (lower case), or null when the demo is off. */
export function demoEmail(): string | null {
  return demoAdminLogin()?.email ?? null;
}

/** Is the read-only demo admin configured (both variables set and valid)? */
export function demoEnabled(): boolean {
  return demoEmail() !== null;
}

export function isDemoEmail(email: string | null | undefined): boolean {
  const demo = demoEmail();
  return demo !== null && typeof email === "string" && email.trim().toLowerCase() === demo;
}

/** Is this signed-in person the read-only demo account? */
export function isDemoUser(user: Pick<User, "email"> | null | undefined): boolean {
  return Boolean(user) && isDemoEmail(user?.email);
}

/**
 * Is this actor the demo account? actorFor() marks it (`readOnly`); an actor
 * built by hand from the person's email (updateOwnProfile) is recognised by
 * its label, so neither way slips past.
 */
export function isDemoActor(actor: Actor | null | undefined): boolean {
  if (!actor) return false;
  if (actor.readOnly) return true;
  return actor.type === "user" && isDemoEmail(actor.label);
}

function isActor(who: Actor | User): who is Actor {
  return "type" in who && "label" in who;
}

/**
 * The guard: throws ServiceError("forbidden", DEMO_READ_ONLY_MESSAGE) for the
 * demo account, whether given the actor of a write or the signed-in user.
 * Call it first, before the service touches the DataStore.
 */
export function assertNotDemo(who: Actor | User | null | undefined): void {
  if (!who) return;
  const demo = isActor(who) ? isDemoActor(who) : isDemoUser(who);
  if (demo) throw new ServiceError("forbidden", DEMO_READ_ONLY_MESSAGE);
}

/** What this viewer may see of other people (src/shared/privacy-mask.ts): masked for the demo, everything for anyone else. */
export function privacyLens(viewer: Pick<User, "email"> | null | undefined): PrivacyLens {
  if (!viewer || !isDemoUser(viewer)) return NO_MASK;
  return { masking: true, selfEmail: viewer.email.trim().toLowerCase() };
}
