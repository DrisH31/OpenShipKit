//
// npm run setup — write your env file with generated secrets.
//
//   npm run setup                                   .env.local for `npm run dev`
//   npm run setup -- --compose                      .env for docker compose
//   npm run setup -- --compose --domain example.com --admin-email you@example.com
//   npm run setup -- --file path/to/.env.staging    any other file (compose mode with --compose)
//   npm run setup -- --compose --file .env.deploy --domain example.com   a server's .env, generated on a laptop
//   npm run setup -- --dry-run                      show what would change, write nothing
//   npm run setup -- --profile site                 a landing page + blog with no SaaS (OPENSHIPKIT_PROFILE=site)
//   npm run setup -- --billing stripe --email smtp --tenancy org   choose the providers up front
//   npm run setup -- --without blog,mcp             switch features off (OPENSHIPKIT_WITHOUT; nothing is deleted)
//   npm run setup -- -i                             ask, one question at a time (the default in a terminal
//                                                   when no options are given)
//
// The wizard (-i) asks the questions the flags answer: profile, billing,
// email, teams, the admin's email, and (compose) the domain. It never asks for
// a secret: API keys go into the file, not into a terminal's history. It ends
// with the exact keys each choice still needs. Without a terminal (CI, a pipe
// with no -i) it never prompts.
//
// What it does:
//   - Creates the file from .env.example, or merges into an existing one:
//     keys missing from your file are appended (with their comment), and
//     EMPTY values it knows how to fill are filled. A value you set is NEVER
//     changed — edit the file for that.
//   - Generates BETTER_AUTH_SECRET (32 random bytes) when empty; for compose
//     also POSTGRES_PASSWORD (hex — it goes into a URL unencoded); for
//     development also MCP_DEV_KEY (a local-only agent key).
//   - Compose, creating a NEW file with --domain: COMPOSE_PROJECT_NAME from the
//     domain (example.com → example-com), so two sites on one server never
//     share containers or a database volume.
//   - --profile site: OPENSHIPKIT_PROFILE=site and BILLING_PROVIDER=none, and
//     prints what that switches off. The profile is a switch, not a deletion:
//     nothing in the code is removed, so it can be switched back, and template
//     updates still merge. Deleting the SaaS code for good is a manual, listed
//     job (docs/site-profile.md) — too many shared files for a script to edit
//     safely.
//   - Backs the old file up to <file>.bak before changing it; writes mode 600.
//
// Non-obvious rules:
//   - Plain Node, no dependencies and no `@/` imports, so it also runs with
//     `node scripts/setup.mts` (Node 24, or 22.18+, strips the types) — on a server
//     without node_modules, or inside `docker run node:24-alpine`.
//   - Compose mode: --compose, or a file named exactly ".env".
//   - The flag is --file, not --env-file: Node itself claims --env-file
//     anywhere on its command line (even after the script) and exits when
//     the file doesn't exist yet.
//   - COMPOSE_PROJECT_NAME is only ever filled in a file setup creates. In an
//     existing .env it stays as it is (empty = "openshipkit"): a new project
//     name on a running site would start it on a new, empty database volume.
//   - Compose mode creating .env in a development checkout (git + node_modules)
//     prints a warning: Next.js loads .env in `npm run dev` too, so production
//     values generated on a laptop would leak into development. Use --file .env.deploy there
//     (git- and docker-ignored by `.env.*`, and never loaded by Next.js).
//

import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { argv, exit, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

interface Options {
  envFile: string;
  /** True when --file was given (not the default .env.local / .env). */
  fileGiven: boolean;
  compose: boolean;
  domain?: string;
  adminEmail?: string;
  siteUrl?: string;
  /** --profile: "saas" (the default product) or "site" (landing page + blog, no billing). */
  profile?: Profile;
  billing?: Billing;
  email?: Email;
  tenancy?: Tenancy;
  /** --without: features switched off (OPENSHIPKIT_WITHOUT). */
  without?: Feature[];
  /** -i, or a terminal with no options at all. */
  interactive: boolean;
  dryRun: boolean;
}

/** The app's choices, as env-rules.ts reads them (kept in step by tests/setup.test.ts). */
type Billing = "none" | "polar" | "stripe" | "razorpay";
const BILLINGS: readonly Billing[] = ["none", "polar", "stripe", "razorpay"];
type Email = "console" | "resend" | "smtp";
const EMAILS: readonly Email[] = ["console", "resend", "smtp"];
type Tenancy = "personal" | "org";
const TENANCIES: readonly Tenancy[] = ["personal", "org"];
/** What --without can switch off: src/core/profile.ts FEATURE_PATHS (tests/setup.test.ts keeps them equal). */
type Feature = "blog" | "mcp";
const FEATURES: readonly Feature[] = ["blog", "mcp"];

/** What each provider still needs in the file, and where it's explained. Never asked for: pasted into the file. */
const NEEDS: Record<Exclude<Billing, "none"> | Exclude<Email, "console">, { keys: string[]; doc: string }> = {
  polar: { keys: ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET"], doc: "docs/billing.md" },
  stripe: { keys: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], doc: "docs/billing.md#stripe-instead" },
  razorpay: { keys: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"], doc: "docs/billing.md#razorpay-instead-india" },
  resend: { keys: ["RESEND_API_KEY", "EMAIL_FROM"], doc: "docs/email.md" },
  smtp: { keys: ["SMTP_URL", "EMAIL_FROM"], doc: "docs/email.md" },
};

/** The app's profiles (OPENSHIPKIT_PROFILE). */
type Profile = "saas" | "site";
const PROFILES: readonly Profile[] = ["saas", "site"];

/** One `KEY=value` line of .env.example with the comment lines directly above it. */
interface TemplateEntry {
  key: string;
  value: string;
  comments: string[];
}

const HELP = `npm run setup — write your env file with generated secrets.

Usage: npm run setup -- [options]

  --compose              docker compose mode: writes .env (POSTGRES_PASSWORD, https site URL)
  --file <path>          file to create or merge (default .env.local, or .env with --compose)
  --domain <host>        your domain (compose): sets DOMAIN and NEXT_PUBLIC_SITE_URL=https://<host>
  --site-url <url>       NEXT_PUBLIC_SITE_URL, e.g. https://example.com
  --admin-email <email>  ADMIN_EMAILS: this address becomes an admin when it signs in
  --profile <saas|site>  OPENSHIPKIT_PROFILE. site = a landing page + blog with no SaaS
                         (no pricing, billing or plans); docs/site-profile.md
  --billing <none|polar|stripe|razorpay>   BILLING_PROVIDER (saas only)
  --email <console|resend|smtp>            EMAIL_PROVIDER
  --tenancy <personal|org>                 OPENSHIPKIT_TENANCY: org turns teams on (docs/teams.md)
  --without <blog,mcp>   switch features off: their pages answer 404 and every link to them goes
                         (OPENSHIPKIT_WITHOUT; nothing is deleted; docs/site-profile.md)
  -i, --interactive      ask the questions one at a time (the default in a terminal with no options)
  --dry-run              print what would change and write nothing
  -h, --help             this help

Values already set in the file are never changed.`;

function fail(message: string): never {
  console.error(`setup: ${message}`);
  exit(1);
}

function parseArgs(args: string[]): Options {
  const options: Options = { envFile: ".env.local", fileGiven: false, compose: false, interactive: false, dryRun: false };
  const choice = <T extends string>(flag: string, raw: string, allowed: readonly T[]): T => {
    const v = raw.toLowerCase();
    if (!allowed.includes(v as T)) fail(`${flag} "${raw}" must be one of: ${allowed.join(", ")}`);
    return v as T;
  };
  let composeFlag = false;
  let fileFlag = false;
  const value = (i: number, flag: string): string => {
    const v = args[i + 1];
    if (!v || v.startsWith("--")) fail(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [flag, inline] = arg.includes("=") && arg.startsWith("--") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const take = (): string => {
      if (inline !== undefined) return inline;
      const v = value(i, flag);
      i++;
      return v;
    };
    switch (flag) {
      case "--file":
        options.envFile = take();
        fileFlag = true;
        break;
      case "--":
        break;
      case "--compose":
        composeFlag = true;
        break;
      case "--domain":
        options.domain = take();
        break;
      case "--site-url":
        options.siteUrl = take();
        break;
      case "--admin-email":
        options.adminEmail = take();
        break;
      case "--profile": {
        const profile = take().toLowerCase();
        if (!PROFILES.includes(profile as Profile)) fail(`--profile "${profile}" must be one of: ${PROFILES.join(", ")}`);
        options.profile = profile as Profile;
        break;
      }
      case "--billing":
        options.billing = choice(flag, take(), BILLINGS);
        break;
      case "--email":
        options.email = choice(flag, take(), EMAILS);
        break;
      case "--tenancy":
        options.tenancy = choice(flag, take(), TENANCIES);
        break;
      case "--without": {
        const names = take().split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
        for (const n of names) if (!FEATURES.includes(n as Feature)) fail(`--without "${n}" must be one of: ${FEATURES.join(", ")}`);
        options.without = [...new Set(names)] as Feature[];
        break;
      }
      case "-i":
      case "--interactive":
        options.interactive = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-h":
      case "--help":
        console.log(HELP);
        exit(0);
        break;
      default:
        fail(`unknown option ${arg} (try --help)`);
    }
  }
  options.fileGiven = fileFlag;
  if (composeFlag && !fileFlag) options.envFile = ".env";
  options.compose = composeFlag || basename(options.envFile) === ".env";
  if (options.domain !== undefined) {
    const domain = options.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) fail(`--domain "${options.domain}" is not a host name like example.com`);
    options.domain = domain.toLowerCase();
  }
  if (options.siteUrl !== undefined) {
    if (!/^https?:\/\/[^/\s]+$/i.test(options.siteUrl.replace(/\/+$/, ""))) fail(`--site-url "${options.siteUrl}" must be an origin like https://example.com`);
    options.siteUrl = options.siteUrl.replace(/\/+$/, "");
  }
  if (options.adminEmail !== undefined && !EMAIL_RE.test(options.adminEmail)) {
    fail(`--admin-email "${options.adminEmail}" is not an email address`);
  }
  if (options.profile === "site" && options.billing && options.billing !== "none") fail(`--profile site sells nothing: it can't take --billing ${options.billing}`);
  // In a terminal with no options at all, ask. Never without a terminal (CI, a pipe), unless -i says so.
  if (args.filter((a) => a !== "--").length === 0 && stdin.isTTY) options.interactive = true;
  return options;
}

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/**
 * The wizard: one question at a time, each with the default in brackets (Enter takes it). Asks only
 * what the flags didn't answer, and only what applies (no billing question for a content site).
 * `ask` is injected so a test can answer from a script.
 */
async function interview(options: Options, ask: (question: string) => Promise<string>, existing: Map<string, string> = new Map()): Promise<void> {
  // A value the file already has isn't asked again (setup never changes a set value): said, and kept.
  const already = (key: string, label: string): boolean => {
    const v = existing.get(key);
    if (!v) return false;
    console.log(`${label}: ${v} (already in ${options.envFile}; edit the file to change it)`);
    return true;
  };
  const pick = async <T extends string>(question: string, allowed: readonly T[], fallback: T, help: string): Promise<T> => {
    for (;;) {
      const raw = (await ask(`${question} (${allowed.join(" / ")}) [${fallback}]: `)).trim().toLowerCase();
      if (!raw) return fallback;
      if (allowed.includes(raw as T)) return raw as T;
      console.log(`  Please answer one of: ${allowed.join(", ")}. ${help}`);
    }
  };
  console.log("A few questions; Enter takes the default in brackets. Nothing secret is asked: keys go into the file.");
  if (!already("OPENSHIPKIT_PROFILE", "Profile")) options.profile ??= await pick("Profile: a SaaS, or a landing page + blog with no billing?", PROFILES, "saas", "site = no pricing, billing or plans.");
  if ((options.profile ?? existing.get("OPENSHIPKIT_PROFILE") ?? "saas") === "saas") {
    if (!already("BILLING_PROVIDER", "Billing provider")) options.billing ??= await pick("Billing provider", BILLINGS, "none", "none = plans show, nothing can be bought yet.");
    if (!already("OPENSHIPKIT_TENANCY", "Accounts")) options.tenancy ??= await pick("Accounts: one person each, or teams (organisations with members)?", TENANCIES, "personal", "org = teams.");
  }
  if (!already("EMAIL_PROVIDER", "Email")) options.email ??= await pick("Email: print to the terminal (development), Resend, or your own SMTP server?", EMAILS, options.compose ? "resend" : "console", "");
  if (options.adminEmail === undefined && !already("ADMIN_EMAILS", "Admin")) {
    for (;;) {
      const raw = (await ask("Your email, to become the admin when you sign in [skip]: ")).trim();
      if (!raw) break;
      if (EMAIL_RE.test(raw)) {
        options.adminEmail = raw;
        break;
      }
      console.log("  That isn't an email address.");
    }
  }
  if (options.compose && options.domain === undefined && !already("DOMAIN", "Domain")) {
    const raw = (await ask("Your domain, like example.com [skip]: ")).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    if (raw && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) options.domain = raw;
    else if (raw) console.log("  That isn't a host name; set DOMAIN in the file later.");
  }
  console.log("");
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** The value part of a dotenv line, unquoted. Empty string when unset. */
function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0])) return v.slice(1, -1);
  // An inline comment after an unquoted value: KEY=value # note
  return v.replace(/\s+#.*$/, "");
}

function parseTemplate(text: string): TemplateEntry[] {
  const entries: TemplateEntry[] = [];
  let comments: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) {
      entries.push({ key: m[1], value: unquote(m[2]), comments });
      comments = [];
    } else if (line.trim().startsWith("#")) {
      comments.push(line);
    } else {
      comments = [];
    }
  }
  return entries;
}

/** Keys and values in an existing env file; the last assignment of a key wins, as in dotenv. */
function parseValues(lines: string[]): Map<string, { value: string; line: number }> {
  const values = new Map<string, { value: string; line: number }>();
  lines.forEach((line, index) => {
    const m = LINE.exec(line);
    if (m) values.set(m[1], { value: unquote(m[2]), line: index });
  });
  return values;
}

const secret = (bytes: number): string => randomBytes(bytes).toString("base64url");

/** A docker compose project name for a domain: lowercase letters, digits and dashes (example.com → example-com). */
function projectNameFor(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** What setup fills when a key is empty or missing, for this mode. `creating`: the file doesn't exist yet. */
/** A value setup would fill; `chosen` when it came from you (a flag or an answer), not generated. */
type Fill = { value: string; note: string; chosen?: boolean };

function fills(options: Options, creating: boolean): Map<string, Fill> {
  const out = new Map<string, Fill>();
  const choose = (key: string, value: string, note: string) => out.set(key, { value, note, chosen: true });
  out.set("BETTER_AUTH_SECRET", { value: secret(32), note: "generated (32 random bytes)" });
  if (options.compose) {
    out.set("POSTGRES_PASSWORD", { value: randomBytes(32).toString("hex"), note: "generated (64 hex characters)" });
    if (options.domain) choose("DOMAIN", options.domain, "your domain (--domain)");
    // Only in a new file: renaming the project of a running site would point it at an empty volume.
    if (options.domain && creating) {
      out.set("COMPOSE_PROJECT_NAME", { value: projectNameFor(options.domain), note: "from your domain (containers, images and the database volume are named after it)" });
    }
    const site = options.siteUrl ?? (options.domain ? `https://${options.domain}` : undefined);
    if (site) choose("NEXT_PUBLIC_SITE_URL", site, options.siteUrl ? "your site URL (--site-url)" : "from your domain");
  } else {
    if (options.siteUrl) choose("NEXT_PUBLIC_SITE_URL", options.siteUrl, "your site URL (--site-url)");
    else out.set("NEXT_PUBLIC_SITE_URL", { value: "http://localhost:3000", note: "development default" });
    // No agent key for an MCP server that's switched off.
    if (!options.without?.includes("mcp")) out.set("MCP_DEV_KEY", { value: `osk_${secret(32)}`, note: "generated (local-only agent key; ignored in production)" });
  }
  if (options.adminEmail) choose("ADMIN_EMAILS", options.adminEmail.toLowerCase(), "your admin email (--admin-email)");
  if (options.profile) choose("OPENSHIPKIT_PROFILE", options.profile, "your choice of profile (--profile)");
  // A content site sells nothing: billing stays off even if a Polar token is set later.
  if (options.profile === "site") choose("BILLING_PROVIDER", "none", "a content site sells nothing (no checkout, no webhooks)");
  else if (options.billing) choose("BILLING_PROVIDER", options.billing, "your choice of billing provider");
  if (options.email) choose("EMAIL_PROVIDER", options.email, "your choice of email");
  if (options.without?.length) choose("OPENSHIPKIT_WITHOUT", options.without.join(","), `switched off: ${options.without.join(", ")} (their pages answer 404)`);
  if (options.tenancy && options.profile !== "site") choose("OPENSHIPKIT_TENANCY", options.tenancy, options.tenancy === "org" ? "teams on (docs/teams.md)" : "one person per account");
  return out;
}

async function main(): Promise<void> {
  const options = parseArgs(argv.slice(2));
  if (options.interactive) {
    const tty = stdin.isTTY === true;
    const rl = createInterface({ input: stdin, output: stdout, terminal: tty });
    // Ctrl-C in a terminal is "stop", never "take the defaults": nothing is written.
    rl.on("SIGINT", () => {
      rl.close();
      stdout.write("\n");
      fail("cancelled; nothing written");
    });
    // Answers piped in (a test, a script) arrive faster than the questions: read them as lines, in order.
    const lines = rl[Symbol.asyncIterator]();
    try {
      const existing = existsSync(resolve(options.envFile))
        ? new Map([...parseValues(readFileSync(resolve(options.envFile), "utf8").split(/\r?\n/))].map(([k, v]) => [k, v.value]))
        : new Map<string, string>();
      await interview(
        options,
        async (question) => {
        stdout.write(question);
        const next = await lines.next();
        if (!tty) stdout.write("\n");
        // Input that ends early: in a terminal (Ctrl-D) it's a cancel; from a pipe, the rest take their defaults.
        if (next.done && tty) {
          stdout.write("\n");
          fail("cancelled; nothing written");
        }
        return next.done ? "" : String(next.value);
        },
        existing,
      );
    } finally {
      rl.close();
    }
  }
  const target = resolve(options.envFile);
  const templatePath = resolve(".env.example");
  if (!existsSync(templatePath)) fail("no .env.example here — run it from the project root (npm run setup does)");
  const template = parseTemplate(readFileSync(templatePath, "utf8"));
  const exists = existsSync(target);
  const original = exists ? readFileSync(target, "utf8") : readFileSync(templatePath, "utf8");
  const lines = original.replace(/\r?\n$/, "").split(/\r?\n/);
  const values = parseValues(lines);
  const toFill = fills(options, !exists);
  const changes: string[] = [];
  const kept: string[] = [];

  // 1. Fill empty values in place; leave every set value alone.
  for (const [key, fill] of toFill) {
    const current = values.get(key);
    if (current && current.value !== "") {
      if (fill.chosen && current.value !== fill.value) kept.push(`${key} is already set; kept it (edit ${options.envFile} to change it)`);
      continue;
    }
    if (current) {
      lines[current.line] = `${key}=${fill.value}`;
      values.set(key, { value: fill.value, line: current.line });
      changes.push(`${key}: ${fill.note}`);
    }
  }

  // 2. Append keys the file doesn't have yet (new in .env.example, or the fills above).
  const appended: string[] = [];
  for (const entry of template) {
    if (values.has(entry.key)) continue;
    const fill = toFill.get(entry.key);
    const value = fill?.value ?? entry.value;
    appended.push("", ...entry.comments.filter((c) => !/^#\s*[=-]{8,}/.test(c)), `${entry.key}=${value}`);
    values.set(entry.key, { value, line: -1 });
    changes.push(fill ? `${entry.key}: ${fill.note}` : `${entry.key}: added from .env.example${value ? ` (${value})` : " (empty)"}`);
  }
  for (const [key, fill] of toFill) {
    if (values.has(key)) continue;
    appended.push(`${key}=${fill.value}`);
    values.set(key, { value: fill.value, line: -1 });
    changes.push(`${key}: ${fill.note}`);
  }
  if (appended.length > 0) {
    if (exists) lines.push("", `# ---- added by npm run setup on ${new Date().toISOString().slice(0, 10)} (from .env.example)`);
    lines.push(...(exists ? appended : appended.slice(1)));
  }

  const next = `${lines.join("\n")}\n`;
  const mode = options.compose ? "docker compose" : "development";
  if (changes.length === 0) {
    console.log(`${options.envFile} (${mode}) is already complete — nothing to change.`);
  } else if (options.dryRun) {
    console.log(`Dry run: ${exists ? "would update" : "would create"} ${options.envFile} (${mode}):`);
    for (const c of changes) console.log(`  ${c}`);
  } else {
    if (exists) {
      copyFileSync(target, `${target}.bak`);
      chmodSync(`${target}.bak`, 0o600); // the backup holds the same secrets
    }
    writeFileSync(target, next, { mode: 0o600 });
    chmodSync(target, 0o600);
    console.log(`${exists ? "Updated" : "Created"} ${options.envFile} (${mode})${exists ? `; the previous version is in ${options.envFile}.bak` : ""}:`);
    for (const c of changes) console.log(`  ${c}`);
  }
  for (const k of kept) console.log(`  note: ${k}`);
  // A checkout with node_modules is a development machine (the guides' servers have no Node.js and run setup in a container).
  if (!exists && !options.dryRun && options.compose && !options.fileGiven && existsSync(resolve(".git")) && existsSync(resolve("node_modules"))) {
    console.log("");
    console.log(`  warning: ${options.envFile} is in a git checkout. If this is your development machine and not the server,`);
    console.log("  `npm run dev` now loads these production values (site URL, secret, admins). Delete it and run");
    console.log("  `npm run setup -- --compose --file .env.deploy …` instead, then copy .env.deploy to the server as .env.");
  }

  printNextSteps(options, values);
}

/** What OPENSHIPKIT_PROFILE=site switches off, for the person who just asked for it. */
function printSiteProfile(options: Options, profile: string): void {
  if (options.profile !== "site") return;
  console.log("");
  if (profile !== "site") {
    console.log(`Profile: ${options.envFile} already sets OPENSHIPKIT_PROFILE=${profile || "(empty)"}; kept it. Edit the file to switch.`);
    return;
  }
  console.log("Profile: site — a landing page + blog, no SaaS. With OPENSHIPKIT_PROFILE=site the app:");
  console.log("  - has no /pricing page (404) and no pricing section or plan cards on the landing page;");
  console.log("  - offers no checkout: /api/billing/* answer 404, BILLING_PROVIDER=none;");
  console.log("  - shows no Billing page or link in /dashboard, and no Plans in /admin or in MCP tools;");
  console.log("  - drops /pricing (and plan offers) from the navigation defaults, sitemap, JSON-LD and llms.txt.");
  console.log("  Sign-in, the dashboard, the blog, changelog, legal pages, contact form, admin and MCP stay.");
  console.log("  Nothing is deleted: set OPENSHIPKIT_PROFILE=saas (or empty) to switch back.");
  console.log("  To delete the SaaS code instead: docs/site-profile.md lists every file, in order.");
}

function printNextSteps(options: Options, values: Map<string, { value: string; line: number }>): void {
  const get = (key: string): string => values.get(key)?.value ?? "";
  printSiteProfile(options, get("OPENSHIPKIT_PROFILE"));
  const todo: string[] = [];
  if (!get("ADMIN_EMAILS")) todo.push(`Put your email in ADMIN_EMAILS in ${options.envFile} so your account becomes the admin.`);
  // What the chosen providers still need: pasted into the file, never asked for here.
  for (const choice of [get("BILLING_PROVIDER"), get("EMAIL_PROVIDER")]) {
    const need = NEEDS[choice as keyof typeof NEEDS];
    if (!need) continue;
    const missing = need.keys.filter((k) => !get(k));
    if (missing.length) todo.push(`${choice}: set ${missing.join(", ")} in ${options.envFile} (${need.doc}).`);
  }
  console.log("");
  if (options.compose) {
    if (!get("NEXT_PUBLIC_SITE_URL")) todo.push("Set NEXT_PUBLIC_SITE_URL to your public origin (https://example.com), or re-run with --domain — docker compose refuses to start without it.");
    if (!get("DOMAIN")) todo.push("Set DOMAIN (your bare host name) to use the bundled Caddy for HTTPS.");
    if (!get("RESEND_API_KEY") && !get("SMTP_URL")) todo.push("Add RESEND_API_KEY (or SMTP_URL for your own mail server) and EMAIL_FROM before the first sign-up: production requires a verified email (yours too, to become the admin), and without one the log shows only To and Subject, not the link. Neither yet? docs/email.md, \"verifying the first admin\".");
    if (basename(options.envFile) !== ".env") {
      todo.push(`Copy ${options.envFile} to the server as .env next to docker-compose.yml (or paste it into your PaaS), then delete this copy: scp ${options.envFile} server:/opt/openshipkit/.env`);
    }
    console.log("Next steps (docker compose):");
    todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    const n = todo.length;
    console.log(`  ${n + 1}. Point your domain's DNS A/AAAA records at this server.`);
    console.log(`  ${n + 2}. docker compose --profile https up -d --build     (or without --profile https behind your own proxy)`);
    console.log(`  ${n + 3}. Keep a copy of ${options.envFile} in your password manager — losing BETTER_AUTH_SECRET signs everyone out.`);
    console.log("  Guide: deploy/vps/README.md");
  } else {
    console.log("Next steps (development):");
    todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    const n = todo.length;
    console.log(`  ${n + 1}. npm run dev, then open ${get("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000"}`);
    console.log("     No DATABASE_URL: the embedded Postgres in .data/pglite is used, migrated and seeded on first boot.");
    if (get("MCP_DEV_KEY") && !get("OPENSHIPKIT_WITHOUT").split(",").map((f) => f.trim()).includes("mcp")) {
      console.log(`  ${n + 2}. Connect an agent: /api/mcp with MCP_DEV_KEY as the bearer token. For this repo's .mcp.json:`);
      console.log(`       export OPENSHIPKIT_MCP_KEY=<MCP_DEV_KEY from ${options.envFile}>   (docs/mcp.md)`);
    }
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
