"use server";

//
// Server actions behind the Better Auth forms — the auth pages AND the
// account-security settings (sessions, password, two-factor) the dashboard
// renders. Forms post straight to these, so everything works with
// JavaScript off; with it on, useActionState keeps the page and shows errors
// inline. Every form action has the signature (state, formData) → AuthFormState.
//
//   - auth.api.* runs in-process. Better Auth's own HTTP rate limiter only sees
//     /api/auth/* requests, so every action here applies its own per-IP limit
//     (same switch: rateLimitEnabled()). The per-ACCOUNT limits (wrong
//     passwords per account, emailed links per address; ./throttle.ts) live in
//     the instance's hooks and email senders, so they hold for these actions
//     and for direct /api/auth calls alike.
//   - nextCookies() (last plugin in ./instance.ts) copies cookies set by
//     auth.api calls (session, two-factor challenge) onto the action's response.
//   - redirect() throws, so it is always called outside try/catch.
//   - Session tokens are bearer credentials: they never leave the server.
//     Sessions are addressed by id; the token is looked up here.
//
// Imports beyond the usual adapter set (src/core, src/content, src/server/env,
// the SDK): src/server/{rate-limit,email,email-templates} and
// src/server/services/content, for per-IP limits and security-notice emails,
// and src/server/services/bans: every account action starts from
// authoritativeSession(), which treats a banned person as signed out.
// The form-state contract comes from src/core/auth-forms.ts, never from a UI
// folder.
//

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeRedirect } from "@/core/auth";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { sendEmail } from "@/server/email";
import { securityNoticeTemplate, type SecurityNoticeKind } from "@/server/email-templates";
import { getContent } from "@/server/services/content";
import { isBanned } from "@/server/services/bans";
import { demoAdminLogin, siteUrl } from "@/server/env";
import { DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import type { AuthFormState, TwoFactorSetup } from "@/core/auth-forms";
import { describeUserAgent } from "./device";
import { ACCOUNT_OVERRIDES, errorCode, messageFor } from "./errors";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  configuredSocialProviders,
  getBetterAuth,
  magicLinkEnabled,
  rateLimitEnabled,
  sessionIsFresh,
  twoFactorAvailable,
} from "./instance";
import { log } from "@/server/log";

const email = z.email("Enter a valid email address.").max(254).transform((e) => e.trim().toLowerCase());
const password = z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`);
/** Six digits from an authenticator app; spaces and dashes people type are ignored. */
const totpCode = z
  .string()
  .transform((c) => c.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."));
/** A backup code as shown ("AbCdE-12345"); the dash and spaces are optional. */
const backupCode = z
  .string()
  .transform((c) => c.trim())
  .pipe(z.string().min(6, "Enter one of your backup codes.").max(64));

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function target(formData: FormData): string {
  return safeRedirect(field(formData, "redirectTo"));
}

/** Where the emailed confirmation link lands: the result page, then on to `next`. */
function verifyCallback(next: string): string {
  return `/auth/verify-email?next=${encodeURIComponent(next)}`;
}

function withRedirect(path: string, next: string): string {
  return `${path}?redirect=${encodeURIComponent(next)}`;
}

async function limited(kind: string, limit: number, windowMs: number): Promise<AuthFormState | null> {
  if (!rateLimitEnabled()) return null;
  const { ok } = rateLimit(`auth:${kind}:${await clientIp()}`, limit, windowMs);
  return ok ? null : { status: "error", message: "Too many attempts. Wait a minute and try again." };
}

function emailError(raw: string): AuthFormState | null {
  const parsed = email.safeParse(raw);
  return parsed.success ? null : { status: "error", fieldErrors: { email: parsed.error.issues[0]?.message }, values: { email: raw } };
}

async function notify(to: string, kind: SecurityNoticeKind, name: string | null | undefined): Promise<void> {
  try {
    await sendEmail({ to, ...(await securityNoticeTemplate({ kind, name, url: `${siteUrl()}/auth/forgot-password` })) });
  } catch (error) {
    log.error("auth", `could not send the ${kind} notice`, error);
  }
}

// ---------------------------------------------------------------- sign-in flows

/** Email + password sign-in. Accounts with two-factor on continue to /auth/two-factor. */
export async function signInAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const rawEmail = field(formData, "email");
  const next = target(formData);
  const invalid = emailError(rawEmail);
  if (invalid) return invalid;
  if (!field(formData, "password")) return { status: "error", fieldErrors: { password: "Enter your password." }, values: { email: rawEmail } };
  const tooMany = await limited("sign-in", 10, 60_000);
  if (tooMany) return { ...tooMany, values: { email: rawEmail } };

  const auth = await getBetterAuth();
  let needsSecondFactor = false;
  try {
    // callbackURL is only used by the confirmation email an unverified account gets.
    const result: unknown = await auth.api.signInEmail({
      body: { email: email.parse(rawEmail), password: field(formData, "password"), rememberMe: true, callbackURL: verifyCallback(next) },
      headers: await headers(),
    });
    needsSecondFactor = typeof result === "object" && result !== null && "twoFactorRedirect" in result && result.twoFactorRedirect === true;
  } catch (error) {
    return { status: "error", message: messageFor(error), values: { email: rawEmail } };
  }
  if (needsSecondFactor) redirect(withRedirect("/auth/two-factor", next));
  redirect(next);
}

/** Create an account. With verification required, ends on "check your inbox" instead of signing in. */
export async function signUpAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = field(formData, "name").trim().slice(0, 80);
  const rawEmail = field(formData, "email");
  const values = { name, email: rawEmail };
  const next = target(formData);

  const fieldErrors: AuthFormState["fieldErrors"] = {};
  const parsedEmail = email.safeParse(rawEmail);
  if (!parsedEmail.success) fieldErrors.email = parsedEmail.error.issues[0]?.message;
  const parsedPassword = password.safeParse(field(formData, "password"));
  if (!parsedPassword.success) fieldErrors.password = parsedPassword.error.issues[0]?.message;
  if (!parsedEmail.success || !parsedPassword.success) return { status: "error", fieldErrors, values };

  const tooMany = await limited("sign-up", 5, 60_000);
  if (tooMany) return { ...tooMany, values };

  const auth = await getBetterAuth();
  let signedIn = false;
  try {
    const result = await auth.api.signUpEmail({
      body: { name, email: parsedEmail.data, password: parsedPassword.data, callbackURL: verifyCallback(next) },
      headers: await headers(),
    });
    signedIn = Boolean(result.token);
  } catch (error) {
    const code = errorCode(error);
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return { status: "error", fieldErrors: { password: messageFor(error) }, values };
    if (code === "INVALID_EMAIL") return { status: "error", fieldErrors: { email: messageFor(error) }, values };
    return { status: "error", message: messageFor(error), values };
  }
  if (!signedIn) {
    // Also the answer for an email that already has an account (its owner gets a note), so nothing is revealed.
    return { status: "sent", message: `We’ve sent a confirmation link to ${parsedEmail.data}. Open it to finish signing up.`, values };
  }
  redirect(next);
}

/** "Continue with GitHub/Google": Better Auth returns the provider's URL; send the browser there. */
export async function socialSignInAction(formData: FormData): Promise<void> {
  const provider = field(formData, "provider");
  const next = target(formData);
  const failed = `${withRedirect("/sign-in", next)}&error=social`;
  if (!configuredSocialProviders().some((p) => p.id === provider)) redirect(withRedirect("/sign-in", next));
  const auth = await getBetterAuth();
  let url: string | undefined;
  try {
    const result = await auth.api.signInSocial({
      body: { provider: provider as "github" | "google", callbackURL: next, errorCallbackURL: failed },
      headers: await headers(),
    });
    url = result.url;
  } catch (error) {
    log.error("auth", "social sign-in could not start", error);
  }
  redirect(url ?? failed);
}

/** Passwordless: email a one-time sign-in link (AUTH_MAGIC_LINK=true). */
export async function magicLinkAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const rawEmail = field(formData, "email");
  if (!magicLinkEnabled()) return { status: "error", message: "Sign-in links aren’t turned on for this site." };
  const invalid = emailError(rawEmail);
  if (invalid) return invalid;
  const tooMany = await limited("magic-link", 3, 5 * 60_000);
  if (tooMany) return { ...tooMany, values: { email: rawEmail } };

  const auth = await getBetterAuth();
  const next = target(formData);
  const address = email.parse(rawEmail);
  try {
    await auth.api.signInMagicLink({
      body: { email: address, callbackURL: next, errorCallbackURL: `${withRedirect("/sign-in", next)}&error=magic-link` },
      headers: await headers(),
    });
  } catch (error) {
    return { status: "error", message: messageFor(error), values: { email: rawEmail } };
  }
  return { status: "sent", message: `If ${address} can sign in here, a link is on its way. It works once, for 10 minutes.`, values: { email: rawEmail } };
}

/** "Forgot password?" — always answers the same way, so it never reveals which emails have accounts. */
export async function forgotPasswordAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const rawEmail = field(formData, "email");
  const invalid = emailError(rawEmail);
  if (invalid) return invalid;
  const tooMany = await limited("forgot-password", 3, 5 * 60_000);
  if (tooMany) return { ...tooMany, values: { email: rawEmail } };

  const auth = await getBetterAuth();
  const address = email.parse(rawEmail);
  try {
    await auth.api.requestPasswordReset({ body: { email: address, redirectTo: "/auth/reset-password" }, headers: await headers() });
  } catch (error) {
    // The per-address limit is counted for every address, so saying so reveals nothing.
    if (errorCode(error) === "TOO_MANY_EMAILS") return { status: "error", message: messageFor(error), values: { email: rawEmail } };
    log.error("auth", "password reset request failed", error);
  }
  return { status: "sent", message: `If an account uses ${address}, we’ve sent it a link to choose a new password. It expires in one hour.`, values: { email: rawEmail } };
}

/** Choose a new password with the token from the emailed link. Signs out every session. */
export async function resetPasswordAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = field(formData, "token");
  if (!token) return { status: "error", message: "This link is missing its token. Ask for a new one." };
  const parsed = password.safeParse(field(formData, "password"));
  if (!parsed.success) return { status: "error", fieldErrors: { password: parsed.error.issues[0]?.message } };
  if (field(formData, "confirm") !== parsed.data) return { status: "error", fieldErrors: { confirm: "The two passwords don’t match." } };
  const tooMany = await limited("reset-password", 10, 5 * 60_000);
  if (tooMany) return tooMany;

  const auth = await getBetterAuth();
  try {
    await auth.api.resetPassword({ body: { newPassword: parsed.data, token }, headers: await headers() });
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
  return { status: "done", message: "Your password is changed. Sign in with the new one." };
}

/** Send another confirmation link. Same answer whether or not the account exists. */
export async function resendVerificationAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const rawEmail = field(formData, "email");
  const invalid = emailError(rawEmail);
  if (invalid) return invalid;
  const tooMany = await limited("verify-email", 3, 5 * 60_000);
  if (tooMany) return { ...tooMany, values: { email: rawEmail } };

  const auth = await getBetterAuth();
  const address = email.parse(rawEmail);
  try {
    await auth.api.sendVerificationEmail({ body: { email: address, callbackURL: verifyCallback(target(formData)) }, headers: await headers() });
  } catch (error) {
    // "Already verified" is useful to hear, and so is the per-address limit
    // (counted for every address alike); anything else stays generic.
    if (errorCode(error) === "EMAIL_ALREADY_VERIFIED") return { status: "done", message: messageFor(error), values: { email: rawEmail } };
    if (errorCode(error) === "TOO_MANY_EMAILS") return { status: "error", message: messageFor(error), values: { email: rawEmail } };
  }
  return { status: "sent", message: `If ${address} has an account waiting for confirmation, a new link is on its way.`, values: { email: rawEmail } };
}

/**
 * The second step of a sign-in with two-factor on: a code from the
 * authenticator app (method "totp", the default) or a backup code
 * (method "backup"). Needs the short-lived challenge cookie the password
 * step set. "Trust this device" (trustDevice=on) skips the code here for 30 days.
 */
export async function verifyTwoFactorAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const next = target(formData);
  const method = field(formData, "method") === "backup" ? "backup" : "totp";
  const parsed = (method === "backup" ? backupCode : totpCode).safeParse(field(formData, "code"));
  if (!parsed.success) return { status: "error", fieldErrors: { code: parsed.error.issues[0]?.message } };
  const tooMany = await limited("two-factor", 10, 5 * 60_000);
  if (tooMany) return tooMany;

  const auth = await getBetterAuth();
  const trustDevice = field(formData, "trustDevice") === "on";
  try {
    const body = { code: parsed.data, trustDevice };
    if (method === "backup") await auth.api.verifyBackupCode({ body, headers: await headers() });
    else await auth.api.verifyTOTP({ body, headers: await headers() });
  } catch (error) {
    return { status: "error", fieldErrors: { code: messageFor(error) } };
  }
  redirect(next);
}

/**
 * Sign out, then home — or to the form's `redirectTo` field (a same-origin path,
 * through safeRedirect; anything else goes home). Called directly, with no
 * form, it goes home too. Never returns: the redirect throws.
 */
export async function signOutAction(formData?: FormData): Promise<void> {
  const auth = await getBetterAuth();
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch (error) {
    log.error("auth", "sign-out failed", error);
  }
  redirect(formData ? safeRedirect(field(formData, "redirectTo"), "/") : "/");
}

// ---------------------------------------------------------------- account security (dashboard settings)

/** One signed-in device, as the settings page lists it. No token: sessions are addressed by id. */
export interface SessionInfo {
  id: string;
  /** This browser. */
  current: boolean;
  /** "Chrome on macOS" — a guess from the user agent. */
  device: string;
  userAgent: string | null;
  ipAddress: string | null;
  /** ISO timestamps. */
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

/** Everything the security settings page needs, in one call. */
export interface AccountSecurity {
  email: string;
  emailVerified: boolean;
  /** Has an email + password login (false for GitHub/Google-only accounts: changePassword then SETS one). */
  hasPassword: boolean;
  /** Linked social providers ("github", "google"). */
  linkedProviders: string[];
  twoFactor: {
    /** The plugin is on (the schema has its table). Hide the section when false. */
    available: boolean;
    enabled: boolean;
  };
  /** Newest first; the current one is marked. */
  sessions: SessionInfo[];
}

type Auth = Awaited<ReturnType<typeof getBetterAuth>>;

/**
 * The signed-in session, read from the database (not the cookie cache) — every
 * account action starts here. A banned person counts as signed out: these
 * actions trust Better Auth's session alone, never requireUser().
 */
async function authoritativeSession(auth: Auth) {
  const session = await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  if (session && (await isBanned(session.user.email))) return null;
  return session;
}

const SIGNED_OUT: AuthFormState = { status: "error", message: "You’re signed out. Sign in again to continue." };

/**
 * The read-only demo admin (src/core/demo.ts) is shared by every visitor, so
 * its password, two-factor and sessions can't change: each account action
 * below starts here and answers with the read-only sentence before anything
 * else. Better Auth's own hook (guardDemoAccount in ./instance.ts) refuses
 * the same calls again, for direct /api/auth requests too.
 */
async function demoRefusal(): Promise<AuthFormState | null> {
  const demo = demoAdminLogin();
  if (!demo) return null;
  const session = await authoritativeSession(await getBetterAuth());
  return session && session.user.email.toLowerCase() === demo.email ? { status: "error", message: DEMO_READ_ONLY_MESSAGE } : null;
}

async function sessionsFor(auth: Auth, userId: string, currentId: string): Promise<SessionInfo[]> {
  // Read through the internal adapter rather than auth.api.listSessions, which
  // refuses sessions older than a day ("not fresh") — listing your own devices
  // shouldn't need a re-login.
  const ctx = await auth.$context;
  const now = Date.now();
  const rows = await ctx.internalAdapter.listSessions(userId);
  return rows
    .filter((s) => new Date(s.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((s) => ({
      id: s.id,
      current: s.id === currentId,
      device: describeUserAgent(s.userAgent),
      userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress ?? null,
      createdAt: new Date(s.createdAt).toISOString(),
      lastActiveAt: new Date(s.updatedAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
    }));
}

/** The signed-in person's active sessions, newest first. Empty when signed out. */
export async function listSessions(): Promise<SessionInfo[]> {
  const auth = await getBetterAuth();
  const session = await authoritativeSession(auth);
  if (!session) return [];
  return sessionsFor(auth, session.user.id, session.session.id);
}

/** Password, linked providers, two-factor state and sessions for the settings page. Null when signed out. */
export async function getAccountSecurity(): Promise<AccountSecurity | null> {
  const auth = await getBetterAuth();
  const session = await authoritativeSession(auth);
  if (!session) return null;
  const ctx = await auth.$context;
  const [accounts, sessions, available] = await Promise.all([
    ctx.internalAdapter.findAccounts(session.user.id),
    sessionsFor(auth, session.user.id, session.session.id),
    twoFactorAvailable(),
  ]);
  const enabled = Boolean((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled);
  return {
    email: session.user.email,
    emailVerified: Boolean(session.user.emailVerified),
    hasPassword: accounts.some((a) => a.providerId === "credential" && Boolean(a.password)),
    linkedProviders: accounts.map((a) => a.providerId).filter((p) => p !== "credential"),
    twoFactor: { available, enabled: available && enabled },
    sessions,
  };
}

/** Sign out one other device. Form field: sessionId. The current session is refused (use sign-out). */
export async function revokeSession(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const demo = await demoRefusal();
  if (demo) return demo;
  const sessionId = field(formData, "sessionId");
  if (!sessionId) return { status: "error", message: "Choose a session to sign out." };
  const auth = await getBetterAuth();
  const session = await authoritativeSession(auth);
  if (!session) return SIGNED_OUT;
  if (sessionId === session.session.id) return { status: "error", message: "That’s this device. Use “Sign out” instead." };

  const ctx = await auth.$context;
  const row = (await ctx.internalAdapter.listSessions(session.user.id)).find((s) => s.id === sessionId);
  // Already gone (expired or signed out elsewhere) is the outcome the person wanted.
  if (!row) return { status: "done", message: "That device is signed out." };
  try {
    await auth.api.revokeSession({ body: { token: row.token }, headers: await headers() });
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
  return { status: "done", message: `${describeUserAgent(row.userAgent)} is signed out.` };
}

/** Sign out every device except this one. No fields; the (state, formData) shape is useActionState's. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function revokeOtherSessions(_state: AuthFormState, _formData: FormData): Promise<AuthFormState> {
  const demo = await demoRefusal();
  if (demo) return demo;
  const auth = await getBetterAuth();
  if (!(await authoritativeSession(auth))) return SIGNED_OUT;
  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
  return { status: "done", message: "Every other device is signed out." };
}

/**
 * Change the password (fields: currentPassword, newPassword, confirm), signing
 * out every other device. An account without a password (GitHub/Google only)
 * SETS one instead, and currentPassword is ignored — so that needs a sign-in
 * from the last few minutes (sessionIsFresh): a copied cookie alone must not
 * be able to add a password login. Emails a security notice.
 */
export async function changePassword(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const demo = await demoRefusal();
  if (demo) return demo;
  const parsed = password.safeParse(field(formData, "newPassword"));
  if (!parsed.success) return { status: "error", fieldErrors: { newPassword: parsed.error.issues[0]?.message } };
  if (field(formData, "confirm") !== parsed.data) return { status: "error", fieldErrors: { confirm: "The two passwords don’t match." } };
  const tooMany = await limited("change-password", 5, 5 * 60_000);
  if (tooMany) return tooMany;

  const auth = await getBetterAuth();
  const session = await authoritativeSession(auth);
  if (!session) return SIGNED_OUT;
  const ctx = await auth.$context;
  const credential = await ctx.internalAdapter.findCredentialAccount(session.user.id);
  const hadPassword = Boolean(credential?.password);
  const currentPassword = field(formData, "currentPassword");
  if (hadPassword && !currentPassword) return { status: "error", fieldErrors: { currentPassword: "Enter your current password." } };
  if (hadPassword && currentPassword === parsed.data) {
    return { status: "error", fieldErrors: { newPassword: "Choose a password different from the current one." } };
  }
  if (!hadPassword && !sessionIsFresh(session.session.createdAt)) {
    return { status: "error", message: "For your security, sign out and sign in again, then set your password." };
  }

  try {
    if (hadPassword) {
      await auth.api.changePassword({ body: { currentPassword, newPassword: parsed.data, revokeOtherSessions: true }, headers: await headers() });
    } else {
      await auth.api.setPassword({ body: { newPassword: parsed.data }, headers: await headers() });
    }
  } catch (error) {
    const code = errorCode(error);
    if (code === "INVALID_PASSWORD" || code === "INVALID_EMAIL_OR_PASSWORD") {
      return { status: "error", fieldErrors: { currentPassword: messageFor(error, ACCOUNT_OVERRIDES) } };
    }
    return { status: "error", message: messageFor(error, ACCOUNT_OVERRIDES) };
  }
  await notify(session.user.email, "password-changed", session.user.name);
  return {
    status: "done",
    message: hadPassword ? "Your password is changed. Other devices were signed out." : "Your password is set. You can now sign in with your email too.",
  };
}

async function issuer(): Promise<string> {
  try {
    return (await getContent("site")).name;
  } catch {
    return "OpenShipKit";
  }
}

function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/**
 * Step 1 of turning on two-factor (field: password). Returns status "pending"
 * with `twoFactorSetup` — the otpauth URI (show as a QR code), the secret
 * (for typing in by hand) and the backup codes (show once). Two-factor is NOT
 * on until confirmTwoFactorSetup accepts a first code. Running it again
 * before confirming starts over with a new secret.
 */
export async function startTwoFactorSetup(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const demo = await demoRefusal();
  if (demo) return demo;
  if (!(await twoFactorAvailable())) return { status: "error", message: "Two-factor sign-in isn’t available on this site yet." };
  const current = field(formData, "password");
  if (!current) return { status: "error", fieldErrors: { password: "Enter your password to continue." } };
  const tooMany = await limited("two-factor-setup", 5, 5 * 60_000);
  if (tooMany) return tooMany;

  const auth = await getBetterAuth();
  if (!(await authoritativeSession(auth))) return SIGNED_OUT;
  let setup: TwoFactorSetup;
  try {
    const result = await auth.api.enableTwoFactor({ body: { password: current, method: "totp", issuer: await issuer() }, headers: await headers() });
    if (result.method !== "totp") return { status: "error", message: messageFor(null) };
    setup = { totpURI: result.totpURI, secret: secretFromUri(result.totpURI), backupCodes: result.backupCodes };
  } catch (error) {
    const code = errorCode(error);
    if (code === "INVALID_PASSWORD") return { status: "error", fieldErrors: { password: messageFor(error, ACCOUNT_OVERRIDES) } };
    return { status: "error", message: messageFor(error, ACCOUNT_OVERRIDES) };
  }
  return {
    status: "pending",
    message: "Scan the code with your authenticator app, save your backup codes, then enter the 6-digit code to finish.",
    twoFactorSetup: setup,
  };
}

/**
 * Step 2 (field: code): the first code from the authenticator app. On
 * success two-factor is on, this device stays signed in and a security
 * notice is emailed.
 */
export async function confirmTwoFactorSetup(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const demo = await demoRefusal();
  if (demo) return demo;
  const parsed = totpCode.safeParse(field(formData, "code"));
  if (!parsed.success) return { status: "error", fieldErrors: { code: parsed.error.issues[0]?.message } };
  const tooMany = await limited("two-factor-setup", 10, 5 * 60_000);
  if (tooMany) return tooMany;

  const auth = await getBetterAuth();
  const session = await authoritativeSession(auth);
  if (!session) return SIGNED_OUT;
  try {
    await auth.api.verifyTOTP({ body: { code: parsed.data }, headers: await headers() });
  } catch (error) {
    return { status: "error", fieldErrors: { code: messageFor(error, ACCOUNT_OVERRIDES) } };
  }
  await notify(session.user.email, "two-factor-enabled", session.user.name);
  return { status: "done", message: "Two-factor sign-in is on. You’ll need a code from your app each time you sign in with a password." };
}

/** Turn two-factor off (field: password). Emails a security notice. */
export async function disableTwoFactor(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const demo = await demoRefusal();
  if (demo) return demo;
  const current = field(formData, "password");
  if (!current) return { status: "error", fieldErrors: { password: "Enter your password to continue." } };
  const tooMany = await limited("two-factor-setup", 5, 5 * 60_000);
  if (tooMany) return tooMany;

  const auth = await getBetterAuth();
  const session = await authoritativeSession(auth);
  if (!session) return SIGNED_OUT;
  try {
    await auth.api.disableTwoFactor({ body: { password: current }, headers: await headers() });
  } catch (error) {
    const code = errorCode(error);
    if (code === "INVALID_PASSWORD") return { status: "error", fieldErrors: { password: messageFor(error, ACCOUNT_OVERRIDES) } };
    return { status: "error", message: messageFor(error, ACCOUNT_OVERRIDES) };
  }
  await notify(session.user.email, "two-factor-disabled", session.user.name);
  return { status: "done", message: "Two-factor sign-in is off." };
}

/** Replace every backup code with a fresh set (field: password). Returns `backupCodes` (show once). */
export async function regenerateBackupCodes(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const demo = await demoRefusal();
  if (demo) return demo;
  const current = field(formData, "password");
  if (!current) return { status: "error", fieldErrors: { password: "Enter your password to continue." } };
  const tooMany = await limited("two-factor-setup", 5, 5 * 60_000);
  if (tooMany) return tooMany;

  const auth = await getBetterAuth();
  if (!(await authoritativeSession(auth))) return SIGNED_OUT;
  try {
    const result = await auth.api.generateBackupCodes({ body: { password: current }, headers: await headers() });
    return { status: "done", message: "New backup codes are ready. The old ones no longer work.", backupCodes: result.backupCodes };
  } catch (error) {
    const code = errorCode(error);
    if (code === "INVALID_PASSWORD") return { status: "error", fieldErrors: { password: messageFor(error, ACCOUNT_OVERRIDES) } };
    return { status: "error", message: messageFor(error, ACCOUNT_OVERRIDES) };
  }
}
