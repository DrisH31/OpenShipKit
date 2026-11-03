import "server-only";

//
// Step-up for server code outside the dashboard: "was this browser signed in
// within FRESH_SIGN_IN_MINUTES?" (src/lib/reauth.ts), and the way to get a
// fresh sign-in that comes back to a given page.
//
// It lives here because the account-security actions
// (src/adapters/auth/better-auth/actions.ts) may be imported only from the
// dashboard folders (SPEC §2). The admin imports these two instead: minting an
// admin-scope agent key needs a fresh sign-in, as deleting an account does —
// otherwise a copied admin cookie could turn itself into a long-lived MCP key.
//
// The sign-in time is the session's createdAt from the auth tables
// (getAccountSecurity), never from the cookie cache.
//

import { getAccountSecurity, signOutAction } from "@/adapters/auth/better-auth/actions";
import { safeRedirect } from "@/core/auth";
import { signedInRecently } from "@/lib/reauth";

/** True when this browser's session comes from a sign-in within FRESH_SIGN_IN_MINUTES. False when signed out. */
export async function hasFreshSignIn(): Promise<boolean> {
  const security = await getAccountSecurity();
  return signedInRecently(security?.sessions.find((s) => s.current)?.createdAt);
}

/**
 * Sign out, then the sign-in page, which brings the person back to `returnTo`
 * (a same-origin path; anything else returns to the dashboard). Never returns.
 */
export async function signInAgainTo(returnTo: string): Promise<never> {
  const form = new FormData();
  form.set("redirectTo", `/sign-in?redirect=${encodeURIComponent(safeRedirect(returnTo))}`);
  await signOutAction(form);
  // signOutAction always redirects (it throws); this line is for the type checker.
  throw new Error("signOutAction returned without redirecting");
}
