import "server-only";

//
// Better Auth → the app's AuthAdapter. Only answers "who is signed in";
// src/server/session.ts turns that Identity into the app's own User (role, ban).
//
//   getIdentity({ fresh })  fresh: true skips the 60 s signed cookie cache and
//                           asks the session table (session.ts does this before
//                           it creates an app row, so a deleted account can't
//                           come back as a ghost row from a cached cookie).
//   revokeSessions(id)      ends every session the person has (a ban). New
//                           ones are refused by the session-create hook in
//                           ./instance.ts, which asks isBanned().
//   deleteIdentity(id)      removes the auth user, its sessions and accounts.
//   ensurePasswordIdentity / signInWithPassword   the read-only demo admin (./demo.ts).
//

import { headers } from "next/headers";
import type { AuthAdapter } from "@/core/auth";
import type { Identity } from "@/core/types";
import { ensureDemoIdentity, signInDemo } from "./demo";
import { getBetterAuth } from "./instance";

export const adapter: AuthAdapter = {
  id: "better-auth",

  async getIdentity(opts?: { fresh?: boolean }): Promise<Identity | null> {
    const auth = await getBetterAuth();
    const result = await auth.api.getSession({
      headers: await headers(),
      ...(opts?.fresh ? { query: { disableCookieCache: true } } : {}),
    });
    if (!result) return null;
    const { user } = result;
    return {
      provider: "better-auth",
      providerUserId: user.id,
      email: user.email.toLowerCase(),
      name: user.name?.trim() || null,
      image: user.image ?? null,
      emailVerified: Boolean(user.emailVerified),
    };
  },

  /** Removes the auth user with its sessions and linked accounts. */
  async deleteIdentity(providerUserId: string): Promise<void> {
    const auth = await getBetterAuth();
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUser(providerUserId);
  },

  /**
   * Ends every session the person has, on every device. A browser still
   * holding the signed cookie cache is answered from it for up to 60 s by
   * Better Auth's own endpoints; the app itself turns a banned person away on
   * every request (src/server/session.ts) regardless.
   */
  async revokeSessions(providerUserId: string): Promise<void> {
    const auth = await getBetterAuth();
    const ctx = await auth.$context;
    // deleteUserSessions takes the user id (deleteSessions takes tokens).
    await ctx.internalAdapter.deleteUserSessions(providerUserId);
  },

  /** The read-only demo admin's identity (./demo.ts). */
  ensurePasswordIdentity: ensureDemoIdentity,

  /** "Try the demo": sign this browser in for a short, browser-only session (./demo.ts). */
  signInWithPassword: signInDemo,

  urls: { signIn: "/sign-in", signUp: "/sign-up", account: "/dashboard/settings" },
};
