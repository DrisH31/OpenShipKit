//
// Better Auth on the real Postgres adapter (Drizzle + the auth_* tables from
// /drizzle). Opt-in: runs only when AUTH_TEST_DATABASE_URL points at a
// throwaway database with the migrations applied — it writes and deletes rows.
//
//   AUTH_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/authtest npx vitest run src/adapters/auth/better-auth/postgres.test.ts
//

import { afterAll, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "@/core/email";
import { DEFAULT_CONTENT } from "@/content/defaults";

const url = process.env.AUTH_TEST_DATABASE_URL;
const sent: EmailMessage[] = [];
let requestHeaders = new Headers();

vi.mock("@/server/email", () => ({
  sendEmail: async (message: EmailMessage) => {
    sent.push(message);
    return { id: null };
  },
}));
vi.mock("@/server/services/content", () => ({ getContent: async (key: "site") => DEFAULT_CONTENT[key] }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders, cookies: async () => ({ get: () => undefined }) }));

const BASE = "http://localhost:3000";

function post(path: string, body: unknown): Request {
  return new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "198.51.100.9" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!url)("better-auth on postgres", () => {
  const email = `pg-${Date.now()}@example.com`;

  afterAll(async () => {
    const { closeDrizzle } = await import("@/adapters/data/postgres/db");
    await closeDrizzle();
  });

  it("signs up, reads the session, rate-limits in the database, and deletes the identity", async () => {
    process.env.DATABASE_URL = url;
    process.env.DATA_PROVIDER = "postgres";
    process.env.AUTH_RATE_LIMIT = "true";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0000";

    const { getBetterAuth } = await import("./instance");
    const auth = await getBetterAuth();

    const res = await auth.handler(post("/sign-up/email", { email, password: "long-enough-1", name: "Pg Person" }));
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string } };
    const token = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("better-auth.session_token="));
    expect(token).toBeTruthy();

    requestHeaders = new Headers({ cookie: token! });
    const { adapter } = await import("./server");
    expect(await adapter.getIdentity()).toMatchObject({ email, providerUserId: user.id });

    // Wrong passwords from one IP: the database-backed limiter answers 429.
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await auth.handler(post("/sign-in/email", { email, password: "wrong-password" }))).status);
    expect(statuses.at(-1)).toBe(429);

    await adapter.deleteIdentity!(user.id);
    expect(await adapter.getIdentity()).toBeNull();
    expect(sent.some((m) => m.to === email)).toBe(true);
  });
});
