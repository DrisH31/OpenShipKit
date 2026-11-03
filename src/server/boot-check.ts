//
// The production boot check, run once by src/instrumentation.ts's register()
// in the Node.js runtime only. It refuses to start without what every request
// needs — DATABASE_URL (unless an embedded database is opted into with
// OPENSHIPKIT_ALLOW_EMBEDDED_DB=true; DATA_PROVIDER=memory is refused: unit
// tests only), a BETTER_AUTH_SECRET of 32+ random characters, and
// RESEND_API_KEY when EMAIL_PROVIDER=resend, a well-formed SMTP_URL and an
// EMAIL_FROM when it is smtp, and the read-only demo admin's
// DEMO_ADMIN_EMAIL + DEMO_ADMIN_PASSWORD both or neither — and warns loudly about a missing
// or local NEXT_PUBLIC_SITE_URL and about email going to the log. An unknown
// OPENSHIPKIT_PROFILE is fatal (every request would throw on it); the site
// profile with Polar configured is a warning: billing stays off. It reads
// process.env only, through the same rules the server uses
// (src/server/env-rules.ts), so the check can't disagree with what runs.
//
// Its own module, loaded with a dynamic import behind NEXT_RUNTIME === "nodejs",
// because Next also compiles instrumentation for the Edge runtime, which has no
// process.exit: kept inline, every dev request logged an Edge-runtime warning.
//

import "server-only";
import { isLocalHost } from "@/lib/site-url";
import {
  BILLING_KEYS,
  demoAdminProblems,
  parseSmtpUrl,
  readEnv,
  resolveBillingProvider,
  resolveDataMode,
  resolveEmailProvider,
  resolveMediaStorage,
  resolveProfile,
  weakAuthSecretReason,
} from "@/server/env-rules";
import { log } from "@/server/log";

/** Exits the process when production is missing something every request needs; warns about the rest. */
export function checkProductionEnv(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return; // `next build` has no secrets, by design
  const env = (name: string) => readEnv(process.env, name) ?? "";

  const fatal: string[] = [];
  /** A provider rule that throws (an unknown EMAIL_PROVIDER, say) is a fatal line, not a crash with a stack. */
  const rule = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch (error) {
      fatal.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const dataMode = rule(() => resolveDataMode(process.env));
  if (dataMode === "memory") {
    fatal.push("DATA_PROVIDER=memory is for unit tests only: every restart wipes users, posts and payments. Unset it and set DATABASE_URL.");
  } else if (dataMode === "embedded-postgres" && env("OPENSHIPKIT_ALLOW_EMBEDDED_DB") !== "true") {
    fatal.push("DATABASE_URL is not set. Production needs a Postgres server (see docker-compose.yml and docs/deployment.md).");
  }
  // The key that signs sessions: the newest of BETTER_AUTH_SECRETS when a rotation is under way
  // (docs/auth.md), else BETTER_AUTH_SECRET. Once rotated, the old secret only decrypts earlier
  // two-factor data and can't be changed without breaking it, so a weak one there is a warning.
  const versioned = env("BETTER_AUTH_SECRETS");
  if (versioned) {
    const newest = versioned.split(",")[0]?.split(":").slice(1).join(":");
    const weak = weakAuthSecretReason(newest)?.replaceAll("BETTER_AUTH_SECRET", "The newest key in BETTER_AUTH_SECRETS");
    if (weak) fatal.push(`${weak} It signs every session: generate one with \`openssl rand -base64 32\`.`);
    if (!env("BETTER_AUTH_SECRET")) {
      fatal.push("BETTER_AUTH_SECRET is not set. Keep it during a rotation: it decrypts the two-factor secrets stored before the first one.");
    } else if (weakAuthSecretReason(env("BETTER_AUTH_SECRET"))) {
      log.warn("openshipkit", "BETTER_AUTH_SECRET is weak. It now only decrypts older two-factor secrets; retire it once every user has set up 2FA again (docs/auth.md).");
    }
  } else {
    const weak = weakAuthSecretReason(env("BETTER_AUTH_SECRET"));
    if (weak) fatal.push(`${weak} It signs every session: generate one with \`openssl rand -base64 32\` (\`npm run setup\` writes it).`);
  }
  const email = rule(() => resolveEmailProvider(process.env));
  if (email === "resend" && !env("RESEND_API_KEY")) {
    fatal.push("EMAIL_PROVIDER=resend but RESEND_API_KEY is not set: the first sign-up's verification email would fail. Set the key, or unset EMAIL_PROVIDER.");
  }
  if (email === "smtp") {
    const smtpUrl = env("SMTP_URL");
    if (!smtpUrl) fatal.push("EMAIL_PROVIDER=smtp but SMTP_URL is not set: the first sign-up's verification email would fail. Set it, or unset EMAIL_PROVIDER.");
    else rule(() => parseSmtpUrl(smtpUrl));
    // The default sender is Resend's test address: over your own SMTP server it would be refused or land in spam.
    if (!env("EMAIL_FROM")) fatal.push("SMTP needs EMAIL_FROM: a name and an address on a domain your SMTP server may send for (docs/email.md).");
  }
  const profile = rule(() => resolveProfile(process.env));
  // A malformed BILLING_PROVIDER throws on every billing read, in either profile: fatal here, like EMAIL_PROVIDER.
  const paid = profile ? rule(() => resolveBillingProvider(process.env)) : null;
  // The provider in use needs its key and its webhook secret: without the secret every webhook is
  // refused, and nobody who pays ever gets access.
  if (paid && paid !== "none") {
    for (const name of [BILLING_KEYS[paid].key, BILLING_KEYS[paid].webhookSecret, ...(paid === "razorpay" ? ["RAZORPAY_KEY_SECRET"] : [])]) {
      if (!env(name)) fatal.push(`BILLING_PROVIDER is ${paid} but ${name} is not set (docs/billing.md).`);
    }
  }
  // Metered metrics with no meters to send them to: counted and limited here, never charged.
  if (env("BILLING_METERED_METRICS") && paid !== "polar" && paid !== "stripe") {
    log.warn("openshipkit", `BILLING_METERED_METRICS is set but billing is ${paid ?? "off"}: usage is counted here and never reported. Metered prices need Polar or Stripe (docs/usage.md).`);
  }
  // Uploads in a bucket: every variable it needs, now rather than at the first upload.
  if (rule(() => resolveMediaStorage(process.env)) === "s3") {
    for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      if (!env(name)) fatal.push(`MEDIA_STORAGE is s3 but ${name} is not set (docs/content.md#media-library).`);
    }
  }
  // The read-only demo admin (showcase only): half-configured, or a short password, is refused rather than silently off.
  fatal.push(...demoAdminProblems(process.env));
  if (fatal.length > 0) {
    for (const line of fatal) log.error("openshipkit", line);
    log.error("openshipkit", "Refusing to start. Every variable is described in .env.example.");
    process.exit(1);
  }

  const site = env("NEXT_PUBLIC_SITE_URL");
  if (!site) {
    log.error(
      "openshipkit",
      "NEXT_PUBLIC_SITE_URL is not set: canonicals, the sitemap, robots.txt, Open Graph tags and email links will all point at http://localhost:3000. Set it to your public https:// origin.",
    );
  } else {
    let host = "";
    let protocol = "";
    try {
      ({ hostname: host, protocol } = new URL(site));
    } catch {
      log.error("openshipkit", `NEXT_PUBLIC_SITE_URL="${site}" is not a URL. Set it to your public https:// origin.`);
    }
    if (host && env("OPENSHIPKIT_ALLOW_LOCALHOST_URL") !== "true") {
      // The same host list as the dashboard's setup checklist (src/lib/site-url.ts).
      if (isLocalHost(host)) {
        log.warn(
          "openshipkit",
          `NEXT_PUBLIC_SITE_URL is ${site}: search engines and emails will get local links. Fine for a local production test (OPENSHIPKIT_ALLOW_LOCALHOST_URL=true silences this); set your public origin before going live.`,
        );
      } else if (protocol !== "https:") {
        log.warn("openshipkit", `NEXT_PUBLIC_SITE_URL is ${site}, not https://. Serve the site over HTTPS and use that origin.`);
      }
    }
  }

  if (profile === "site") {
    // The profile wins over Polar keys (env-rules.ts); say so, so nobody waits for a webhook that 404s.
    const polar = [
      env("BILLING_PROVIDER") && env("BILLING_PROVIDER") !== "none" ? `BILLING_PROVIDER=${env("BILLING_PROVIDER")}` : "",
      ...Object.values(BILLING_KEYS).map((k) => (env(k.key) ? k.key : "")),
    ].filter(Boolean);
    if (polar.length) {
      log.warn("openshipkit", `OPENSHIPKIT_PROFILE=site switches billing off, so ${polar.join(" and ")} ${polar.length === 1 ? "is" : "are"} ignored and /api/billing/* answer 404. Unset ${polar.length === 1 ? "it" : "them"}, or set OPENSHIPKIT_PROFILE=saas to sell (docs/site-profile.md).`);
    } else {
      log.info("openshipkit", "OPENSHIPKIT_PROFILE=site: a landing page + blog with no pricing, billing or plans (docs/site-profile.md).");
    }
  }

  if (email === "console") {
    log.warn(
      "openshipkit",
      env("RESEND_API_KEY")
        ? "EMAIL_PROVIDER=console although RESEND_API_KEY is set: messages go to the server log (To and Subject only) and are not sent. Unset EMAIL_PROVIDER to send with Resend."
        : env("SMTP_URL")
          ? "EMAIL_PROVIDER=console although SMTP_URL is set: messages go to the server log (To and Subject only) and are not sent. Unset EMAIL_PROVIDER to send over SMTP."
          : "No email provider: messages go to the server log (To and Subject only) and are not sent. Set RESEND_API_KEY, or SMTP_URL for your own mail server, so people can verify their email and reset passwords.",
    );
  }
}
