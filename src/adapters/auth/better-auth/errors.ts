//
// Better Auth error codes → one plain sentence for the person at the form.
// Sign-in failures stay deliberately vague ("email or password is wrong") so
// the form never confirms which emails have accounts. Account-settings forms
// pass `ACCOUNT_OVERRIDES`, where the person is already signed in and a
// precise message ("that password isn’t right") gives nothing away.
//
// BANNED and TWO_FACTOR_REQUIRED are this app's own codes: the session-create
// hook in ./instance.ts throws them (a ban, or a way in that skips the
// two-factor step). So is TOO_MANY_PASSWORD_ATTEMPTS, the per-account
// wrong-password limit (./throttle.ts) — said the same way whether or not
// the address has an account — and TOO_MANY_EMAILS, the per-address limit on
// asking for an emailed link, counted for every address alike. DEMO_READ_ONLY
// is the read-only demo admin refused a credential change.
//

import { BANNED_MESSAGE } from "@/core/auth";
import { DEMO_READ_ONLY_CODE, DEMO_READ_ONLY_MESSAGE } from "@/core/demo";

const WRONG_CREDENTIALS = "That email and password don’t match. Try again, or reset your password.";
const SIGN_IN_AGAIN = "For your security, sign out and sign in again, then retry.";

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: WRONG_CREDENTIALS,
  INVALID_PASSWORD: WRONG_CREDENTIALS,
  USER_NOT_FOUND: WRONG_CREDENTIALS,
  CREDENTIAL_ACCOUNT_NOT_FOUND: "This account signs in with GitHub or Google. Use that button, or reset your password to add one.",
  EMAIL_NOT_VERIFIED: "Confirm your email first. We’ve sent you a new link.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Sign in instead.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters.",
  PASSWORD_TOO_LONG: "Use 128 characters or fewer.",
  PASSWORD_ALREADY_SET: "This account already has a password. Change it with your current one.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_TOKEN: "This link is invalid or has already been used. Ask for a new one.",
  TOKEN_EXPIRED: "This link has expired. Ask for a new one.",
  EMAIL_ALREADY_VERIFIED: "This email is already confirmed. You can sign in.",
  PROVIDER_NOT_FOUND: "That sign-in option isn’t set up.",
  TOO_MANY_REQUESTS: "Too many attempts. Wait a minute and try again.",
  TOO_MANY_PASSWORD_ATTEMPTS: "Too many wrong passwords for this account. Wait 15 minutes and try again, or reset your password.",
  SOCIAL_EMAIL_NOT_VERIFIED: "That account’s email isn’t verified with GitHub or Google yet. Verify it there, or sign up with your email.",
  TOO_MANY_EMAILS: "Too many emails have been sent to this address in the last hour. Wait a while, then ask again.",
  UNAUTHORIZED: "You’re signed out. Sign in again to continue.",
  SESSION_EXPIRED: SIGN_IN_AGAIN,
  SESSION_NOT_FRESH: SIGN_IN_AGAIN,
  BANNED: BANNED_MESSAGE,
  // The read-only demo admin (./instance.ts → guardDemoAccount).
  [DEMO_READ_ONLY_CODE]: DEMO_READ_ONLY_MESSAGE,
  TWO_FACTOR_REQUIRED: "This account has two-factor sign-in. Sign in with your password and authenticator code.",
  // Two-factor
  INVALID_CODE: "That code isn’t right. Check your authenticator app and try the current code.",
  INVALID_BACKUP_CODE: "That backup code isn’t right, or it’s already been used.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Too many wrong codes. Sign in again to get a fresh attempt.",
  ACCOUNT_TEMPORARILY_LOCKED: "Too many wrong codes. Two-factor sign-in is locked for 15 minutes.",
  INVALID_TWO_FACTOR_COOKIE: "This sign-in timed out. Sign in again with your password.",
  TOTP_ALREADY_ENABLED: "Two-factor sign-in is already on.",
  TOTP_NOT_ENABLED: "Two-factor sign-in isn’t set up for this account.",
  TWO_FACTOR_NOT_ENABLED: "Two-factor sign-in isn’t set up for this account.",
  BACKUP_CODES_NOT_ENABLED: "Two-factor sign-in isn’t set up for this account.",
};

/** Sharper wording for forms behind sign-in (change password, two-factor settings). */
export const ACCOUNT_OVERRIDES: Record<string, string> = {
  INVALID_PASSWORD: "That password isn’t right.",
  INVALID_EMAIL_OR_PASSWORD: "That password isn’t right.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "This account has no password yet. Set one first.",
};

const FALLBACK = "Something went wrong on our side. Try again in a moment.";

/** The error code Better Auth attached to a thrown APIError, if any. */
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const body = (error as { body?: { code?: unknown } }).body;
  if (body && typeof body.code === "string") return body.code;
  const status = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  if (status === 429 || status === "TOO_MANY_REQUESTS") return "TOO_MANY_REQUESTS";
  if (status === 401 || status === "UNAUTHORIZED") return "UNAUTHORIZED";
  return null;
}

/** A sentence to show for a thrown Better Auth error. Unknown errors get a neutral fallback. */
export function messageFor(error: unknown, overrides?: Record<string, string>): string {
  const code = errorCode(error);
  if (!code) return FALLBACK;
  return overrides?.[code] ?? MESSAGES[code] ?? FALLBACK;
}

/** For the ?error= codes Better Auth appends to callback URLs. */
export function messageForCode(code: string | undefined | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? "That link didn’t work. Ask for a new one.";
}
