//
// The read-only demo admin against the real auth engine: the account ensure
// (embedded Postgres — PGlite in memory with the /drizzle migrations — and the
// memory stores), Better Auth's credential-change block, and POST /api/demo.
// The guard on every write service, the privacy mask and the environment
// rules are in tests/demo.test.ts.
//

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DataStore } from "@/core/data";
import type { EmailMessage } from "@/core/email";
import { DEMO_READ_ONLY_CODE, DEMO_SESSION_SECONDS } from "@/core/demo";
import { DEFAULT_CONTENT } from "@/content/defaults";
import * as schema from "@/adapters/data/postgres/schema";
import type { Db } from "@/adapters/data/postgres/db";

const backend = vi.hoisted(() => ({ kind: "pg" as "pg" | "memory", db: null as unknown, memory: null as unknown }));
const sent: EmailMessage[] = [];
let requestHeaders = new Headers();

vi.mock("@/server/email", () => ({
  sendEmail: async (message: EmailMessage) => {
    sent.push(message);
    return { id: null };
  },
}));
vi.mock("@/server/services/content", () => ({ getContent: async (key: "site") => DEFAULT_CONTENT[key] }));
vi.mock("@/adapters/data/postgres/db", () => ({
  getDrizzle: () => backend.db,
  get authTables() {
    return schema.authTables;
  },
  closeDrizzle: async () => {},
  isEmbeddedDatabase: () => true,
}));
vi.mock("@/server/data", async () => {
  const { createPostgresStore } = await import("@/adapters/data/postgres");
  return { getData: async () => (backend.kind === "memory" ? (backend.memory as DataStore) : createPostgresStore({ db: backend.db as Db })) };
});
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const BASE = "http://localhost:3000";
const DEMO = "demo@example.com";
const PASSWORD = "a-long-random-demo-password-0123";
const ENV_KEYS = ["DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD", "DATA_PROVIDER", "DATABASE_URL", "BETTER_AUTH_SECRET", "AUTH_RATE_LIMIT", "AUTH_REQUIRE_EMAIL_VERIFICATION", "ADMIN_EMAILS", "NEXT_PUBLIC_SITE_URL"];
const saved: Record<string, string | undefined> = {};
let client: PGlite;
let ipCounter = 0;

function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: resolve("drizzle") });
  backend.db = db;
}, 60_000);

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.DATA_PROVIDER = "postgres";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0000";
  process.env.DEMO_ADMIN_EMAIL = DEMO;
  process.env.DEMO_ADMIN_PASSWORD = PASSWORD;
  backend.kind = "pg";
  sent.length = 0;
  requestHeaders = new Headers({ "x-forwarded-for": nextIp() });
  vi.resetModules();
  // A clean slate for every test: no auth users, no app rows, no audit.
  await client.exec("DELETE FROM auth_session; DELETE FROM auth_account; DELETE FROM auth_user; DELETE FROM users; DELETE FROM audit_log;");
  (globalThis as { __openshipkitAuthMemory?: unknown }).__openshipkitAuthMemory = undefined;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function authRequest(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": nextIp(), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
}

async function auth() {
  const { getBetterAuth } = await import("@/adapters/auth/better-auth/instance");
  return getBetterAuth();
}

async function data(): Promise<DataStore> {
  const { getData } = await import("@/server/data");
  return getData();
}

async function ensure() {
  const { ensureDemoAccount } = await import("@/server/services/demo-account");
  return ensureDemoAccount();
}

async function signIn(email: string, password: string): Promise<Response> {
  return (await auth()).handler(authRequest("/sign-in/email", { email, password }));
}

describe.each(["pg", "memory"] as const)("ensuring the demo account (%s)", (kind) => {
  beforeEach(async () => {
    if (kind === "memory") {
      process.env.DATA_PROVIDER = "memory";
      backend.kind = "memory";
      const { createMemoryStore } = await import("@/adapters/data/memory");
      backend.memory = createMemoryStore({ fresh: true });
    }
  });

  it("creates a verified admin once, and every later run changes nothing", async () => {
    const results = await Promise.all([ensure(), ensure()]);
    expect(results).toEqual(["ready", "ready"]);
    expect(await ensure()).toBe("ready");

    const store = await data();
    const user = await store.users.getByEmail(DEMO);
    expect(user).toMatchObject({ role: "admin", banned: false });
    const markers = await store.audit.list({ entity: "demo_admin", limit: 10 });
    expect(markers.items).toHaveLength(1);
    expect(markers.items[0].entityId).toBe(user?.authProviderUserId);
    const found = await (await (await auth()).$context).internalAdapter.findUserByEmail(DEMO);
    expect(found?.user).toMatchObject({ emailVerified: true });
    expect(found?.user.id).toBe(user?.authProviderUserId);

    // Its password signs in; no welcome email went to the demo address.
    expect((await signIn(DEMO, PASSWORD)).status).toBe(200);
    expect(sent.filter((m) => m.to === DEMO)).toEqual([]);
  });

  it("follows a rotated password and puts back a demoted role", async () => {
    await ensure();
    const store = await data();
    const user = (await store.users.getByEmail(DEMO))!;
    await store.users.update(user.id, { role: "user" });
    process.env.DEMO_ADMIN_PASSWORD = "another-long-random-password-9876";
    expect(await ensure()).toBe("ready");
    expect((await store.users.getByEmail(DEMO))?.role).toBe("admin");
    expect((await signIn(DEMO, PASSWORD)).status).toBe(401);
    expect((await signIn(DEMO, "another-long-random-password-9876")).status).toBe(200);
  });

  it("never touches an account someone else made at that address", async () => {
    const res = await (await auth()).handler(authRequest("/sign-up/email", { email: DEMO, password: "strangers-own-password", name: "Stranger" }));
    expect(res.status).toBe(200);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ensure()).toBe("taken");
    expect(errors.mock.calls.flat().join(" ")).toMatch(/REFUSED/);
    errors.mockRestore();
    expect(await (await data()).users.getByEmail(DEMO)).toBeNull();
    // The stranger's password still works; the demo's doesn't.
    expect((await signIn(DEMO, "strangers-own-password")).status).toBe(200);
    expect((await signIn(DEMO, PASSWORD)).status).toBe(401);
  });

  it("is off without the variables", async () => {
    delete process.env.DEMO_ADMIN_PASSWORD;
    expect(await ensure()).toBe("off");
    expect(await (await data()).users.getByEmail(DEMO)).toBeNull();
  });
});

describe("Better Auth refuses the demo account its credentials", () => {
  it("blocks change-password, two-factor, ending other sessions and reset links for the demo — and only for it", async () => {
    await ensure();
    const instance = await auth();
    const cookie = cookieFrom(await signIn(DEMO, PASSWORD));
    expect(cookie).toContain("session_token");

    const refused = [
      authRequest("/change-password", { currentPassword: PASSWORD, newPassword: "hijacked-password-123" }, cookie),
      authRequest("/two-factor/enable", { password: PASSWORD }, cookie),
      authRequest("/revoke-other-sessions", {}, cookie),
      authRequest("/update-user", { name: "Mine now" }, cookie),
      authRequest("/delete-user", { password: PASSWORD }, cookie),
      authRequest("/request-password-reset", { email: "Demo@Example.com", redirectTo: "/auth/reset-password" }),
    ];
    for (const request of refused) {
      const res = await instance.handler(request);
      expect(res.status, request.url).toBe(403);
      expect(((await res.json()) as { code?: string }).code, request.url).toBe(DEMO_READ_ONLY_CODE);
    }
    // The password is unchanged.
    expect((await signIn(DEMO, PASSWORD)).status).toBe(200);

    // Anyone else changes theirs as usual.
    const other = await instance.handler(authRequest("/sign-up/email", { email: "owner@example.com", password: "owner-password-123", name: "Owner" }));
    const ok = await instance.handler(authRequest("/change-password", { currentPassword: "owner-password-123", newPassword: "owner-password-456" }, cookieFrom(other)));
    expect(ok.status).toBe(200);
  });

  it("the settings forms say the read-only sentence (server actions)", async () => {
    await ensure();
    requestHeaders = new Headers({ cookie: cookieFrom(await signIn(DEMO, PASSWORD)), "x-forwarded-for": nextIp() });
    const actions = await import("@/adapters/auth/better-auth/actions");
    const form = new FormData();
    form.set("currentPassword", PASSWORD);
    form.set("newPassword", "hijacked-password-123");
    form.set("confirm", "hijacked-password-123");
    form.set("password", PASSWORD);
    for (const action of [actions.changePassword, actions.startTwoFactorSetup, actions.revokeOtherSessions, actions.disableTwoFactor]) {
      expect(await action({ status: "idle" }, form)).toMatchObject({ status: "error", message: expect.stringMatching(/read-only demo account/) });
    }
  });
});

describe("POST /api/demo", () => {
  function press(opts: { origin?: string | null; ip?: string; accept?: string } = {}): Request {
    const ip = opts.ip ?? nextIp();
    requestHeaders = new Headers({ "x-forwarded-for": ip });
    return new Request(`${BASE}/api/demo`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": ip,
        ...(opts.origin === null ? {} : { origin: opts.origin ?? BASE }),
        ...(opts.accept ? { accept: opts.accept } : {}),
      },
    });
  }

  async function route() {
    return import("@/app/api/demo/route");
  }

  it("is a 404 while the demo is off", async () => {
    delete process.env.DEMO_ADMIN_EMAIL;
    delete process.env.DEMO_ADMIN_PASSWORD;
    const res = await (await route()).POST(press());
    expect(res.status).toBe(404);
  });

  it("refuses another site's form (no session made)", async () => {
    const res = await (await route()).POST(press({ origin: "https://evil.example" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/sign-in?error=demo-forbidden");
    expect((await (await route()).POST(press({ origin: null, accept: "application/json" }))).status).toBe(403);
    expect(await (await data()).users.getByEmail(DEMO)).toBeNull();
  });

  it("signs the visitor in as the demo admin for two hours and opens /admin", async () => {
    const before = Date.now();
    const res = await (await route()).POST(press());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");

    const user = await (await data()).users.getByEmail(DEMO);
    expect(user?.role).toBe("admin");
    const sessions = await (await (await auth()).$context).internalAdapter.listSessions(user!.authProviderUserId);
    expect(sessions).toHaveLength(1);
    const expires = new Date(sessions[0].expiresAt).getTime();
    expect(expires).toBeGreaterThan(before + (DEMO_SESSION_SECONDS - 60) * 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + DEMO_SESSION_SECONDS * 1000);

    // fetch callers get JSON.
    const json = await (await route()).POST(press({ accept: "application/json" }));
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ ok: true, redirect: "/admin" });
  });

  it("allows ten presses per network per minute", async () => {
    const ip = nextIp();
    const { POST } = await route();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await POST(press({ ip, accept: "application/json" }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
