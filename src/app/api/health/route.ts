//
// GET /api/health — for uptime checks, load balancers and `docker compose`
// healthchecks. 200 when the database answers, 503 when it doesn't.
//
// Public, so it says only what is safe to say: whether the database answered
// (and how fast), which kind of stack this is and the OpenShipKit version.
// Never a connection string, a key, an error message or a count.
//

import { NextResponse } from "next/server";
import { getData } from "@/server/data";
import { billingProvider, dataProvider, emailProvider, isDemo, optionalEnv, siteProfile } from "@/server/env";
import { OPENSHIPKIT_VERSION } from "@/server/mcp/server-info";
import { log } from "@/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Give up on the database after this long: a hung check is a failed check. */
const TIMEOUT_MS = 5_000;

async function checkData(): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ ok: false }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false }), TIMEOUT_MS);
    });
    const result = await Promise.race([getData().then((data) => data.health()), timeout]);
    return { ok: result.ok, ms: Date.now() - started };
  } catch (error) {
    log.error("health", "database check failed", error);
    return { ok: false, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function stack() {
  try {
    const data = dataProvider() === "memory" ? "memory" : optionalEnv("DATABASE_URL") ? "postgres" : "embedded-postgres";
    // `profile` lets `npm run smoke` know whether /pricing should exist (docs/site-profile.md).
    return { auth: "better-auth", data, profile: siteProfile(), billing: billingProvider(), email: emailProvider(), demo: isDemo() };
  } catch {
    return { auth: "better-auth", data: "misconfigured", profile: "unknown", billing: "unknown", email: "unknown", demo: false };
  }
}

export async function GET(): Promise<Response> {
  const data = await checkData();
  const body = { ok: data.ok, data, stack: stack(), version: OPENSHIPKIT_VERSION, time: new Date().toISOString() };
  return NextResponse.json(body, { status: data.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

export async function HEAD(): Promise<Response> {
  const data = await checkData();
  return new Response(null, { status: data.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
