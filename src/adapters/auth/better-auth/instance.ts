import "server-only";

//
// The Better Auth instance — built lazily, once per process.
//
//   - DATA_PROVIDER=postgres (the default, which includes the embedded PGlite
//     demo database) → Drizzle adapter over the app's own connection
//     (getDrizzle) and the auth_* tables in src/adapters/data/postgres/schema.ts.
//     One database, one set of migrations. Rate limits are stored there too.
//   - DATA_PROVIDER=memory (unit tests only) → Better Auth's memory adapter,
//     its store kept on globalThis so a hot reload doesn't sign everyone out.
//
// Features: email + password (verification required in production unless
// AUTH_REQUIRE_EMAIL_VERIFICATION=false), password reset, magic links
// (AUTH_MAGIC_LINK=true), two-factor auth (TOTP + backup codes), and
// GitHub/Google buttons only for providers whose id AND secret are both set.
//
// Every new session passes guardNewSession (databaseHooks.session.create):
//   - a person banned in the app (isBanned(), SPEC invariant 7) gets none,
//     whatever the way in; the sign-in form says the account is suspended.
//   - nothing skips a second factor. Better Auth's two-factor step only
//     guards the password sign-in, so for an account with two-factor on a
//     sign-in link, an email-confirmation link and a GitHub/Google sign-in
//     are all refused (the provider's own 2FA is not this site's). Such an
//     account is not even sent a sign-in link (it gets a "sign in with your
//     password and code" email instead, and the form answers the same).
//
// Per-account limits (./throttle.ts), on with the per-IP ones (rateLimitEnabled):
//   - wrong passwords per account, counted in hooks.before/after on the
//     sign-in and on every signed-in endpoint that checks the current password,
//     so a guesser spread over many IPs still hits a wall. The answer is the
//     same for an address with no account, so the limit reveals nothing. A
//     browser that has proved the password (or reset it) carries a signed
//     known-device cookie and is counted on its own, so a stranger who runs
//     the shared counter down doesn't lock the owner out of their own browsers.
//   - asks for a reset link, a sign-in link or another confirmation link, per
//     address, counted in hooks.before whether or not the address has an
//     account: over the limit the form says so (TOO_MANY_EMAILS), which
//     reveals nothing. Reset and sign-in links are bounded by this alone.
//   - every other emailed link per address (confirmation, "you already have
//     an account"): over the limit, the email is quietly not sent and the
//     endpoint answers exactly as before.
//
// A GitHub/Google sign-up whose email the provider hasn't verified is refused
// while verification is required (guardNewUser): otherwise anyone could open
// an account under someone else's address before its owner does, and keep a
// way back in after the owner resets the password.
//
// GitHub/Google access, refresh and id tokens are never stored: sign-in only
// needs the identity, and a database dump or backup should hold nothing usable
// at the provider. Need the provider's API later? Drop withoutProviderTokens
// from the account hooks (encryptOAuthTokens keeps them encrypted at rest).
//
// Social sign-in links to an existing account with the same email only when
// the provider itself says the address is verified (no trustedProviders:
// trusting a provider skips that check, which is how an unverified GitHub
// email would take over a verified account here), and never into an account
// with two-factor on (guardNewAccount). Linking from a signed-in session
// (/link-social) needs a sign-in from the last 15 minutes.
//
// The read-only demo admin (DEMO_ADMIN_EMAIL, src/core/demo.ts) is shared by
// every visitor who presses "Try the demo", so nothing about its credentials
// may change: guardDemoAccount (hooks.before) refuses it a password change,
// an email or profile change, deleting itself, two-factor (which would lock
// everyone else out), ending other sessions, linking a provider, and a reset
// or sign-in link to its address — for the HTTP endpoints and the server
// actions (auth.api.*) alike. Its welcome email is never sent.
//
// Without BETTER_AUTH_SECRET in development, a random secret is generated
// once into .data/dev-auth-secret (production refuses to start without one).
//
// Two-factor is switched on only when the schema has its columns
// (auth_user.two_factor_enabled + the auth_two_factor table): the Drizzle
// adapter refuses to write a field its schema lacks, so registering the
// plugin without them would break every sign-up.
//
// Env is read when the instance is first built, never at module scope, so
// `next build` needs no secrets.
//
// Imports beyond the usual adapter set: src/server/{email,email-templates} and
// src/server/services/content, so Better Auth's emails (verification, reset,
// magic link) go through the app's own email registry and copy; and
// src/server/services/bans for isBanned().
//

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getTableColumns, type Table } from "drizzle-orm";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import { dataProvider, demoAdminLogin, isProduction, optionalEnv, siteUrl } from "@/server/env";
import { sendEmail } from "@/server/email";
import {
  existingAccountTemplate,
  magicLinkTemplate,
  magicLinkTwoFactorTemplate,
  resetPasswordTemplate,
  securityNoticeTemplate,
  verifyEmailTemplate,
  welcomeTemplate,
} from "@/server/email-templates";
import { getContent } from "@/server/services/content";
import { isBanned } from "@/server/services/bans";
import { BANNED_ERROR, BANNED_MESSAGE } from "@/core/auth";
import { DEMO_READ_ONLY_CODE, DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { errorCode } from "./errors";
import {
  EMAILS_PER_ADDRESS,
  KNOWN_DEVICE_ATTEMPTS,
  LINK_REQUESTS_PER_ADDRESS,
  PASSWORD_ATTEMPTS,
  databaseThrottle,
  memoryThrottle,
  subjectDigest,
  throttleKey,
  type Throttle,
  type ThrottleAdapter,
} from "./throttle";
import { log } from "@/server/log";

/** Social providers Better Auth supports here, in the order their buttons appear. */
export type SocialProviderId = "github" | "google";

const SOCIAL: { id: SocialProviderId; label: string; idVar: string; secretVar: string }[] = [
  { id: "github", label: "GitHub", idVar: "GITHUB_CLIENT_ID", secretVar: "GITHUB_CLIENT_SECRET" },
  { id: "google", label: "Google", idVar: "GOOGLE_CLIENT_ID", secretVar: "GOOGLE_CLIENT_SECRET" },
];

/** The social providers with both keys set — what the sign-in page shows buttons for. */
export function configuredSocialProviders(): { id: SocialProviderId; label: string }[] {
  return SOCIAL.filter((p) => optionalEnv(p.idVar) && optionalEnv(p.secretVar)).map(({ id, label }) => ({ id, label }));
}

/** AUTH_MAGIC_LINK=true adds "Email me a sign-in link" to the sign-in page. */
export function magicLinkEnabled(): boolean {
  return optionalEnv("AUTH_MAGIC_LINK") === "true";
}

/**
 * Verification is required in production unless AUTH_REQUIRE_EMAIL_VERIFICATION=false.
 * In development it is off so the demo sign-up just works (the email still
 * prints to the server log); AUTH_REQUIRE_EMAIL_VERIFICATION=true turns it on locally.
 */
export function emailVerificationRequired(): boolean {
  const flag = optionalEnv("AUTH_REQUIRE_EMAIL_VERIFICATION");
  if (flag === "true") return true;
  if (flag === "false") return false;
  return isProduction();
}

/**
 * Rate limits on sign-in, sign-up, two-factor and the emailed-link endpoints.
 * On in production; off in dev (Better Auth's own default) so a local test
 * loop doesn't lock you out — AUTH_RATE_LIMIT=true turns them on locally,
 * AUTH_RATE_LIMIT=false turns them off anywhere (only behind your own limiter).
 */
export function rateLimitEnabled(): boolean {
  const flag = optionalEnv("AUTH_RATE_LIMIT");
  if (flag === "true") return true;
  if (flag === "false") return false;
  return isProduction();
}

/** Minimum password length, shared by the forms, the actions and Better Auth. */
export const PASSWORD_MIN = 8;
/** Maximum password length (long passphrases welcome; this bounds hashing cost). */
export const PASSWORD_MAX = 128;

/**
 * How recent a sign-in must be for the steps that add a way in: setting a
 * first password on a GitHub/Google-only account, and linking a provider
 * (/link-social). Same window as FRESH_SIGN_IN_MINUTES in src/lib/reauth.ts
 * (account deletion); the auth tests check the two agree.
 */
export const FRESH_SIGN_IN_SECONDS = 15 * 60;

/** True when a session was created (a real sign-in) within FRESH_SIGN_IN_SECONDS. */
export function sessionIsFresh(createdAt: Date | string, now: number = Date.now()): boolean {
  const at = new Date(createdAt).getTime();
  return Number.isFinite(at) && now - at < FRESH_SIGN_IN_SECONDS * 1000;
}

/** Where the generated development secret is kept: next to the embedded database, git- and docker-ignored. */
export const DEV_SECRET_FILE = ".data/dev-auth-secret";

/**
 * Development without BETTER_AUTH_SECRET: a random secret generated on first
 * boot and kept in .data/dev-auth-secret, so sessions survive restarts but no
 * two checkouts share a secret (a fixed one in a public repo would let anyone
 * on the network forge a session cookie for a running dev server). If the
 * file can't be written, the secret lives for this process only. Exported for tests.
 */
export function loadOrCreateDevSecret(file: string): string {
  let value = "";
  try {
    value = readFileSync(file, "utf8").trim();
  } catch {
    // Not there yet: generated below.
  }
  if (value.length < 32) {
    value = randomBytes(32).toString("base64url");
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${value}\n`, { mode: 0o600 });
    } catch (error) {
      log.warn("auth", `could not save a development secret to ${file}; sessions end when the server restarts.`, error);
    }
  }
  return value;
}

function devSecret(): string {
  const g = globalThis as Globals;
  g.__openshipkitDevSecret ??= loadOrCreateDevSecret(join(process.cwd(), DEV_SECRET_FILE));
  return g.__openshipkitDevSecret;
}

function secret(): string {
  const value = optionalEnv("BETTER_AUTH_SECRET");
  if (value) return value;
  if (isProduction()) {
    throw new Error("Missing environment variable BETTER_AUTH_SECRET (signs Better Auth sessions). Generate one with `openssl rand -base64 32`.");
  }
  log.warn("auth", `BETTER_AUTH_SECRET is not set; using a generated development secret (${DEV_SECRET_FILE}). Set it before deploying.`);
  return devSecret();
}

type Globals = typeof globalThis & { __openshipkitAuthMemory?: MemoryDB; __openshipkitDevSecret?: string };

function memoryDb(): MemoryDB {
  const g = globalThis as Globals;
  // The memory adapter throws on a model it has never seen, so start with every table.
  g.__openshipkitAuthMemory ??= { user: [], session: [], account: [], verification: [], rateLimit: [], twoFactor: [] };
  return g.__openshipkitAuthMemory;
}

/** The emailed link should land on the result page, not the bare home page Better Auth defaults to. */
function verificationLink(url: string): string {
  try {
    const u = new URL(url);
    const callback = u.searchParams.get("callbackURL");
    if (!callback || callback === "/" || callback === "%2F") u.searchParams.set("callbackURL", "/auth/verify-email");
    return u.toString();
  } catch {
    return url;
  }
}

async function deliver(kind: string, send: () => Promise<unknown>): Promise<void> {
  // A failed send is logged, not thrown: the person can ask for another
  // email, and a 500 here would tell an attacker whether an account exists.
  try {
    await send();
  } catch (error) {
    log.error("auth", `could not send the ${kind} email`, error);
  }
}

async function productName(): Promise<string> {
  try {
    return (await getContent("site")).name;
  } catch {
    return "OpenShipKit";
  }
}

type Database = NonNullable<BetterAuthOptions["database"]>;

function socialProviderOptions(): BetterAuthOptions["socialProviders"] {
  const out: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  for (const p of SOCIAL) {
    const clientId = optionalEnv(p.idVar);
    const clientSecret = optionalEnv(p.secretVar);
    // Better Auth then refuses a session to an account whose address isn't
    // verified yet (and sends the confirmation link) instead of signing it in.
    if (clientId && clientSecret) out[p.id] = { clientId, clientSecret, requireEmailVerification: emailVerificationRequired() };
  }
  return out;
}

/** The ?error= code a refused sign-in link lands with (the sign-in form explains it). */
export const MAGIC_LINK_TWO_FACTOR_ERROR = "two-factor-required";

/** The two-factor plugin's flag on the user row (absent when the plugin is off). */
function hasTwoFactor(user: unknown): boolean {
  return typeof user === "object" && user !== null && (user as { twoFactorEnabled?: unknown }).twoFactorEnabled === true;
}

/**
 * Send an emailed link. `asked` says the per-address ask was already counted
 * (LINK_REQUESTS_PER_ADDRESS, in hooks.before), so the quiet per-address
 * email limit is skipped.
 */
type DeliverLink = (kind: string, to: string, send: () => Promise<unknown>, asked?: "asked") => Promise<void>;

function magicLinkPlugin(base: string, deliverLink: DeliverLink) {
  return magicLink({
    expiresIn: 60 * 10,
    sendMagicLink: async ({ email, url }, ctx) => {
      // A link would sign in without the authenticator code, so a two-factor
      // account gets a pointer to the password sign-in instead. The endpoint
      // answers the same either way, so nothing is revealed about the account.
      const found = await ctx?.context.internalAdapter.findUserByEmail(email);
      if (found && hasTwoFactor(found.user)) {
        await deliverLink(
          "magic link (two-factor)",
          email,
          async () => sendEmail({ to: email, ...(await magicLinkTwoFactorTemplate({ name: found.user.name, signInUrl: `${base}/sign-in` })) }),
          "asked",
        );
        return;
      }
      await deliverLink("magic link", email, async () => sendEmail({ to: email, ...(await magicLinkTemplate({ url })) }), "asked");
    },
  });
}

type Hooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type SessionCreateBefore = NonNullable<NonNullable<NonNullable<Hooks["session"]>["create"]>["before"]>;
type AccountCreateBefore = NonNullable<NonNullable<NonNullable<Hooks["account"]>["create"]>["before"]>;
type AccountUpdateBefore = NonNullable<NonNullable<NonNullable<Hooks["account"]>["update"]>["before"]>;
type UserCreateBefore = NonNullable<NonNullable<NonNullable<Hooks["user"]>["create"]>["before"]>;
type HookContext = Parameters<SessionCreateBefore>[1];

/** The Better Auth error code (APIError body) for a refused session; errors.ts gives each a sentence. */
export const BANNED_CODE = "BANNED";
export const TWO_FACTOR_REQUIRED_CODE = "TWO_FACTOR_REQUIRED";

const TWO_FACTOR_REQUIRED_MESSAGE = "This account has two-factor sign-in. Sign in with your password and authenticator code.";

/**
 * Session-creating paths that never pass through the two-factor step. Better
 * Auth's two-factor plugin only guards the password sign-in (/sign-in/email),
 * so every other way in must refuse an account with two-factor on: a sign-in
 * link, an email-confirmation link (autoSignInAfterVerification), and a
 * GitHub/Google sign-in (the provider's own 2FA is not this site's).
 */
function skipsSecondFactor(path: string | undefined): boolean {
  if (!path) return false;
  return path === "/magic-link/verify" || path === "/verify-email" || path.startsWith("/callback/") || path.startsWith("/oauth2/callback");
}

/**
 * Refuse the session being created. A browser following an emailed link
 * (sign-in link, confirmation link) lands on a page that explains why, with
 * ?error=<queryCode>; an OAuth callback turns the APIError's code into
 * ?error=<code> on its error URL itself; an API caller gets a 403.
 */
function refuse(ctx: HookContext, code: string, queryCode: string, message: string): never {
  if (ctx?.path === "/magic-link/verify") {
    const query = (ctx.query ?? {}) as { errorCallbackURL?: string; callbackURL?: string };
    const back = query.errorCallbackURL ?? query.callbackURL;
    if (back) {
      // Same resolution as the plugin's own error redirect (originCheck has vetted it).
      const target = new URL(decodeURIComponent(back), ctx.context.baseURL);
      target.searchParams.set("error", queryCode);
      throw ctx.redirect(target.toString());
    }
  }
  if (ctx?.path === "/verify-email") {
    // The address is confirmed by now; only the automatic sign-in is refused.
    const target = new URL("/sign-in", ctx.context.baseURL);
    target.searchParams.set("error", queryCode);
    throw ctx.redirect(target.toString());
  }
  throw new APIError("FORBIDDEN", { code, message });
}

/** The auth user behind a hook call. Internal calls may come without an endpoint context. */
async function hookUser(userId: string, ctx: HookContext): Promise<{ email: string } | null> {
  const internal = ctx ? ctx.context.internalAdapter : (await (await getBetterAuth()).$context).internalAdapter;
  return internal.findUserById(userId);
}

/**
 * Every new session, whatever the way in (password, sign-in link, social,
 * confirmation link, two-factor step), is refused when:
 *   - the person is banned in the app (isBanned(), SPEC invariant 7) — the
 *     sign-in form says the account is suspended;
 *   - the account has two-factor on and the path skips the code step (see
 *     skipsSecondFactor), including a sign-in link sent before two-factor
 *     was switched on, or one forged around sendMagicLink.
 */
const guardNewSession: SessionCreateBefore = async (session, ctx) => {
  const user = await hookUser(session.userId, ctx);
  if (!user) return;
  if (await isBanned(user.email)) refuse(ctx, BANNED_CODE, BANNED_ERROR, BANNED_MESSAGE);
  if (skipsSecondFactor(ctx?.path) && hasTwoFactor(user)) {
    refuse(ctx, TWO_FACTOR_REQUIRED_CODE, MAGIC_LINK_TWO_FACTOR_ERROR, TWO_FACTOR_REQUIRED_MESSAGE);
  }
};

const PROVIDER_TOKENS = ["accessToken", "refreshToken", "idToken"] as const;

/** The account row with the provider's tokens blanked (see the header). Fields the write doesn't touch stay absent. */
export function withoutProviderTokens<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const field of PROVIDER_TOKENS) if (field in out) out[field] = null;
  return out as T;
}

/**
 * A GitHub/Google identity is never linked into an account with two-factor
 * on: its sign-in would be refused anyway (guardNewSession), and a link made
 * by whoever controls the inbox would wait there for the day two-factor is
 * switched off. A linked identity is stored without the provider's tokens.
 */
const guardNewAccount: AccountCreateBefore = async (account, ctx) => {
  if (skipsSecondFactor(ctx?.path)) {
    const user = await hookUser(account.userId, ctx);
    if (user && hasTwoFactor(user)) throw new APIError("FORBIDDEN", { code: TWO_FACTOR_REQUIRED_CODE, message: TWO_FACTOR_REQUIRED_MESSAGE });
  }
  if (account.providerId === "credential") return;
  return { data: withoutProviderTokens(account) };
};

/** The code (the sign-in form gives it a sentence) for a GitHub/Google sign-up with an unverified email. */
export const SOCIAL_EMAIL_NOT_VERIFIED_CODE = "SOCIAL_EMAIL_NOT_VERIFIED";

/** Paths where a GitHub/Google identity can create an account: the OAuth callback, or an id token posted to /sign-in/social. */
function socialSignUp(path: string | undefined): boolean {
  if (!path) return false;
  return path.startsWith("/callback/") || path.startsWith("/oauth2/callback") || path === "/sign-in/social";
}

/**
 * While verification is required, a GitHub/Google sign-up is refused unless
 * the provider says the email is verified. Better Auth would otherwise create
 * the account (and, without requireEmailVerification, sign it in): whoever
 * holds a provider account under someone else's unverified address would own
 * an account here before its real owner, and their GitHub link would survive
 * the owner's password reset. Refusing the row itself leaves nothing behind;
 * the callback sends the browser to /sign-in?error=SOCIAL_EMAIL_NOT_VERIFIED.
 */
const guardNewUser: UserCreateBefore = async (user, ctx) => {
  if (user.emailVerified || !socialSignUp(ctx?.path) || !emailVerificationRequired()) return;
  throw new APIError("FORBIDDEN", {
    code: SOCIAL_EMAIL_NOT_VERIFIED_CODE,
    message: "That account’s email isn’t verified by the provider. Verify it there, or sign up with your email.",
  });
};

/** Fresh tokens from a later sign-in or refresh are dropped the same way. */
const stripTokenUpdates: AccountUpdateBefore = async (data) => {
  if (!PROVIDER_TOKENS.some((field) => data[field] != null)) return;
  return { data: withoutProviderTokens(data) };
};

type MiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Linking a provider from a signed-in session (/link-social) adds a way in,
 * so it needs a sign-in from the last FRESH_SIGN_IN_SECONDS: a copied cookie
 * alone can't plant the attacker's own GitHub account.
 */
async function requireFreshSessionToLink(ctx: MiddlewareContext): Promise<void> {
  if (ctx.path !== "/link-social") return;
  const current = await getSessionFromCtx(ctx);
  if (current && !sessionIsFresh(current.session.createdAt)) {
    throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: "Sign in again to link an account." });
  }
}

/** The code (errors.ts gives it a sentence) when an account has had too many wrong passwords. */
export const PASSWORD_ATTEMPTS_CODE = "TOO_MANY_PASSWORD_ATTEMPTS";

/** Signed-in endpoints that check the current password (body.password or body.currentPassword). */
const PASSWORD_CHECKS = new Set([
  "/change-password",
  "/verify-password",
  "/delete-user",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes",
]);

/** The answers that mean the password was wrong; any other outcome hands the attempt back. */
const WRONG_PASSWORD = new Set(["INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD"]);

/**
 * The account a password is being tried against: the address in the body
 * for the sign-in (whether or not it has an account, so a lockout gives
 * nothing away), the signed-in person for the settings endpoints.
 */
async function passwordAccount(ctx: MiddlewareContext): Promise<string | null> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (ctx.path === "/sign-in/email") return typeof body.email === "string" && body.email.trim() ? body.email : null;
  if (!ctx.path || !PASSWORD_CHECKS.has(ctx.path)) return null;
  const supplied = body.password ?? body.currentPassword;
  if (typeof supplied !== "string" || !supplied) return null;
  return (await getSessionFromCtx(ctx))?.user.email ?? null;
}

/** The signed cookie a browser gets once it has proved an account's password (see passwordAttemptHooks). */
const KNOWN_DEVICE_COOKIE = "known_device";
/** A browser stays known for 180 days after its last right password or reset. */
const KNOWN_DEVICE_MAX_AGE = 60 * 60 * 24 * 180;

/** This browser's known-device id for `account`, if its signed cookie names that account (one account per browser: the last one proved). */
async function knownDevice(ctx: MiddlewareContext, account: string): Promise<string | null> {
  const { name } = ctx.context.createAuthCookie(KNOWN_DEVICE_COOKIE);
  const value = await ctx.getSignedCookie(name, ctx.context.secret);
  if (!value) return null;
  const [tag, id] = value.split(".");
  return tag === subjectDigest(account) && id ? id : null;
}

/** Mark this browser as known for `account` (keeping its id when it has one): "<account digest>.<random id>", signed. */
async function rememberDevice(ctx: MiddlewareContext, account: string, id: string | null): Promise<void> {
  const cookie = ctx.context.createAuthCookie(KNOWN_DEVICE_COOKIE, { maxAge: KNOWN_DEVICE_MAX_AGE });
  const value = `${subjectDigest(account)}.${id ?? randomBytes(16).toString("base64url")}`;
  await ctx.setSignedCookie(cookie.name, value, ctx.context.secret, cookie.attributes);
}

/** The account a password-reset token belongs to (the browser that uses it proves the inbox). */
async function resetAccount(ctx: MiddlewareContext): Promise<string | null> {
  const token = (ctx.body as { token?: unknown } | undefined)?.token ?? (ctx.query as { token?: unknown } | undefined)?.token;
  if (typeof token !== "string" || !token) return null;
  const verification = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
  if (!verification) return null;
  return (await ctx.context.internalAdapter.findUserById(verification.value))?.email ?? null;
}

interface PasswordCall {
  /** The counter this call took a slot from; null for a password reset, which takes none. */
  key: string | null;
  account: string;
  device: string | null;
}

/**
 * Per-account password limits as a before/after hook pair. The before hook
 * takes a slot (atomically, so a parallel burst can't all get in) and
 * refuses once the window is full; the after hook hands the slot back unless
 * the password was wrong, so what is counted is wrong passwords. The call is
 * remembered on its context object.
 *
 * The slot comes from the account's shared counter, or, for a browser with
 * a known-device cookie for that account, from the browser's own counter.
 * A right password (or a password reset) sets that cookie, so a stranger
 * running the shared counter down can't lock the owner out of a browser
 * they have used before. Only someone who has proved the password ever gets
 * one, so it buys no guesses.
 */
function passwordAttemptHooks(throttle: Throttle) {
  const calls = new WeakMap<object, PasswordCall>();
  return {
    async take(ctx: MiddlewareContext): Promise<void> {
      if (ctx.path === "/reset-password") {
        const account = await resetAccount(ctx);
        if (account) calls.set(ctx.context, { key: null, account, device: await knownDevice(ctx, account) });
        return;
      }
      const account = await passwordAccount(ctx);
      if (!account) return;
      const device = await knownDevice(ctx, account);
      const key = device ? throttleKey("device", `${account} ${device}`) : throttleKey("password", account);
      if (!(await throttle.take(key, device ? KNOWN_DEVICE_ATTEMPTS : PASSWORD_ATTEMPTS))) {
        throw new APIError("TOO_MANY_REQUESTS", { code: PASSWORD_ATTEMPTS_CODE, message: "Too many wrong passwords for this account. Try again later." });
      }
      calls.set(ctx.context, { key, account, device });
    },
    async settle(ctx: MiddlewareContext): Promise<void> {
      const call = calls.get(ctx.context);
      if (!call) return;
      calls.delete(ctx.context);
      if (WRONG_PASSWORD.has(errorCode(ctx.context.returned) ?? "")) return;
      if (call.key) await throttle.give(call.key);
      // Any other refusal (unconfirmed email, a ban, a bad token) proves nothing.
      if (ctx.context.returned instanceof Error) return;
      await rememberDevice(ctx, call.account, call.device);
    },
  };
}

/** Endpoints that email a link to the address in the body when asked. */
const LINK_REQUESTS = new Set(["/request-password-reset", "/sign-in/magic-link", "/send-verification-email"]);

/** The code (errors.ts gives it a sentence) when an address has been sent too many links. */
export const TOO_MANY_EMAILS_CODE = "TOO_MANY_EMAILS";

/**
 * Count an ask for an emailed link against the address, whether or not it
 * has an account, and refuse out loud once the hour's allowance is used:
 * saying so reveals nothing, and the person asking knows to wait instead of
 * watching an inbox for a link that was never sent.
 */
async function countLinkRequest(ctx: MiddlewareContext, throttle: Throttle): Promise<void> {
  if (!ctx.path || !LINK_REQUESTS.has(ctx.path)) return;
  const address = (ctx.body as { email?: unknown } | undefined)?.email;
  if (typeof address !== "string" || !address.trim()) return;
  if (!(await throttle.take(throttleKey("request", address), LINK_REQUESTS_PER_ADDRESS))) {
    throw new APIError("TOO_MANY_REQUESTS", { code: TOO_MANY_EMAILS_CODE, message: "Too many emails have been sent to this address. Try again in an hour." });
  }
}

/** Signed-in endpoints that change the demo account's credentials, profile or other sessions. */
const DEMO_LOCKED = new Set([
  "/change-password",
  "/change-email",
  "/update-user",
  "/delete-user",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/update-session",
  "/link-social",
  "/unlink-account",
]);

/** Endpoints that email a way in to the address in the body. */
const DEMO_EMAILED = new Set(["/request-password-reset", "/sign-in/magic-link"]);

/** Is `email` the read-only demo admin's address? */
function isDemoAddress(email: string | null | undefined): boolean {
  const demo = demoAdminLogin()?.email;
  return Boolean(demo && email && email.trim().toLowerCase() === demo);
}

/** Refuse anything that would change the shared demo account (see the header). Exported for tests. */
export async function guardDemoAccount(ctx: MiddlewareContext): Promise<void> {
  if (!ctx.path || !demoAdminLogin()) return;
  let email: string | null = null;
  if (DEMO_EMAILED.has(ctx.path)) {
    const address = (ctx.body as { email?: unknown } | undefined)?.email;
    email = typeof address === "string" ? address : null;
  } else if (ctx.path === "/reset-password" || ctx.path.startsWith("/reset-password/")) {
    email = await resetAccount(ctx);
  } else if (DEMO_LOCKED.has(ctx.path)) {
    email = (await getSessionFromCtx(ctx))?.user.email ?? null;
  }
  if (isDemoAddress(email)) throw new APIError("FORBIDDEN", { code: DEMO_READ_ONLY_CODE, message: DEMO_READ_ONLY_MESSAGE });
}

function twoFactorPlugin(issuer: string) {
  return twoFactor({
    issuer,
    // Backup codes are stored encrypted with BETTER_AUTH_SECRET (the default).
    backupCodeOptions: { amount: 10, length: 10 },
    // Ten wrong codes in a row lock the second factor for 15 minutes.
    accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
    // "Trust this device" skips the code on this browser for 30 days.
    trustDeviceMaxAge: 60 * 60 * 24 * 30,
  });
}

type Plugins = [ReturnType<typeof magicLinkPlugin>, ReturnType<typeof twoFactorPlugin>, ReturnType<typeof nextCookies>];

/** How the instance stores its data. */
export interface AuthStorage {
  database: Database;
  rateLimitStorage: "database" | "memory";
  /** The schema can hold two-factor data (see the header). */
  twoFactor: boolean;
}

/** Everything that varies by environment, resolved once when the instance is built. */
interface BuildContext extends AuthStorage {
  appName: string;
}

function build({ database, rateLimitStorage, twoFactor: withTwoFactor, appName }: BuildContext) {
  const base = siteUrl();
  const dashboardUrl = `${base}/dashboard`;
  const limits = rateLimitEnabled();
  // Same storage as Better Auth's own limits. The adapter comes from the
  // instance, which exists by the time any limit is checked.
  const self: { context?: Promise<{ adapter: ThrottleAdapter }> } = {};
  const throttle =
    rateLimitStorage === "database"
      ? databaseThrottle(async () => {
          if (!self.context) throw new Error("[auth] the instance is not built yet");
          return (await self.context).adapter;
        })
      : memoryThrottle();
  const passwordAttempts = passwordAttemptHooks(throttle);

  /**
   * deliver(), but at most EMAILS_PER_ADDRESS emailed links per address;
   * over it, quietly not sent. A link the person asked for ("asked": reset,
   * sign-in link) was already counted by countLinkRequest, which refuses out
   * loud, so other email to the address can't use up the owner's recovery.
   */
  const deliverLink: DeliverLink = async (kind, to, send, asked) => {
    if (limits && !asked) {
      let allowed = true;
      try {
        allowed = await throttle.take(throttleKey("email", to), EMAILS_PER_ADDRESS);
      } catch (error) {
        log.error("auth", "could not check the per-address email limit; sending anyway", error);
      }
      if (!allowed) {
        log.warn("auth", `${kind} email not sent: the address has had ${EMAILS_PER_ADDRESS.max} in the last hour`);
        return;
      }
    }
    await deliver(kind, send);
  };
  const plugins = [
    ...(magicLinkEnabled() ? [magicLinkPlugin(base, deliverLink)] : []),
    ...(withTwoFactor ? [twoFactorPlugin(appName)] : []),
    // Last, so cookies set by auth.api calls inside server actions reach the browser.
    nextCookies(),
  ];

  const auth = betterAuth({
    appName,
    secret: secret(),
    baseURL: base,
    basePath: "/api/auth",
    trustedOrigins: [base],
    database,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      requireEmailVerification: emailVerificationRequired(),
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deliverLink(
          "password reset",
          user.email,
          async () => sendEmail({ to: user.email, ...(await resetPasswordTemplate({ url, name: user.name })) }),
          "asked",
        );
      },
      onPasswordReset: async ({ user }) => {
        // Proving the inbox ends a wrong-password lockout: the owner can sign in now.
        if (limits) await throttle.clear(throttleKey("password", user.email)).catch((error) => log.error("auth", "could not clear the password lockout", error));
        await deliver("password changed", async () =>
          sendEmail({ to: user.email, ...(await securityNoticeTemplate({ kind: "password-reset", name: user.name, url: `${base}/auth/forgot-password` })) }),
        );
      },
      // With verification required, signing up with a taken email answers
      // exactly like a new sign-up (no enumeration); the owner gets this note.
      onExistingUserSignUp: async ({ user }) => {
        await deliverLink("existing account", user.email, async () =>
          sendEmail({
            to: user.email,
            ...(await existingAccountTemplate({ name: user.name, signInUrl: `${base}/sign-in`, resetUrl: `${base}/auth/forgot-password` })),
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // An unverified account that signs in with the right password gets a fresh link.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await deliverLink("verification", user.email, async () =>
          // No name: it was typed by whoever signed up, before the address was proved.
          sendEmail({ to: user.email, ...(await verifyEmailTemplate({ url: verificationLink(url) })) }),
        );
      },
      afterEmailVerification: async (user) => {
        await deliver("welcome", async () => sendEmail({ to: user.email, ...(await welcomeTemplate({ name: user.name, dashboardUrl })) }));
      },
    },
    socialProviders: socialProviderOptions(),
    account: {
      // Signing in with GitHub/Google links to an existing account with the
      // same email ONLY when the provider reports that email as verified (and
      // the local account is verified too, Better Auth's default). Don't add
      // trustedProviders: it skips the provider's check, so an unverified
      // GitHub email could be linked into someone else's verified account.
      accountLinking: { enabled: true },
      // Provider tokens are blanked by the account hooks (see the header);
      // should they ever be kept, they are encrypted at rest.
      encryptOAuthTokens: true,
      updateAccountOnSignIn: false,
    },
    session: {
      // A signed copy of the session in a cookie saves a query per request;
      // kept short so a revoked session or a sign-out elsewhere bites within a minute.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    rateLimit: {
      enabled: rateLimitEnabled(),
      storage: rateLimitStorage,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
        "/sign-in/magic-link": { window: 300, max: 3 },
        "/two-factor/*": { window: 60, max: 10 },
        "/change-password": { window: 300, max: 5 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await guardDemoAccount(ctx);
        await requireFreshSessionToLink(ctx);
        if (limits) {
          await countLinkRequest(ctx, throttle);
          await passwordAttempts.take(ctx);
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (limits) await passwordAttempts.settle(ctx);
      }),
    },
    databaseHooks: {
      session: {
        create: { before: guardNewSession },
      },
      account: {
        create: { before: guardNewAccount },
        update: { before: stripTokenUpdates },
      },
      user: {
        create: {
          before: guardNewUser,
          // Social sign-ups arrive verified and never pass through
          // afterEmailVerification, so welcome them here.
          after: async (user) => {
            // The demo admin is made verified (src/server/demo-account.ts) and has no inbox to welcome.
            if (!user.emailVerified || isDemoAddress(user.email)) return;
            await deliver("welcome", async () => sendEmail({ to: user.email, ...(await welcomeTemplate({ name: user.name, dashboardUrl })) }));
          },
        },
      },
    },
    // Optional plugins are registered only when enabled; the cast keeps
    // their endpoints in the type so the server actions that call them
    // (each guarded by its feature check) type-check.
    plugins: plugins as unknown as Plugins,
  });
  self.context = auth.$context;
  return auth;
}

export type BetterAuthInstance = ReturnType<typeof build>;

/**
 * True when a Drizzle auth schema has the two-factor plugin's table and the
 * user column it reads. Exported for tests.
 */
export function schemaSupportsTwoFactor(tables: Record<string, unknown>): boolean {
  const user = tables.user as Table | undefined;
  if (!user || !tables.twoFactor) return false;
  return "twoFactorEnabled" in getTableColumns(user);
}

/** Build an instance over the given storage. The app uses getBetterAuth(); tests may call this directly. */
export async function createBetterAuth(storage: AuthStorage): Promise<BetterAuthInstance> {
  return build({ ...storage, appName: await productName() });
}

async function defaultStorage(): Promise<AuthStorage> {
  if (dataProvider() === "postgres") {
    const [{ drizzleAdapter }, { getDrizzle, authTables }] = await Promise.all([
      import("better-auth/adapters/drizzle"),
      import("@/adapters/data/postgres/db"),
    ]);
    const tables: Record<string, unknown> = authTables;
    const twoFactor = schemaSupportsTwoFactor(tables);
    if (!twoFactor) log.warn("auth", "two-factor is off: the auth schema has no auth_two_factor table yet (run the latest migrations).");
    return { database: drizzleAdapter(getDrizzle(), { provider: "pg", schema: tables }), rateLimitStorage: "database", twoFactor };
  }
  return { database: memoryAdapter(memoryDb()), rateLimitStorage: "memory", twoFactor: true };
}

interface Built {
  auth: BetterAuthInstance;
  twoFactor: boolean;
}

let instance: Promise<Built> | null = null;

function built(): Promise<Built> {
  if (!instance) {
    instance = (async () => {
      const storage = await defaultStorage();
      return { auth: await createBetterAuth(storage), twoFactor: storage.twoFactor };
    })().catch((error) => {
      instance = null; // retry on the next request instead of caching the failure
      throw error;
    });
  }
  return instance;
}

/**
 * The Better Auth instance, built on first use. Cached per module (a hot
 * reload rebuilds it with the new config; the memory store survives on globalThis).
 */
export async function getBetterAuth(): Promise<BetterAuthInstance> {
  return (await built()).auth;
}

/** Whether two-factor sign-in is available (the schema has its table). */
export async function twoFactorAvailable(): Promise<boolean> {
  return (await built()).twoFactor;
}
