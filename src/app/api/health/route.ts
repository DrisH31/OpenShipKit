//
// GET /api/health — readiness, for uptime checks, load balancers and `docker
// compose` healthchecks. 200 when the database answers, 503 when it doesn't.
// /api/health/live is liveness: the process answers, database or not.
//
// Public, so it says only what is safe to say: whether the database answered
// (and how fast), whether background jobs are keeping up, which kind of stack
// this is and the OpenShipKit version. Never a connection string, a key, an
// error message or a count.
//
// `jobs.ok` is false when a due job has waited more than JOB_LAG_LIMIT_MS: the
// runner is stopped (JOBS_RUNNER=off everywhere), stuck, or overwhelmed. It
// doesn't change the status code: a slow queue is a reason to look, not to take
// the site out of a load balancer. Alert on it with a keyword monitor
// (docs/observability.md#health).
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
/** A due job waiting longer than this means the runner isn't keeping up. */
const JOB_LAG_LIMIT_MS = 5 * 60_000;

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

/** Whether background jobs keep up: a yes or no, never how many. Null when the queue can't be read. */
async function checkJobs(): Promise<{ ok: boolean } | null> {
  try {
    const { oldestDueAt } = await (await getData()).jobs.counts();
    return { ok: oldestDueAt === null || Date.now() - Date.parse(oldestDueAt) < JOB_LAG_LIMIT_MS };
  } catch {
    return null; // the database check above says why
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
  const jobs = data.ok ? await checkJobs() : null;
  const body = { ok: data.ok, data, jobs, stack: stack(), version: OPENSHIPKIT_VERSION, time: new Date().toISOString() };
  return NextResponse.json(body, { status: data.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

export async function HEAD(): Promise<Response> {
  const data = await checkData();
  return new Response(null, { status: data.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
