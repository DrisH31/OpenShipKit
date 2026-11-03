//
// Step-up for the one action that can't be undone: deleting your own account
// needs a sign-in from the last few minutes, not just a live session. A
// borrowed laptop or a copied cookie keeps a session alive for days; it can't
// produce a fresh sign-in without the password (or the GitHub/Google account,
// or the inbox for a sign-in link), so this covers every way of signing in.
//
// The sign-in time is the session's createdAt, read from the auth tables
// (getAccountSecurity), never from the cookie cache. Refreshing a session
// moves its expiry, not its createdAt.
//

/** How recent the sign-in must be to delete the account. */
export const FRESH_SIGN_IN_MINUTES = 15;

/** True when `signedInAt` (ISO) is within FRESH_SIGN_IN_MINUTES of `now`. */
export function signedInRecently(signedInAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!signedInAt) return false;
  const at = new Date(signedInAt).getTime();
  return Number.isFinite(at) && at <= now + 60_000 && now - at <= FRESH_SIGN_IN_MINUTES * 60_000;
}
