import "server-only";

//
// Every environment variable the server reads, in one place.
//
// OpenShipKit runs on Postgres + Better Auth, self-hosted. The two optional
// services switch on when their key is present:
//
//   DATABASE_URL       your Postgres. Unset in development → embedded Postgres (PGlite)
//                      in .data/pglite, migrated and seeded at boot. Required in production.
//   DATA_PROVIDER      postgres (default) | memory (unit tests only; data resets on restart)
//   BILLING_PROVIDER   polar | none     (POLAR_ACCESS_TOKEN → polar, else none)
//   EMAIL_PROVIDER     resend | smtp | console (RESEND_API_KEY → resend, else SMTP_URL → smtp, else
//                      console: printed to the log; in production only To and Subject unless
//                      EMAIL_CONSOLE_PRINT_BODIES=true)
//   OPENSHIPKIT_PROFILE saas (default) | site: a landing page + blog with no pricing, billing or
//                      plans (src/core/profile.ts; billing is then none whatever Polar keys are set)
//
// Production boot checks (src/server/boot-check.ts, with the same rules from
// ./env-rules.ts): no DATABASE_URL, DATA_PROVIDER=memory, a missing or weak
// BETTER_AUTH_SECRET, or EMAIL_PROVIDER=resend without RESEND_API_KEY → the
// server exits; NEXT_PUBLIC_SITE_URL unset or local, or email going to the
// log → a loud warning, since every canonical, sitemap and email link is built
// from the URL and nobody can verify an address without email.
//
// Read lazily, at request time — never at module scope — so `next build` needs
// no secrets. .env.example lists every variable.
//

import type { SiteProfile } from "@/core/profile";
import type { BillingProviderId, DataProviderId, EmailProviderId } from "@/core/types";
import { resolveSupportUrl } from "@/shared/support";
import {
  readEnv,
  resolveDemoAdmin,
  resolveBillingProvider,
  resolveDataMode,
  resolveDataProvider,
  resolveEmailProvider,
  resolveProfile,
  resolveSiteUrl,
  type DataMode,
} from "./env-rules";

// The provider rules themselves live in ./env-rules.ts (pure, no server-only),
// so the production boot check and `npm run setup` apply the very same ones.

function read(name: string): string | undefined {
  return readEnv(process.env, name);
}

/** A required variable for the provider in use. Throws a message that says exactly what to set. */
export function requireEnv(name: string, why: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing environment variable ${name} (${why}). See .env.example.`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  return read(name);
}

export function dataProvider(): DataProviderId {
  return resolveDataProvider(process.env);
}

/** Where the data lives: "memory", "postgres" (DATABASE_URL) or "embedded-postgres" (PGlite). The admin overview and /api/health show it. */
export function dataMode(): DataMode {
  return resolveDataMode(process.env);
}

/** OPENSHIPKIT_PROFILE: "saas" (default) or "site" (no pricing, billing or plans). Pass it down; never re-read env in a component. */
export function siteProfile(): SiteProfile {
  return resolveProfile(process.env);
}

/** Polar or none; none under the site profile whatever keys are set (env-rules.ts). */
export function billingProvider(): BillingProviderId {
  return resolveBillingProvider(process.env);
}

export function emailProvider(): EmailProviderId {
  return resolveEmailProvider(process.env);
}

/**
 * The deployed origin, no trailing slash. Never hard-code a domain anywhere else.
 * Falls back to http://localhost:3000; in production the boot check warns when
 * it is unset or local (src/server/boot-check.ts).
 */
export function siteUrl(): string {
  return resolveSiteUrl(process.env);
}

/**
 * Emails that become admins on sign-in (comma-separated). In production only
 * once the address is verified (src/server/session.ts). Promotion only:
 * removing an email does not demote, and an admin listed here can't be demoted
 * in /admin until it is removed.
 */
export function adminEmails(): string[] {
  return (read("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function emailFrom(): string {
  return read("EMAIL_FROM") ?? "OpenShipKit <onboarding@resend.dev>";
}

/**
 * OPENSHIPKIT_PUBLIC_DOCS=true publishes OpenShipKit's own docs (docs/*.md) at
 * /docs on a site that has been renamed. The showcase publishes them anyway;
 * a renamed fork doesn't, unless it sets this (src/server/docs.ts).
 */
export function publicDocs(): boolean {
  return read("OPENSHIPKIT_PUBLIC_DOCS") === "true";
}

/**
 * OPENSHIPKIT_SUPPORT_URL: the showcase's "Support the project" checkout (a
 * Polar pay-what-you-want checkout link), or null. The header shows it only on
 * the showcase (src/shared/support.ts).
 */
export function supportUrl(): string | null {
  return resolveSupportUrl(read("OPENSHIPKIT_SUPPORT_URL"));
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * May the console email provider print message bodies? Always in development.
 * In production a body carries live sign-in, reset and verification links, and
 * server logs are widely readable, so only with EMAIL_CONSOLE_PRINT_BODIES=true
 * (bootstrapping a site before Resend is set up; turn it off again after).
 */
export function consoleEmailPrintsBodies(): boolean {
  return !isProduction() || read("EMAIL_CONSOLE_PRINT_BODIES") === "true";
}

/**
 * The read-only demo admin's login (OpenShipKit's showcase only), or null when
 * off: DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD, both set and valid
 * (env-rules.ts). The password is a server secret: only POST /api/demo uses it,
 * to sign a visitor in; nothing renders it. src/server/demo.ts is the rest.
 */
export function demoAdminLogin(): { email: string; password: string } | null {
  // Named reads, so tests/env-example.test.ts sees both variables.
  if (!optionalEnv("DEMO_ADMIN_EMAIL") && !optionalEnv("DEMO_ADMIN_PASSWORD")) return null;
  return resolveDemoAdmin(process.env);
}

/**
 * Demo mode: no Postgres server configured — the embedded development
 * database (or the memory store). Shown as a banner in the admin; enables the
 * MCP dev key outside production. Never serve real users this way.
 */
export function isDemo(): boolean {
  return dataMode() !== "postgres";
}
