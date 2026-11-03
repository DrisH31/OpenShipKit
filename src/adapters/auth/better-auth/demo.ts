import "server-only";

//
// The read-only demo admin, Better Auth's half (the app's half — the admin
// role, the marker that says which identity is the demo's, when this runs —
// is src/server/demo-account.ts; the rules are src/core/demo.ts).
//
//   ensureDemoIdentity()  a verified email + password user at the address,
//                         through Better Auth's own internal adapter, so the
//                         password hash is Better Auth's and the database
//                         hooks run. Never touches an identity that isn't the
//                         recorded demo one.
//   signInDemo()          auth.api.signInEmail for this request's browser,
//                         rememberMe off (a browser-session cookie that
//                         Better Auth never refreshes), then the session's
//                         expiry pulled in to sessionSeconds.
//

import { headers } from "next/headers";
import type { EnsureIdentityResult } from "@/core/auth";
import type { Identity } from "@/core/types";
import { getBetterAuth } from "./instance";

function identityOf(user: { id: string; email: string; name?: string | null; image?: string | null }): Identity {
  return {
    provider: "better-auth",
    providerUserId: user.id,
    email: user.email.toLowerCase(),
    name: user.name?.trim() || null,
    image: user.image ?? null,
    emailVerified: true,
  };
}

export async function ensureDemoIdentity(input: { email: string; password: string; name: string; ownerId: string | null }): Promise<EnsureIdentityResult> {
  const ctx = await (await getBetterAuth()).$context;
  const internal = ctx.internalAdapter;
  const email = input.email.trim().toLowerCase();
  const found = await internal.findUserByEmail(email);

  if (!found) {
    const user = await internal.createUser({ email, name: input.name, emailVerified: true }, { method: "admin" });
    await internal.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash(input.password) });
    return { status: "created", identity: identityOf(user) };
  }

  const { user } = found;
  if (user.id !== input.ownerId) return { status: "taken", providerUserId: user.id };

  let changed = false;
  const credential = await internal.findCredentialAccount(user.id);
  if (!credential?.password) {
    // Only a missing row is linked; a credential row without a hash is updated below.
    if (!credential) {
      await internal.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash(input.password) });
    } else {
      await internal.updatePassword(user.id, await ctx.password.hash(input.password));
    }
    changed = true;
  } else if (!(await ctx.password.verify({ hash: credential.password, password: input.password }))) {
    // DEMO_ADMIN_PASSWORD was rotated: the env is the source of the password.
    await internal.updatePassword(user.id, await ctx.password.hash(input.password));
    changed = true;
  }
  const twoFactorOn = (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
  if (!user.emailVerified || twoFactorOn) {
    // Verified, so required verification never blocks it; no two-factor, so a password signs it in.
    await internal.updateUser(user.id, { emailVerified: true, ...(twoFactorOn ? { twoFactorEnabled: false } : {}) });
    changed = true;
  }
  return { status: changed ? "updated" : "unchanged", identity: identityOf(user) };
}

export async function signInDemo(input: { email: string; password: string; sessionSeconds: number }): Promise<void> {
  const auth = await getBetterAuth();
  const requestHeaders = await headers();
  if (requestHeaders.get("cookie")) {
    try {
      // End the session this browser holds (someone else's, or an expired demo one) before starting the demo's.
      await auth.api.signOut({ headers: requestHeaders });
    } catch {
      // Nothing to sign out.
    }
  }
  const result = await auth.api.signInEmail({
    body: { email: input.email, password: input.password, rememberMe: false },
    headers: requestHeaders,
  });
  const token = (result as { token?: unknown }).token;
  if (typeof token !== "string" || !token) throw new Error("[auth] the demo sign-in returned no session");
  const ctx = await auth.$context;
  await ctx.internalAdapter.updateSession(token, { expiresAt: new Date(Date.now() + input.sessionSeconds * 1000) });
}
