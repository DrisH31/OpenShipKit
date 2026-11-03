import "server-only";

//
// Is this person banned in the app? The one question the auth adapter asks the
// app's own tables (src/adapters/auth/better-auth): before it creates a session
// (sign-in, magic link, social, a session refresh) and in account actions that
// trust its own session alone. A ban lives in users.banned, set through
// setUserBanned() in ./users.ts, which also ends the sessions the person has.
//
// Deliberately tiny and free of src/server/auth: the auth instance imports it,
// so it must not import the auth registry back.
//

import { getData } from "../data";

/** True when the app user with this email is banned. An unknown email (no app row yet) is not banned. */
export async function isBanned(email: string): Promise<boolean> {
  const user = await (await getData()).users.getByEmail(email.trim().toLowerCase());
  return Boolean(user?.banned);
}
