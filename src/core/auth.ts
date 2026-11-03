//
// The auth contract. OpenShipKit's auth is Better Auth, self-hosted in your own
// Postgres (src/adapters/auth/better-auth): email + password, verification,
// password reset, magic links, two-factor, optional GitHub/Google sign-in.
//
// The adapter only answers "who is signed in" (an Identity). The app's own
// `User` — role, ban, billing — lives in the DataStore and is resolved by
// src/server/session.ts, so admin rights live in your tables, not in a library.
//
// The adapter folder's shape (src/server/auth.ts and src/proxy.ts import it):
//
//   server.ts   export const adapter: AuthAdapter            (server-only)
//   ui.tsx      export const ui: AuthUI                      (server module; may render client components)
//   proxy.ts    export const proxy: AuthProxy                (runs in src/proxy.ts, Node runtime)
//   route.ts    export const handler: AuthRouteHandler       (mounted at /api/auth/[...auth])
//

import type { ComponentType } from "react";
import type { NextFetchEvent, NextRequest } from "next/server";
import type { AuthProviderId, Identity } from "./types";

export interface AuthAdapter {
  readonly id: AuthProviderId;
  /**
   * Who is signed in for the current request, or null. Reads cookies/headers itself.
   * `fresh: true` skips any session cookie cache and asks the session store, for
   * the moments a stale answer would do harm (creating the app's user row).
   */
  getIdentity(opts?: { fresh?: boolean }): Promise<Identity | null>;
  /** Remove the person's credentials and sessions too, when their user is deleted. */
  deleteIdentity?(providerUserId: string): Promise<void>;
  /**
   * End every session the person has (a ban), so the provider's own endpoints
   * stop working for them too. The adapter must also refuse NEW sessions for a
   * banned person: ask isBanned() (src/server/services/bans.ts) before one is
   * created, and in any action that trusts the provider's session alone.
   */
  revokeSessions?(providerUserId: string): Promise<void>;
  /**
   * Write a profile edit made in the app's settings to the provider's own user
   * too (`name: null` clears it), and refresh any session cookie cache. The
   * app's users.name is the source the app shows (src/server/session.ts copies
   * the identity's name only when the row is created); this keeps the
   * provider's copy — what its sign-in, reset and magic-link emails greet with —
   * in step with it.
   */
  updateProfile?(providerUserId: string, patch: { name: string | null }): Promise<void>;
  /**
   * The read-only demo admin (src/server/demo-account.ts): make sure a
   * verified email + password identity exists at `email` with `password` and
   * nothing that would block a password sign-in (two-factor). `ownerId` is the
   * identity the app recorded as the demo's, or null: an identity at that
   * address with any other id belongs to someone else and is left untouched
   * ("taken"). Never changes another identity.
   */
  ensurePasswordIdentity?(input: { email: string; password: string; name: string; ownerId: string | null }): Promise<EnsureIdentityResult>;
  /**
   * Sign this request's browser in with an email and password — "Try the
   * demo" (POST /api/demo) — for at most `sessionSeconds`, as a browser
   * session that activity never extends. A session the browser already holds
   * is signed out first. Sets the cookies on the response; throws when the
   * provider refuses.
   */
  signInWithPassword?(input: { email: string; password: string; sessionSeconds: number }): Promise<void>;
  /** Paths (or absolute URLs) the UI links to. */
  readonly urls: {
    signIn: string;
    signUp: string;
    /** Where "Manage account" goes (the app's settings page). */
    account: string;
  };
}

export type EnsureIdentityResult =
  | { status: "created" | "updated" | "unchanged"; identity: Identity }
  | { status: "taken"; providerUserId: string };

export interface SignInProps {
  /** A same-origin path to return to after signing in. Already validated. */
  redirectTo: string;
  /** A message to show above the form, such as BANNED_MESSAGE when requireUser() sent a banned person here. */
  notice?: string;
}

export interface AuthUI {
  /** /sign-in (src/app/(auth)/sign-in) */
  SignIn: ComponentType<SignInProps>;
  /** /sign-up (src/app/(auth)/sign-up) */
  SignUp: ComponentType<SignInProps>;
  /** A button/form that signs the person out and returns to "/". */
  SignOutButton: ComponentType<{ className?: string }>;
  /**
   * Extra auth pages the adapter owns under /auth/<name> (forgot-password,
   * reset-password, verify-email …), rendered by src/app/(auth)/auth/[page].
   */
  pages?: Record<string, ComponentType<{ searchParams: Record<string, string | undefined> }>>;
}

export type AuthProxy = (request: NextRequest, event: NextFetchEvent) => Promise<Response | undefined | void>;

export interface AuthRouteHandler {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}

/** Paths that need a signed-in person. The proxy redirects optimistically; pages still call requireUser(). */
export const PROTECTED_PREFIXES = ["/dashboard", "/admin"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The reason (?error=banned) requireUser() adds when it sends a banned person to sign-in. */
export const BANNED_ERROR = "banned";

/**
 * What a banned person is told: on the sign-in page after requireUser() sent
 * them there, and when the adapter refuses them a new session.
 */
export const BANNED_MESSAGE = "This account is suspended. If you think that’s a mistake, contact the site’s team.";

/** The sign-in page's notice for its ?error= value, or undefined for none (or one it doesn't know). */
export function signInNotice(error: string | string[] | null | undefined): string | undefined {
  return error === BANNED_ERROR ? BANNED_MESSAGE : undefined;
}

// A base no real request uses: only a target that stays on it is same-origin.
const PROBE_ORIGIN = "http://openshipkit.invalid";

/**
 * Only same-origin relative paths are accepted as a post-sign-in destination.
 * Mirrors Better Auth's own check: browsers strip tab, CR and LF from URLs and
 * read "\" as "/", so "/<tab>/evil.example" and "/\evil.example" would leave the
 * site. Anything with a control character or a backslash is refused, then the
 * path is resolved and must stay on the origin. Returns the normalised path.
 */
export function safeRedirect(target: string | null | undefined, fallback = "/dashboard"): string {
  if (!target || typeof target !== "string") return fallback;
  if (/[\u0000-\u001F\u007F\\]/.test(target)) return fallback;
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(target, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // "/..//evil.example" resolves to the path "//evil.example": protocol-relative once echoed back.
  if (path.startsWith("//")) return fallback;
  return path;
}
