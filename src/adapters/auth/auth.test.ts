//
// Better Auth, end to end on the database the app really uses: embedded
// Postgres (PGlite, in memory here) with the /drizzle migrations applied and
// the Postgres DataStore behind getCurrentUser(). Covers sign-up → session →
// Identity → admin promotion → sign-out, verification, reset, two-factor
// (TOTP + backup codes), session listing/revocation, password change, the
// database-backed rate limiter, the proxy, error copy and the email templates.
//
// Two-factor needs auth_user.two_factor_enabled and auth_two_factor. If the
// migrations don't have them yet, this file adds them (IF NOT EXISTS) and
// passes matching Drizzle tables, so the adapter code is tested either way.
//

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { EmailMessage } from "@/core/email";
import { DEFAULT_CONTENT } from "@/content/defaults";
import * as schema from "@/adapters/data/postgres/schema";
import type { Db } from "@/adapters/data/postgres/db";
import { IDLE, type AuthFormState } from "@/core/auth-forms";

const pg = vi.hoisted(() => ({ db: null as unknown, tables: null as unknown }));
const sent: EmailMessage[] = [];
let requestHeaders = new Headers();

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock("@/server/email", () => ({
  sendEmail: async (message: EmailMessage) => {
    sent.push(message);
    return { id: null };
  },
}));
vi.mock("@/server/services/content", () => ({ getContent: async (key: "site") => DEFAULT_CONTENT[key] }));
vi.mock("@/adapters/data/postgres/db", () => ({
  getDrizzle: () => pg.db,
  // A getter: the instance imports the ban check, which may load this mock
  // before beforeAll has chosen the tables (resetModules keeps mocked modules).
  get authTables() {
    return pg.tables;
  },
  closeDrizzle: async () => {},
  isEmbeddedDatabase: () => true,
}));
vi.mock("@/server/data", async () => {
  const { createPostgresStore } = await import("@/adapters/data/postgres");
  return { getData: async () => createPostgresStore({ db: pg.db as Db }) };
});
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => {
    const jar = new Map(
      (requestHeaders.get("cookie") ?? "")
        .split(/;\s*/)
        .filter(Boolean)
        .map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)] as const),
    );
    return { get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: () => {} };
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// React's cache() is a request-scoped memo; in tests run the function each time.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const BASE = "http://localhost:3000";
const ENV_KEYS = [
  "AUTH_RATE_LIMIT",
  "AUTH_MAGIC_LINK",
  "AUTH_REQUIRE_EMAIL_VERIFICATION",
  "ADMIN_EMAILS",
  "DATA_PROVIDER",
  "DATABASE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "BETTER_AUTH_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];
const saved: Record<string, string | undefined> = {};
const PASSWORD = "long-enough-1";
let client: PGlite;
let counter = 0;

/** A fresh address per test, so tests never share accounts. */
function newEmail(tag: string): string {
  counter += 1;
  return `${tag}-${counter}@example.com`;
}

// Mirrors of what the two-factor plugin needs, used only if the migrations lack them.
const authTs = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const userWithTwoFactor = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: authTs("created_at").notNull().defaultNow(),
  updatedAt: authTs("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
});
const twoFactorTable = pgTable(
  "auth_two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => userWithTwoFactor.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: authTs("locked_until"),
  },
  (t) => [index("auth_two_factor_user_id_idx").on(t.userId)],
);

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: resolve("drizzle") });
  const { schemaSupportsTwoFactor } = await import("./better-auth/instance");
  const tables: Record<string, unknown> = schema.authTables;
  if (schemaSupportsTwoFactor(tables)) {
    pg.tables = tables;
  } else {
    await client.exec(`
      ALTER TABLE auth_user ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;
      CREATE TABLE IF NOT EXISTS auth_two_factor (
        id text PRIMARY KEY,
        secret text NOT NULL,
        backup_codes text NOT NULL,
        user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
        verified boolean NOT NULL DEFAULT true,
        failed_verification_count integer NOT NULL DEFAULT 0,
        locked_until timestamptz
      );
      CREATE INDEX IF NOT EXISTS auth_two_factor_user_id_idx ON auth_two_factor (user_id);
    `);
    pg.tables = { ...tables, user: userWithTwoFactor, twoFactor: twoFactorTable };
  }
  pg.db = db;
}, 60_000);

afterAll(async () => {
  await client?.close();
});

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.DATA_PROVIDER = "postgres";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0000";
  sent.length = 0;
  requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7" });
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function request(method: "GET" | "POST", path: string, body?: unknown, opts: { cookie?: string; ua?: string } = {}): Request {
  return new Request(`${BASE}/api/auth${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: BASE,
      "x-forwarded-for": "203.0.113.7",
      "user-agent": opts.ua ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const post = (path: string, body: unknown, opts?: { cookie?: string; ua?: string }) => request("POST", path, body, opts);

let ipCounter = 0;
/** A fresh client address per call, so only per-account limits apply (never the per-IP ones). */
function nextIp(): string {
  ipCounter += 1;
  return `198.18.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** post() from a given client address. */
function postFrom(ip: string, path: string, body: unknown): Request {
  const base = post(path, body);
  const headers = new Headers(base.headers);
  headers.set("x-forwarded-for", ip);
  return new Request(base, { headers });
}

/** The cookies a response sets, as a Cookie header (deleted ones dropped). */
function cookieFrom(response: Response, previous = ""): string {
  const jar = new Map(previous.split("; ").filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c] as const));
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (!value || /max-age=0/i.test(raw)) jar.delete(name);
    else jar.set(name, pair);
  }
  return [...jar.values()].join("; ");
}

/** Only the session token: bypasses the signed cookie cache, so the database decides. */
function tokenOnly(cookie: string): string {
  return cookie
    .split("; ")
    .filter((c) => c.startsWith("better-auth.session_token="))
    .join("; ");
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Redirect) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

/** RFC 6238 TOTP from the base32 secret an authenticator app reads from the otpauth URI. */
function totpFor(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function loadAuth() {
  const { getBetterAuth } = await import("./better-auth/instance");
  return getBetterAuth();
}

async function signUp(address: string, name = "Test Person"): Promise<{ cookie: string; userId: string }> {
  const auth = await loadAuth();
  const res = await auth.handler(post("/sign-up/email", { email: address, password: PASSWORD, name }));
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  return { cookie: cookieFrom(res), userId: user.id };
}

async function sessionOf(cookie: string): Promise<{ user: { email: string } } | null> {
  const auth = await loadAuth();
  const res = await auth.handler(request("GET", "/get-session", undefined, { cookie }));
  return (await res.json()) as { user: { email: string } } | null;
}

// ---------------------------------------------------------------------------

describe("email templates", () => {
  it("escapes input, keeps a plain-text twin, and drops non-http links", async () => {
    const { renderEmail } = await import("@/server/email-templates");
    const out = renderEmail({
      productName: "Acme <script>",
      preheader: "p",
      heading: "Hi & welcome",
      paragraphs: ["Line with <b>html</b>"],
      action: { label: "Go", url: "https://example.com/a?b=1&c=2" },
    });
    expect(out.html).toContain("Acme &lt;script&gt;");
    expect(out.html).toContain("Line with &lt;b&gt;html&lt;/b&gt;");
    expect(out.html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(out.html).toContain('name="color-scheme" content="light dark"');
    expect(out.html).toContain('<html lang="en">');
    expect(out.text).toContain("Go: https://example.com/a?b=1&c=2");
    expect(out.text).toContain("Line with <b>html</b>");
    expect(out.text).not.toContain("&lt;");

    const bad = renderEmail({ productName: "A", preheader: "", heading: "H", paragraphs: [], action: { label: "x", url: "javascript:alert(1)" } });
    expect(bad.html).not.toContain("javascript:");
  });

  it("names the product from site content in every template", async () => {
    const t = await import("@/server/email-templates");
    const name = DEFAULT_CONTENT.site.name;
    const all = await Promise.all([
      t.verifyEmailTemplate({ url: `${BASE}/v`, name: "Ada Lovelace" }),
      t.resetPasswordTemplate({ url: `${BASE}/r` }),
      t.magicLinkTemplate({ url: `${BASE}/m` }),
      t.magicLinkTwoFactorTemplate({ signInUrl: `${BASE}/sign-in` }),
      t.welcomeTemplate({ name: null }),
      t.notificationTemplate({ subject: "Your invoice", paragraphs: ["It’s ready."] }),
      t.securityNoticeTemplate({ kind: "two-factor-enabled", name: "Ada" }),
      t.existingAccountTemplate({ signInUrl: `${BASE}/sign-in`, resetUrl: `${BASE}/auth/forgot-password` }),
    ]);
    for (const e of all) {
      expect(e.subject.length).toBeGreaterThan(0);
      expect(e.html).toContain(name);
      expect(e.text).toContain(name);
    }
    // The confirmation email greets no one by name: the name was typed by whoever signed up.
    expect(all[0].text).toContain("Hi,");
    expect(all[0].text).not.toContain("Ada");
    expect(all[6].text).toContain("Hi Ada,");
  });

  it("greets only by a first word that is plainly a name, never a link", async () => {
    const { greeting, resetPasswordTemplate } = await import("@/server/email-templates");
    expect(greeting("Ada Lovelace")).toBe("Hi Ada,");
    expect(greeting("Zoë")).toBe("Hi Zoë,");
    expect(greeting("Jean-Luc Picard")).toBe("Hi Jean-Luc,");
    expect(greeting("O’Brien")).toBe("Hi O’Brien,");
    expect(greeting("李")).toBe("Hi 李,");
    for (const name of ["https://evil.example/claim", "www.evil.example", "evil.example", "victim@example.com", "12345", "", null, undefined]) {
      expect(greeting(name)).toBe("Hi,");
    }
    const reset = await resetPasswordTemplate({ url: `${BASE}/r`, name: "https://evil.example/claim now" });
    expect(reset.text).not.toContain("evil.example");
    expect(reset.html).not.toContain("evil.example");
  });
});

describe("better-auth proxy", () => {
  it("redirects signed-out visitors to sign-in with the full return path", async () => {
    const { proxy } = await import("./better-auth/proxy");
    const res = (await proxy(new NextRequest(`${BASE}/dashboard/billing?tab=plans`), {} as never)) as Response;
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/sign-in");
    expect(loc.searchParams.get("redirect")).toBe("/dashboard/billing?tab=plans");
  });

  it("lets through a request with a session cookie, public pages, and every /api route", async () => {
    const { proxy } = await import("./better-auth/proxy");
    const withCookie = new NextRequest(`${BASE}/admin`, { headers: { cookie: "better-auth.session_token=abc.def" } });
    for (const req of [withCookie, new NextRequest(`${BASE}/pricing`), new NextRequest(`${BASE}/api/admin/anything`), new NextRequest(`${BASE}/dashboards`)]) {
      const res = (await proxy(req, {} as never)) as Response;
      expect(res.headers.get("location")).toBeNull();
    }
  });
});

describe("error copy and device labels", () => {
  it("maps Better Auth codes and never leaks unknown errors", async () => {
    const { ACCOUNT_OVERRIDES, messageFor, messageForCode } = await import("./better-auth/errors");
    expect(messageFor({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } })).toMatch(/don’t match/);
    expect(messageFor({ body: { code: "INVALID_PASSWORD" } }, ACCOUNT_OVERRIDES)).toBe("That password isn’t right.");
    expect(messageFor({ body: { code: "INVALID_CODE" } })).toMatch(/code isn’t right/);
    expect(messageFor({ status: 429 })).toMatch(/Too many/);
    expect(messageFor(new Error("ECONNREFUSED 10.0.0.1"))).not.toMatch(/ECONNREFUSED/);
    expect(messageForCode("TOKEN_EXPIRED")).toMatch(/expired/);
    expect(messageForCode(undefined)).toBeNull();
  });

  it("labels user agents", async () => {
    const { describeUserAgent } = await import("./better-auth/device");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge on Windows");
    expect(describeUserAgent(null)).toBe("Unknown device");
  });
});

describe("better-auth on embedded Postgres", () => {
  it("signs up, reads the session as an Identity, promotes ADMIN_EMAILS, and signs out", async () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    const auth = await loadAuth();

    const res = await auth.handler(post("/sign-up/email", { email: "Admin@Example.com", password: PASSWORD, name: "Ada Admin" }));
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toContain("better-auth.session_token=");

    // The verification email links to the result page, not the bare home page.
    const verify = sent.find((m) => m.subject.startsWith("Confirm your email"));
    expect(verify?.to).toBe("admin@example.com");
    expect(verify?.text).toContain("callbackURL=%2Fauth%2Fverify-email");

    requestHeaders = new Headers({ cookie });
    const { adapter } = await import("./better-auth/server");
    const identity = await adapter.getIdentity();
    expect(identity).toMatchObject({ provider: "better-auth", email: "admin@example.com", name: "Ada Admin", emailVerified: false });

    const { getCurrentUser } = await import("@/server/session");
    const user = await getCurrentUser();
    expect(user?.role).toBe("admin");
    expect(user?.authProviderUserId).toBe(identity?.providerUserId);

    // The rows are in Postgres.
    const rows = await client.query<{ n: number }>("select count(*)::int as n from auth_session s join auth_user u on u.id = s.user_id where u.email = 'admin@example.com'");
    expect(rows.rows[0].n).toBe(1);

    const out = await auth.handler(post("/sign-out", {}, { cookie }));
    expect(out.status).toBe(200);
    expect(await sessionOf(tokenOnly(cookie))).toBeNull();
  });

  it("returns null for no cookie and a forged one", async () => {
    const { adapter } = await import("./better-auth/server");
    expect(await adapter.getIdentity()).toBeNull();
    requestHeaders = new Headers({ cookie: "better-auth.session_token=forged.token" });
    expect(await adapter.getIdentity()).toBeNull();
  });

  it("deleteIdentity removes the auth user and its sessions", async () => {
    const address = newEmail("gone");
    const { cookie, userId } = await signUp(address);
    const { adapter } = await import("./better-auth/server");
    await adapter.deleteIdentity!(userId);

    requestHeaders = new Headers({ cookie: tokenOnly(cookie) });
    expect(await adapter.getIdentity()).toBeNull();
    const auth = await loadAuth();
    const again = await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD }));
    expect(again.status).toBe(401);
  });

  it("rate-limits repeated sign-in attempts in the database when enabled", async () => {
    process.env.AUTH_RATE_LIMIT = "true";
    const auth = await loadAuth();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await auth.handler(post("/sign-in/email", { email: "nobody@example.com", password: "wrong-password" }))).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const rows = await (pg.db as Db).execute(sql`select count(*)::int as n from auth_rate_limit`);
    expect(Number((rows as unknown as { rows: { n: number }[] }).rows[0].n)).toBeGreaterThan(0);
  });

  it("the server actions rate-limit too (they bypass Better Auth's HTTP limiter)", async () => {
    process.env.AUTH_RATE_LIMIT = "true";
    requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.77" });
    const { signInAction } = await import("./better-auth/actions");
    const results: AuthFormState[] = [];
    for (let i = 0; i < 11; i++) results.push(await signInAction(IDLE, form({ email: "nobody@example.com", password: "wrong-password" })));
    expect(results[0].message).toMatch(/don’t match/);
    expect(results.at(-1)?.message).toMatch(/Too many attempts/);
  });

  it("limits wrong passwords per account whatever the IP, says the same for an address with no account, and a reset ends it", async () => {
    process.env.AUTH_RATE_LIMIT = "true";
    const { PASSWORD_ATTEMPTS } = await import("./better-auth/throttle");
    const address = newEmail("guessed");
    await signUp(address);
    const auth = await loadAuth();
    const signIn = (email: string, password: string) => auth.handler(postFrom(nextIp(), "/sign-in/email", { email, password }));

    // Right passwords are handed back: only wrong ones count.
    for (let i = 0; i < PASSWORD_ATTEMPTS.max + 2; i++) expect((await signIn(address, PASSWORD)).status).toBe(200);

    for (const email of [address, newEmail("no-account")]) {
      for (let i = 0; i < PASSWORD_ATTEMPTS.max; i++) expect((await signIn(email, "wrong-password")).status).toBe(401);
      const locked = await signIn(email, "wrong-password");
      expect(locked.status).toBe(429);
      expect(((await locked.json()) as { code?: string }).code).toBe("TOO_MANY_PASSWORD_ATTEMPTS");
    }
    // Locked means locked, even with the right password, and through the server action too.
    expect((await signIn(address, PASSWORD)).status).toBe(429);
    requestHeaders = new Headers({ "x-forwarded-for": nextIp() });
    const { signInAction, resetPasswordAction } = await import("./better-auth/actions");
    expect((await signInAction(IDLE, form({ email: address, password: PASSWORD }))).message).toMatch(/Too many wrong passwords/);
    // The key holds no address.
    const keys = await client.query<{ key: string }>("select key from auth_rate_limit where key like 'throttle:%'");
    expect(keys.rows.length).toBeGreaterThan(0);
    expect(keys.rows.some((r) => r.key.includes("@"))).toBe(false);

    // Proving the inbox (a password reset) ends the lockout.
    await auth.handler(postFrom(nextIp(), "/request-password-reset", { email: address, redirectTo: "/auth/reset-password" }));
    const link = sent.findLast((m) => m.to === address && m.subject.startsWith("Reset your"))?.text.match(/https?:\/\/\S+/)?.[0];
    const follow = await auth.handler(new Request(link!));
    const token = new URL(follow.headers.get("location")!, BASE).searchParams.get("token");
    requestHeaders = new Headers({ "x-forwarded-for": nextIp() });
    expect((await resetPasswordAction(IDLE, form({ token: token!, password: "a-new-password-2", confirm: "a-new-password-2" }))).status).toBe("done");
    expect((await signIn(address, "a-new-password-2")).status).toBe(200);
  }, 60_000); // ~35 password hashes

  it("limits wrong current passwords on the signed-in forms per account", async () => {
    process.env.AUTH_RATE_LIMIT = "true";
    const { PASSWORD_ATTEMPTS } = await import("./better-auth/throttle");
    const { cookie } = await signUp(newEmail("stolen-cookie"));
    const { changePassword } = await import("./better-auth/actions");
    const attempt = () => {
      requestHeaders = new Headers({ cookie, "x-forwarded-for": nextIp() });
      return changePassword(IDLE, form({ currentPassword: "a-guess-at-it", newPassword: "a-new-password-3", confirm: "a-new-password-3" }));
    };
    for (let i = 0; i < PASSWORD_ATTEMPTS.max; i++) expect((await attempt()).fieldErrors?.currentPassword).toMatch(/isn’t right/);
    expect((await attempt()).message).toMatch(/Too many wrong passwords/);
  }, 30_000);

  it("caps other email per address quietly, and refuses link asks out loud past a few an hour, for any address alike", async () => {
    process.env.AUTH_RATE_LIMIT = "true";
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "true";
    const { EMAILS_PER_ADDRESS, LINK_REQUESTS_PER_ADDRESS } = await import("./better-auth/throttle");
    const address = newEmail("flooded");
    await signUp(address); // the confirmation email counts against the quiet limit
    const auth = await loadAuth();

    // Signing up again with the taken address: "you already have an account" notes, quietly capped.
    for (let i = 0; i < EMAILS_PER_ADDRESS.max + 2; i++) {
      expect((await auth.handler(postFrom(nextIp(), "/sign-up/email", { email: address, password: PASSWORD, name: "Someone" }))).status).toBe(200);
    }
    expect(sent.filter((m) => m.to === address)).toHaveLength(EMAILS_PER_ADDRESS.max);

    // That can't use up the owner's reset links. Asking is counted for any
    // address, account or not, and past the limit the answer says so.
    const ask = (email: string) => auth.handler(postFrom(nextIp(), "/request-password-reset", { email, redirectTo: "/auth/reset-password" }));
    for (const email of [address, newEmail("no-account")]) {
      for (let i = 0; i < LINK_REQUESTS_PER_ADDRESS.max; i++) expect((await ask(email)).status).toBe(200);
      const refused = await ask(email);
      expect(refused.status).toBe(429);
      expect(((await refused.json()) as { code?: string }).code).toBe("TOO_MANY_EMAILS");
    }
    expect(sent.filter((m) => m.to === address && m.subject.startsWith("Reset your"))).toHaveLength(LINK_REQUESTS_PER_ADDRESS.max);

    // The forms say so too.
    requestHeaders = new Headers({ "x-forwarded-for": nextIp() });
    const { forgotPasswordAction, resendVerificationAction } = await import("./better-auth/actions");
    expect((await forgotPasswordAction(IDLE, form({ email: address }))).message).toMatch(/Too many emails/);
    requestHeaders = new Headers({ "x-forwarded-for": nextIp() });
    expect((await resendVerificationAction(IDLE, form({ email: address }))).message).toMatch(/Too many emails/);
  }, 30_000);

  it("a browser that has proved the password still signs in while strangers lock the account, and a reset proves a new one", async () => {
    process.env.AUTH_RATE_LIMIT = "true";
    const { PASSWORD_ATTEMPTS } = await import("./better-auth/throttle");
    const address = newEmail("known-device");
    await signUp(address);
    const auth = await loadAuth();
    const KNOWN = "better-auth.known_device=";
    const known = (res: Response) => cookieFrom(res).split("; ").filter((c) => c.startsWith(KNOWN)).join("; ");
    const signIn = (password: string, cookie = "") => {
      const base = postFrom(nextIp(), "/sign-in/email", { email: address, password });
      const headers = new Headers(base.headers);
      if (cookie) headers.set("cookie", cookie);
      return auth.handler(new Request(base, { headers }));
    };
    const lockOut = async () => {
      for (let i = 0; i < PASSWORD_ATTEMPTS.max; i++) await signIn("wrong-password");
      expect((await signIn(PASSWORD)).status).toBe(429);
    };

    const laptop = known(await signIn(PASSWORD));
    expect(laptop).toContain(KNOWN);
    await lockOut();
    // The laptop is counted on its own: the right password works...
    expect((await signIn(PASSWORD, laptop)).status).toBe(200);
    // ...a forged cookie is just a stranger...
    expect((await signIn(PASSWORD, laptop.replace(/\.([^.]*)$/, ".forged"))).status).toBe(429);
    // ...and the laptop's own wrong passwords still hit a wall.
    for (let i = 0; i < PASSWORD_ATTEMPTS.max; i++) expect((await signIn("wrong-password", laptop)).status).toBe(401);
    expect((await signIn(PASSWORD, laptop)).status).toBe(429);

    // A reset from a new phone proves the inbox: the phone becomes known.
    await auth.handler(postFrom(nextIp(), "/request-password-reset", { email: address, redirectTo: "/auth/reset-password" }));
    const link = sent.findLast((m) => m.to === address && m.subject.startsWith("Reset your"))?.text.match(/https?:\/\/\S+/)?.[0];
    const token = new URL((await auth.handler(new Request(link!))).headers.get("location")!, BASE).searchParams.get("token");
    const reset = await auth.handler(post("/reset-password", { token, newPassword: "a-new-password-4" }));
    expect(reset.status).toBe(200);
    const phone = known(reset);
    expect(phone).toContain(KNOWN);
    // A bad token proves nothing.
    expect(known(await auth.handler(post("/reset-password", { token: "not-a-token", newPassword: "a-new-password-5" })))).toBe("");

    for (let i = 0; i < PASSWORD_ATTEMPTS.max; i++) await signIn("wrong-password");
    expect((await signIn("a-new-password-4")).status).toBe(429);
    expect((await signIn("a-new-password-4", phone)).status).toBe(200);
  }, 90_000); // ~45 password hashes

  it("stores no GitHub/Google tokens, when an identity is linked or updated later", async () => {
    const { userId } = await signUp(newEmail("tokens"));
    const auth = await loadAuth();
    const ctx = await auth.$context;
    expect(ctx.options.account?.encryptOAuthTokens).toBe(true);
    const account = await ctx.internalAdapter.linkAccount({
      userId,
      providerId: "github",
      accountId: `gh-${userId}`,
      accessToken: "gho_secret",
      refreshToken: "ghr_secret",
      idToken: "id.token.value",
      scope: "read:user",
    });
    await ctx.internalAdapter.updateAccount(account.id, { accessToken: "gho_fresh", refreshToken: "ghr_fresh" });
    const rows = await client.query<Record<string, string | null>>(
      "select provider_id, access_token, refresh_token, id_token, scope, password from auth_account where user_id = $1 order by provider_id",
      [userId],
    );
    expect(rows.rows).toMatchObject([
      { provider_id: "credential", access_token: null },
      { provider_id: "github", access_token: null, refresh_token: null, id_token: null, scope: "read:user" },
    ]);
    // The password login is untouched.
    expect(rows.rows[0].password).toBeTruthy();
  });

  it("sends a reset link that lands on /auth/reset-password, and the new password works", async () => {
    const address = newEmail("reset");
    await signUp(address);
    const auth = await loadAuth();
    const res = await auth.handler(post("/request-password-reset", { email: address, redirectTo: "/auth/reset-password" }));
    expect(res.status).toBe(200);
    const mail = sent.find((m) => m.subject.startsWith("Reset your"));
    const link = mail?.text.match(/https?:\/\/\S+/)?.[0];
    expect(link).toContain("/api/auth/reset-password/");
    const follow = await auth.handler(new Request(link!));
    expect(follow.status).toBe(302);
    const token = new URL(follow.headers.get("location")!, BASE).searchParams.get("token");
    expect(follow.headers.get("location")).toMatch(/\/auth\/reset-password\?token=/);

    const { resetPasswordAction } = await import("./better-auth/actions");
    const mismatch = await resetPasswordAction(IDLE, form({ token: token!, password: "a-new-password-1", confirm: "different" }));
    expect(mismatch.fieldErrors?.confirm).toBeTruthy();
    const done = await resetPasswordAction(IDLE, form({ token: token!, password: "a-new-password-1", confirm: "a-new-password-1" }));
    expect(done.status).toBe("done");
    expect(sent.some((m) => m.subject.includes("password was reset"))).toBe(true);
    const signIn = await auth.handler(post("/sign-in/email", { email: address, password: "a-new-password-1" }));
    expect(signIn.status).toBe(200);
  });

  it("requires verification when switched on, without revealing existing accounts", async () => {
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "true";
    const address = newEmail("verify");
    const { signUpAction, signInAction } = await import("./better-auth/actions");

    const first = await signUpAction(IDLE, form({ name: "V", email: address, password: PASSWORD }));
    expect(first.status).toBe("sent");
    // Same address again: the same answer, and the owner gets a note instead.
    const second = await signUpAction(IDLE, form({ name: "V", email: address, password: PASSWORD }));
    expect(second.status).toBe("sent");
    expect(sent.some((m) => m.to === address && m.subject.startsWith("You already have"))).toBe(true);

    const blocked = await signInAction(IDLE, form({ email: address, password: PASSWORD }));
    expect(blocked.message).toMatch(/Confirm your email/);

    const link = sent.filter((m) => m.subject.startsWith("Confirm your email")).at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
    const auth = await loadAuth();
    const follow = await auth.handler(new Request(link!));
    expect(follow.status).toBe(302);
    expect(follow.headers.get("location")).toContain("/auth/verify-email");
    expect(cookieFrom(follow)).toContain("better-auth.session_token=");
    expect(sent.some((m) => m.to === address && m.subject.startsWith("Welcome"))).toBe(true);

    expect(await redirectOf(signInAction(IDLE, form({ email: address, password: PASSWORD, redirectTo: "/dashboard/billing" })))).toBe("/dashboard/billing");
  });

  it("signInAction refuses off-site redirects", async () => {
    const address = newEmail("redir");
    await signUp(address);
    const { signInAction } = await import("./better-auth/actions");
    expect(await redirectOf(signInAction(IDLE, form({ email: address, password: PASSWORD, redirectTo: "//evil.example" })))).toBe("/dashboard");
  });

  it("lists sessions without tokens and revokes another device", async () => {
    const address = newEmail("sessions");
    const { cookie: laptop } = await signUp(address);
    const auth = await loadAuth();
    const iphoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
    const phone = cookieFrom(await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD }, { ua: iphoneUa })));

    requestHeaders = new Headers({ cookie: laptop, "x-forwarded-for": "203.0.113.7" });
    const { listSessions, revokeSession, revokeOtherSessions, getAccountSecurity } = await import("./better-auth/actions");
    const sessions = await listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toContain(tokenOnly(laptop).split("=")[1].split(".")[0]);
    const other = sessions.find((s) => !s.current)!;
    expect(other.device).toBe("Safari on iPhone");

    const security = await getAccountSecurity();
    expect(security).toMatchObject({ email: address, hasPassword: true, linkedProviders: [], twoFactor: { available: true, enabled: false } });

    const self = await revokeSession(IDLE, form({ sessionId: sessions.find((s) => s.current)!.id }));
    expect(self.status).toBe("error");
    const revoked = await revokeSession(IDLE, form({ sessionId: other.id }));
    expect(revoked).toMatchObject({ status: "done", message: "Safari on iPhone is signed out." });
    expect(await sessionOf(tokenOnly(phone))).toBeNull();
    expect(await sessionOf(tokenOnly(laptop))).not.toBeNull();

    const tablet = cookieFrom(await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD })));
    expect((await revokeOtherSessions(IDLE, form({}))).status).toBe("done");
    expect(await sessionOf(tokenOnly(tablet))).toBeNull();
    expect(await listSessions()).toHaveLength(1);
  });

  it("changes the password, checking the current one, and emails a notice", async () => {
    const address = newEmail("change");
    const { cookie } = await signUp(address);
    requestHeaders = new Headers({ cookie, "x-forwarded-for": "203.0.113.7" });
    const { changePassword } = await import("./better-auth/actions");

    const wrong = await changePassword(IDLE, form({ currentPassword: "not-it-at-all", newPassword: "brand-new-pass-2", confirm: "brand-new-pass-2" }));
    expect(wrong.fieldErrors?.currentPassword).toBe("That password isn’t right.");
    const short = await changePassword(IDLE, form({ currentPassword: PASSWORD, newPassword: "short", confirm: "short" }));
    expect(short.fieldErrors?.newPassword).toMatch(/at least 8/);

    const ok = await changePassword(IDLE, form({ currentPassword: PASSWORD, newPassword: "brand-new-pass-2", confirm: "brand-new-pass-2" }));
    expect(ok.status).toBe("done");
    expect(sent.some((m) => m.to === address && m.subject.includes("password was changed"))).toBe(true);
    const auth = await loadAuth();
    expect((await auth.handler(post("/sign-in/email", { email: address, password: "brand-new-pass-2" }))).status).toBe(200);
    expect((await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD }))).status).toBe(401);
  });

  it("two-factor: set up with a password + first code, then sign-in needs a code or a backup code", async () => {
    const address = newEmail("totp");
    const { cookie } = await signUp(address);
    const auth = await loadAuth();
    requestHeaders = new Headers({ cookie, "x-forwarded-for": "203.0.113.7" });
    const actions = await import("./better-auth/actions");

    expect((await actions.startTwoFactorSetup(IDLE, form({ password: "wrong-password" }))).fieldErrors?.password).toBe("That password isn’t right.");
    const setup = await actions.startTwoFactorSetup(IDLE, form({ password: PASSWORD }));
    expect(setup.status).toBe("pending");
    const { totpURI, secret, backupCodes } = setup.twoFactorSetup!;
    expect(totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(totpURI).toContain(encodeURIComponent(DEFAULT_CONTENT.site.name));
    expect(secret.length).toBeGreaterThan(10);
    expect(backupCodes).toHaveLength(10);

    // Not on until the first code is accepted.
    expect((await actions.getAccountSecurity())?.twoFactor.enabled).toBe(false);
    expect((await actions.confirmTwoFactorSetup(IDLE, form({ code: "12345" }))).fieldErrors?.code).toMatch(/6-digit/);
    expect((await actions.confirmTwoFactorSetup(IDLE, form({ code: "000000" }))).status).toBe("error");
    // Typed the way people do: with a space in the middle.
    const code = totpFor(secret);
    const confirmed = await actions.confirmTwoFactorSetup(IDLE, form({ code: `${code.slice(0, 3)} ${code.slice(3)}` }));
    expect(confirmed.status).toBe("done");
    expect(sent.some((m) => m.to === address && m.subject.startsWith("Two-factor sign-in is on"))).toBe(true);

    // The password step now stops short of a session and sets a challenge cookie.
    const step1 = await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD }));
    expect(await step1.json()).toMatchObject({ twoFactorRedirect: true });
    const challenge = cookieFrom(step1);
    expect(challenge).toContain("better-auth.two_factor=");
    expect(challenge).not.toContain("better-auth.session_token=");

    const bad = await auth.handler(post("/two-factor/verify-totp", { code: "000000" }, { cookie: challenge }));
    expect(bad.status).toBe(401);
    const good = await auth.handler(post("/two-factor/verify-totp", { code: totpFor(secret) }, { cookie: challenge }));
    expect(good.status).toBe(200);
    expect(await sessionOf(tokenOnly(cookieFrom(good)))).toMatchObject({ user: { email: address } });

    // A backup code works once.
    const step1b = cookieFrom(await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD })));
    const backup = await auth.handler(post("/two-factor/verify-backup-code", { code: backupCodes[0] }, { cookie: step1b }));
    expect(backup.status).toBe(200);
    const step1c = cookieFrom(await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD })));
    expect((await auth.handler(post("/two-factor/verify-backup-code", { code: backupCodes[0] }, { cookie: step1c }))).status).toBe(401);

    // The form action sends a 2FA account to the code step, keeping the destination.
    requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7" });
    expect(await redirectOf(actions.signInAction(IDLE, form({ email: address, password: PASSWORD, redirectTo: "/dashboard/settings" })))).toBe(
      "/auth/two-factor?redirect=%2Fdashboard%2Fsettings",
    );

    // Turning it off needs the password; afterwards the password alone signs in.
    const session = cookieFrom(good);
    requestHeaders = new Headers({ cookie: session, "x-forwarded-for": "203.0.113.7" });
    const fresh = await actions.regenerateBackupCodes(IDLE, form({ password: PASSWORD }));
    expect(fresh.backupCodes).toHaveLength(10);
    expect((await actions.disableTwoFactor(IDLE, form({ password: "wrong-password" }))).status).toBe("error");
    expect((await actions.disableTwoFactor(IDLE, form({ password: PASSWORD }))).status).toBe("done");
    const plain = await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD }));
    expect(cookieFrom(plain)).toContain("better-auth.session_token=");
  });

  it("magic links never skip two-factor: no link is sent, and an older link is refused", async () => {
    process.env.AUTH_MAGIC_LINK = "true";
    const address = newEmail("link");
    const { userId } = await signUp(address);
    const auth = await loadAuth();
    const ask = () =>
      auth.handler(post("/sign-in/magic-link", { email: address, callbackURL: "/dashboard", errorCallbackURL: "/sign-in?error=magic-link" }));
    const linkIn = (to: string) => {
      const mail = [...sent].reverse().find((m) => m.to === to);
      return mail?.text.match(/http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\S+/)?.[0] ?? null;
    };
    const open = (url: string) => auth.handler(request("GET", url.slice(`${BASE}/api/auth`.length)));

    // Without two-factor the link signs in.
    expect(await (await ask()).json()).toEqual({ status: true });
    const works = await open(linkIn(address)!);
    expect(works.status).toBe(302);
    expect(works.headers.get("location")).toBe(`${BASE}/dashboard`);
    expect(cookieFrom(works)).toContain("better-auth.session_token=");

    // A link asked for now, then two-factor switched on before it is opened.
    await ask();
    const older = linkIn(address)!;
    await client.query("UPDATE auth_user SET two_factor_enabled = true WHERE id = $1", [userId]);
    const refused = await open(older);
    expect(refused.status).toBe(302);
    expect(new URL(refused.headers.get("location")!).searchParams.get("error")).toBe("two-factor-required");
    expect(cookieFrom(refused)).not.toContain("better-auth.session_token=");

    // With two-factor on: the same answer, but the email has no link in it.
    sent.length = 0;
    expect(await (await ask()).json()).toEqual({ status: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/with your password$/);
    expect(linkIn(address)).toBeNull();
    expect(sent[0].text).toContain(`${BASE}/sign-in`);
  });

  it("links a social sign-in to an existing account only when the provider verified the email", async () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    const auth = await loadAuth();
    const linking: { enabled?: boolean; trustedProviders?: unknown } | undefined = (await auth.$context).options.account?.accountLinking;
    expect(linking?.enabled).toBe(true);
    // Trusting a provider skips its emailVerified flag: the takeover case.
    expect(linking?.trustedProviders ?? []).toEqual([]);
  });

  it("refuses a GitHub sign-up whose email GitHub hasn't verified while verification is required, and keeps no account", async () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "true";
    const auth = await loadAuth();
    const ctx = await auth.$context;
    expect(ctx.socialProviders.find((p) => p.id === "github")?.options?.requireEmailVerification).toBe(true);

    /** The whole round trip through /callback/github, with GitHub's API answered here. */
    const viaGitHub = async (address: string, verified: boolean, githubId: number) => {
      const real = globalThis.fetch;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "read:user,user:email" });
        if (url === "https://api.github.com/user") return Response.json({ id: githubId, login: `gh${githubId}`, name: "Some One", email: address, avatar_url: null });
        if (url === "https://api.github.com/user/emails") return Response.json([{ email: address, primary: true, verified }]);
        return real(input, init);
      });
      try {
        const start = await auth.handler(post("/sign-in/social", { provider: "github", callbackURL: "/dashboard", errorCallbackURL: "/sign-in?error=social" }));
        const { url } = (await start.json()) as { url: string };
        const state = new URL(url).searchParams.get("state")!;
        return await auth.handler(request("GET", `/callback/github?code=abc&state=${encodeURIComponent(state)}`, undefined, { cookie: cookieFrom(start) }));
      } finally {
        spy.mockRestore();
      }
    };
    const accounts = async (address: string) => (await client.query<{ n: number }>("select count(*)::int as n from auth_user where email = $1", [address])).rows[0].n;

    const victim = newEmail("never-verified");
    const refused = await viaGitHub(victim, false, 900_000 + counter);
    expect(refused.status).toBe(302);
    const to = new URL(refused.headers.get("location")!, BASE);
    expect(to.pathname).toBe("/sign-in");
    expect(to.searchParams.getAll("error").at(-1)).toBe("SOCIAL_EMAIL_NOT_VERIFIED");
    expect(cookieFrom(refused)).not.toContain("better-auth.session_token=");
    expect(await accounts(victim)).toBe(0);

    // The same round trip with a verified email signs in: the refusal is the email, not the mock.
    const owner = newEmail("verified-github");
    const ok = await viaGitHub(owner, true, 950_000 + counter);
    expect(new URL(ok.headers.get("location")!, BASE).pathname).toBe("/dashboard");
    expect(cookieFrom(ok)).toContain("better-auth.session_token=");
    expect(await accounts(owner)).toBe(1);

    const { messageFor } = await import("./better-auth/errors");
    expect(messageFor({ body: { code: "SOCIAL_EMAIL_NOT_VERIFIED" } })).toMatch(/isn’t verified/);
  });

  it("only offers social providers whose id and secret are both set", async () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_ID = "gid";
    process.env.GOOGLE_CLIENT_SECRET = "gsecret";
    const { configuredSocialProviders } = await import("./better-auth/instance");
    expect(configuredSocialProviders().map((p) => p.id)).toEqual(["google"]);
  });

  it("verification is off in development and on in production unless switched off", async () => {
    const { emailVerificationRequired } = await import("./better-auth/instance");
    expect(emailVerificationRequired()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(emailVerificationRequired()).toBe(true);
      process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "false";
      expect(emailVerificationRequired()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("two-factor stays off when the schema lacks its table", async () => {
    const { schemaSupportsTwoFactor } = await import("./better-auth/instance");
    const { twoFactor, ...withoutTable } = pg.tables as Record<string, unknown>;
    expect(twoFactor).toBeTruthy();
    expect(schemaSupportsTwoFactor(withoutTable)).toBe(false);
    expect(schemaSupportsTwoFactor({ ...withoutTable, twoFactor, user: schema.authSession })).toBe(false);
    expect(schemaSupportsTwoFactor(pg.tables as Record<string, unknown>)).toBe(true);
  });
});

describe("better-auth on the memory adapter (DATA_PROVIDER=memory, unit tests only)", () => {
  it("signs up and reads the session", async () => {
    process.env.DATA_PROVIDER = "memory";
    (globalThis as { __openshipkitAuthMemory?: unknown }).__openshipkitAuthMemory = undefined;
    const auth = await loadAuth();
    const res = await auth.handler(post("/sign-up/email", { email: "mem@example.com", password: PASSWORD, name: "M" }));
    expect(res.status).toBe(200);
    expect(await sessionOf(tokenOnly(cookieFrom(res)))).toMatchObject({ user: { email: "mem@example.com" } });
  });
});

// ---------------------------------------------------------------------------
// Bans, ghost rows and second factors, on the real adapter and instance
// (not a fake): the paths a stolen session or a taken-over inbox would use.

const SYSTEM = { type: "system" as const, id: null, label: "test" };

/** Move a session's sign-in time into the past, as if it were made `minutes` ago. */
async function ageSessions(userId: string, minutes: number): Promise<void> {
  await client.query(`UPDATE auth_session SET created_at = now() - ($2 || ' minutes')::interval WHERE user_id = $1`, [userId, String(minutes)]);
}

describe("bans, ghost rows and second factors", () => {
  it("a ban ends every session, refuses a new sign-in, and the account actions treat the person as signed out", async () => {
    const address = newEmail("banned");
    const { cookie, userId } = await signUp(address);
    const auth = await loadAuth();
    const phone = cookieFrom(await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD })));

    requestHeaders = new Headers({ cookie, "x-forwarded-for": "203.0.113.7" });
    const { getCurrentUser } = await import("@/server/session");
    const user = await getCurrentUser();
    expect(user?.email).toBe(address);

    const { setUserBanned } = await import("@/server/services/users");
    await setUserBanned(user!.id, true, SYSTEM);
    const left = await client.query<{ n: number }>("select count(*)::int as n from auth_session where user_id = $1", [userId]);
    expect(left.rows[0].n).toBe(0);
    expect(await sessionOf(tokenOnly(cookie))).toBeNull();
    expect(await sessionOf(tokenOnly(phone))).toBeNull();

    // The right password no longer opens a session, through the API or the form.
    const again = await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD }));
    expect(again.status).toBe(403);
    expect(await again.json()).toMatchObject({ code: "BANNED" });
    expect(cookieFrom(again)).not.toContain("better-auth.session_token=");
    const { BANNED_MESSAGE } = await import("@/core/auth");
    const { signInAction, listSessions, getAccountSecurity } = await import("./better-auth/actions");
    requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7" });
    expect((await signInAction(IDLE, form({ email: address, password: PASSWORD }))).message).toBe(BANNED_MESSAGE);

    // A ban written straight into the table (no revocation): the account actions still refuse.
    await setUserBanned(user!.id, false, SYSTEM);
    const fresh = cookieFrom(await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD })));
    await client.query("UPDATE users SET banned = true WHERE id = $1", [user!.id]);
    requestHeaders = new Headers({ cookie: fresh, "x-forwarded-for": "203.0.113.7" });
    expect(await getAccountSecurity()).toBeNull();
    expect(await listSessions()).toEqual([]);
    // …and the next app request ends that session too.
    expect(await getCurrentUser()).toBeNull();
    expect(await sessionOf(tokenOnly(fresh))).toBeNull();
  });

  it("a sign-in link is refused for a banned person", async () => {
    process.env.AUTH_MAGIC_LINK = "true";
    const address = newEmail("banlink");
    const { cookie } = await signUp(address);
    const auth = await loadAuth();
    requestHeaders = new Headers({ cookie, "x-forwarded-for": "203.0.113.7" });
    const { getCurrentUser } = await import("@/server/session");
    const { setUserBanned } = await import("@/server/services/users");
    await setUserBanned((await getCurrentUser())!.id, true, SYSTEM);

    await auth.handler(post("/sign-in/magic-link", { email: address, callbackURL: "/dashboard", errorCallbackURL: "/sign-in?error=magic-link" }));
    const link = [...sent].reverse().find((m) => m.to === address)?.text.match(/http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\S+/)?.[0];
    expect(link).toBeTruthy();
    const opened = await auth.handler(request("GET", link!.slice(`${BASE}/api/auth`.length)));
    expect(opened.status).toBe(302);
    expect(new URL(opened.headers.get("location")!).searchParams.get("error")).toBe("banned");
    expect(cookieFrom(opened)).not.toContain("better-auth.session_token=");
  });

  it("a deleted account does not come back as a ghost row from a cached session cookie", async () => {
    const address = newEmail("ghost");
    const { cookie } = await signUp(address);
    requestHeaders = new Headers({ cookie, "x-forwarded-for": "203.0.113.7" });
    const { getCurrentUser } = await import("@/server/session");
    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    // The full cookie jar, signed session_data cache included, as a second tab would still send.
    expect(cookie).toContain("better-auth.session_data=");

    const { deleteUser } = await import("@/server/services/users");
    await deleteUser(user!.id, SYSTEM);
    const { adapter } = await import("./better-auth/server");
    expect(await adapter.getIdentity({ fresh: true })).toBeNull();
    expect(await getCurrentUser()).toBeNull();
    const { getData } = await import("@/server/data");
    expect(await (await getData()).users.getByEmail(address)).toBeNull();
  });

  it("revokeSessions ends every session the person has", async () => {
    const address = newEmail("revoke");
    const { cookie, userId } = await signUp(address);
    const auth = await loadAuth();
    const other = cookieFrom(await auth.handler(post("/sign-in/email", { email: address, password: PASSWORD })));
    const { adapter } = await import("./better-auth/server");
    await adapter.revokeSessions!(userId);
    expect(await sessionOf(tokenOnly(cookie))).toBeNull();
    expect(await sessionOf(tokenOnly(other))).toBeNull();
  });

  it("with two-factor on, a confirmation link and a social callback never open a session", async () => {
    const address = newEmail("tfa-paths");
    const { userId } = await signUp(address);
    await client.query("UPDATE auth_user SET two_factor_enabled = true WHERE id = $1", [userId]);
    const auth = await loadAuth();

    // An email-confirmation link (autoSignInAfterVerification) confirms the address but signs nobody in.
    await auth.handler(post("/send-verification-email", { email: address, callbackURL: "/auth/verify-email" }));
    const link = [...sent].reverse().find((m) => m.to === address && m.subject.startsWith("Confirm your email"))?.text.match(/https?:\/\/\S+/)?.[0];
    const opened = await auth.handler(new Request(link!));
    expect(opened.status).toBe(302);
    const to = new URL(opened.headers.get("location")!);
    expect(to.pathname).toBe("/sign-in");
    expect(to.searchParams.get("error")).toBe("two-factor-required");
    expect(cookieFrom(opened)).not.toContain("better-auth.session_token=");

    // The GitHub/Google callback path: the session hook and the account-link hook both refuse.
    const ctx = await auth.$context;
    const hooks = ctx.options.databaseHooks!;
    const fake = { path: "/callback/github", context: ctx, query: {} } as never;
    const sessionBefore = hooks.session!.create!.before!;
    await expect(sessionBefore({ userId, token: "t", expiresAt: new Date() } as never, fake)).rejects.toMatchObject({ body: { code: "TWO_FACTOR_REQUIRED" } });
    const accountBefore = hooks.account!.create!.before!;
    await expect(accountBefore({ userId, providerId: "github", accountId: "1" } as never, fake)).rejects.toMatchObject({ body: { code: "TWO_FACTOR_REQUIRED" } });
    // The password sign-in still goes through (the two-factor plugin then asks for the code).
    await expect(sessionBefore({ userId, token: "t", expiresAt: new Date() } as never, { ...(fake as object), path: "/sign-in/email" } as never)).resolves.toBeUndefined();

    const { messageFor } = await import("./better-auth/errors");
    expect(messageFor({ body: { code: "TWO_FACTOR_REQUIRED" } })).toMatch(/two-factor/);
  });

  it("setting a first password on a social-only account needs a recent sign-in", async () => {
    const address = newEmail("social-only");
    const { cookie, userId } = await signUp(address);
    // Make it a GitHub-only account: no credential password.
    await client.query("UPDATE auth_account SET password = NULL WHERE user_id = $1 AND provider_id = 'credential'", [userId]);
    requestHeaders = new Headers({ cookie: tokenOnly(cookie), "x-forwarded-for": "203.0.113.7" });
    const { changePassword } = await import("./better-auth/actions");
    const fields = { newPassword: "a-first-password-1", confirm: "a-first-password-1" };

    await ageSessions(userId, 60);
    const stale = await changePassword(IDLE, form(fields));
    expect(stale).toMatchObject({ status: "error" });
    expect(stale.message).toMatch(/sign in again/);

    await ageSessions(userId, 1);
    expect((await changePassword(IDLE, form(fields))).status).toBe("done");
  });

  it("linking a provider from a session needs a recent sign-in", async () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    const address = newEmail("link-social");
    const { cookie, userId } = await signUp(address);
    const auth = await loadAuth();
    const link = () => auth.handler(post("/link-social", { provider: "github", callbackURL: "/dashboard/settings" }, { cookie: tokenOnly(cookie) }));

    await ageSessions(userId, 60);
    const stale = await link();
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });

    await ageSessions(userId, 1);
    const ok = await link();
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url?: string }).url).toContain("github.com");
  });

  it("the freshness window matches the account-deletion step-up", async () => {
    const { FRESH_SIGN_IN_SECONDS, sessionIsFresh } = await import("./better-auth/instance");
    const { FRESH_SIGN_IN_MINUTES } = await import("@/lib/reauth");
    expect(FRESH_SIGN_IN_SECONDS).toBe(FRESH_SIGN_IN_MINUTES * 60);
    expect(sessionIsFresh(new Date(Date.now() - 60_000))).toBe(true);
    expect(sessionIsFresh(new Date(Date.now() - (FRESH_SIGN_IN_SECONDS + 1) * 1000))).toBe(false);
  });

  it("development without BETTER_AUTH_SECRET generates a secret once and reuses it", async () => {
    const { mkdtempSync, readFileSync, rmSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "openshipkit-secret-"));
    try {
      const file = join(dir, ".data", "dev-auth-secret");
      const { loadOrCreateDevSecret } = await import("./better-auth/instance");
      const first = loadOrCreateDevSecret(file);
      expect(first.length).toBeGreaterThanOrEqual(32);
      expect(first).not.toMatch(/openshipkit-dev-secret/);
      expect(readFileSync(file, "utf8").trim()).toBe(first);
      expect(statSync(file).mode & 0o077).toBe(0);
      expect(loadOrCreateDevSecret(file)).toBe(first);
      expect(loadOrCreateDevSecret(join(dir, "other", "dev-auth-secret"))).not.toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
