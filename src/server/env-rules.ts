//
// The environment's rules, pure: each takes an env record (process.env, or a
// parsed .env file) and says which provider is in use. ONE copy, read by
//
//   - src/server/env.ts         every request (with process.env)
//   - src/instrumentation.ts    the production boot check (src/server/boot-check.ts)
//
// Keep it to erasable syntax and `import type` only, so a plain-Node script
// could import it too.
//
// so the boot check can't drift from what the server will actually do. No
// `server-only` here (instrumentation and scripts import it), and no secrets
// are returned that the caller didn't pass in.
//

import type { SiteProfile } from "@/core/profile";
import type { BillingProviderId, DataProviderId, EmailProviderId } from "@/core/types";

export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** A variable's trimmed value, or undefined when unset or blank. */
export function readEnv(env: EnvRecord, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function oneOf<T extends string>(env: EnvRecord, name: string, allowed: readonly T[], fallback: T): T {
  const v = readEnv(env, name);
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`${name}="${v}" is not one of: ${allowed.join(", ")}`);
}

/** DATA_PROVIDER: postgres (default) | memory (unit tests only; data resets on every restart). */
export function resolveDataProvider(env: EnvRecord): DataProviderId {
  return oneOf(env, "DATA_PROVIDER", ["postgres", "memory"] as const, "postgres");
}

/**
 * OPENSHIPKIT_PROFILE: saas (default) | site — a landing page + blog with no
 * pricing, billing or plans (src/core/profile.ts, docs/site-profile.md).
 */
export function resolveProfile(env: EnvRecord): SiteProfile {
  return oneOf(env, "OPENSHIPKIT_PROFILE", ["saas", "site"] as const, "saas");
}

/**
 * BILLING_PROVIDER: polar | none — polar when POLAR_ACCESS_TOKEN is set, else
 * none. Always none under OPENSHIPKIT_PROFILE=site, whatever Polar keys are set:
 * a content site sells nothing (the boot check warns when keys are set anyway).
 * A malformed BILLING_PROVIDER still throws, so a typo can't hide behind it.
 */
export function resolveBillingProvider(env: EnvRecord): BillingProviderId {
  const configured = oneOf(env, "BILLING_PROVIDER", ["polar", "none"] as const, readEnv(env, "POLAR_ACCESS_TOKEN") ? "polar" : "none");
  return resolveProfile(env) === "site" ? "none" : configured;
}

/** EMAIL_PROVIDER: resend | console — resend when RESEND_API_KEY is set, else console (the server log). */
export function resolveEmailProvider(env: EnvRecord): EmailProviderId {
  return oneOf(env, "EMAIL_PROVIDER", ["resend", "console"] as const, readEnv(env, "RESEND_API_KEY") ? "resend" : "console");
}

/** Where the data lives: the memory store, a Postgres server (DATABASE_URL), or the embedded PGlite database. */
export type DataMode = "memory" | "postgres" | "embedded-postgres";

export function resolveDataMode(env: EnvRecord): DataMode {
  if (resolveDataProvider(env) === "memory") return "memory";
  return readEnv(env, "DATABASE_URL") ? "postgres" : "embedded-postgres";
}

/** The deployed origin, no trailing slash; http://localhost:3000 when NEXT_PUBLIC_SITE_URL is unset. */
export function resolveSiteUrl(env: EnvRecord): string {
  return (readEnv(env, "NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The shortest BETTER_AUTH_SECRET production accepts. `openssl rand -base64 32` gives 44 characters. */
export const MIN_AUTH_SECRET_LENGTH = 32;

/** Placeholder words people paste instead of a secret (compared lower-case, ignoring - _ and spaces). */
const PLACEHOLDER_SECRETS = ["changeme", "secret", "password", "yoursecret", "yoursecrethere", "replaceme", "todo", "example", "betterauthsecret"];

/**
 * Why a BETTER_AUTH_SECRET is unsafe for production, or null when it is fine.
 * It signs session cookies and encrypts two-factor secrets, so a short or
 * guessable one lets anyone forge a session. Better Auth itself only warns.
 */
export function weakAuthSecretReason(secret: string | undefined): string | null {
  const v = secret?.trim() ?? "";
  if (!v) return "BETTER_AUTH_SECRET is not set.";
  const squashed = v.toLowerCase().replace(/[\s_-]+/g, "");
  // Words only, and one of them a placeholder: "change-me", "your_secret_here", "CHANGEME-CHANGEME-…".
  if (/^[a-z]+$/.test(squashed) && PLACEHOLDER_SECRETS.some((p) => squashed.includes(p))) {
    return "BETTER_AUTH_SECRET is placeholder text.";
  }
  if (v.length < MIN_AUTH_SECRET_LENGTH) return `BETTER_AUTH_SECRET is ${v.length} characters; it needs at least ${MIN_AUTH_SECRET_LENGTH}.`;
  if (new Set(v).size < 8) return "BETTER_AUTH_SECRET repeats a few characters; it needs to be random.";
  return null;
}

/**
 * The read-only demo admin (OpenShipKit's showcase only — docs/auth.md): the
 * account "Try the demo" signs visitors in as. On only when BOTH
 * DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD are set; the password is a server
 * secret the button uses and is never shown. Null when off or misconfigured
 * (demoAdminProblems says why; the boot check makes that fatal in production).
 */
export function resolveDemoAdmin(env: EnvRecord): { email: string; password: string } | null {
  if (demoAdminProblems(env).length > 0) return null;
  const email = readEnv(env, "DEMO_ADMIN_EMAIL");
  const password = readEnv(env, "DEMO_ADMIN_PASSWORD");
  return email && password ? { email: email.toLowerCase(), password } : null;
}

/** What is wrong with the demo admin's variables ([] when both are unset, or both are fine). */
export function demoAdminProblems(env: EnvRecord): string[] {
  const email = readEnv(env, "DEMO_ADMIN_EMAIL");
  const password = readEnv(env, "DEMO_ADMIN_PASSWORD") ?? "";
  if (!email && !password) return [];
  if (!email) return ["DEMO_ADMIN_PASSWORD is set without DEMO_ADMIN_EMAIL: the read-only demo admin needs both (or neither)."];
  if (!password) return ["DEMO_ADMIN_EMAIL is set without DEMO_ADMIN_PASSWORD: the read-only demo admin needs both (or neither)."];
  const problems: string[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`DEMO_ADMIN_EMAIL="${email}" is not an email address.`);
  if (password.length < 16 || password.length > 128) {
    problems.push("DEMO_ADMIN_PASSWORD needs 16–128 characters: it is never shown, so make it long and random (`openssl rand -base64 24`).");
  }
  const admins = (readEnv(env, "ADMIN_EMAILS") ?? "").split(",").map((e) => e.trim().toLowerCase());
  if (admins.includes(email.toLowerCase())) {
    problems.push("DEMO_ADMIN_EMAIL is also in ADMIN_EMAILS. The demo admin is read-only; use an address of its own.");
  }
  return problems;
}
