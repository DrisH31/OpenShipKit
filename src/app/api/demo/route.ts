//
// POST /api/demo — "Try the demo": sign this browser in as the read-only demo
// admin and open the admin. No credentials from the visitor: the password is
// a server secret (DEMO_ADMIN_PASSWORD) and is never rendered. docs/auth.md →
// "The read-only demo admin".
//
// A plain <form method="post"> (TryDemoButton, in the sign-in and sign-up pages' note) works without JavaScript: it gets
// a 303 to /admin, or to /sign-in?error=<code> when it can't. fetch callers
// (Accept: application/json) get { ok: true, redirect } or { ok: false, error, message }.
//
// Order: demo on (404 otherwise, as if the route didn't exist) → Origin
// (CSRF: another site can't sign a visitor in) → ten presses per network per
// minute → already the demo? straight to the admin → ensure the account and
// sign in (src/server/services/demo-account.ts). Someone signed in as another
// account is signed out first: pressing "Try the demo" means "show me the
// demo", and their own account is one sign-in away. The session lasts
// DEMO_SESSION_SECONDS (two hours) and ends when the browser closes.
//

import { DEMO_LANDING } from "@/core/demo";
import { isDemoUser, demoEnabled } from "@/server/demo";
import { isSameOrigin, json, seeOther, wantsJson, withParam } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { startDemoSession } from "@/server/services/demo-account";
import { getCurrentUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Presses per network per minute. Each one is a password check and a new session. */
const DEMO_PRESSES_PER_MINUTE = 10;

type Failure = "forbidden" | "limited" | "unavailable";

const STATUS: Record<Failure, number> = { forbidden: 403, limited: 429, unavailable: 503 };

const MESSAGE: Record<Failure, string> = {
  forbidden: "That request came from another site, so it was refused.",
  limited: "That’s a lot of demo sign-ins at once. Wait a minute and try again.",
  unavailable: "The demo isn’t available right now. Try again in a minute.",
};

/** The sign-in page's ?error= code for each failure (src/components/auth/sign-in-form.tsx gives it a sentence). */
const QUERY_CODE: Record<Failure, string> = { forbidden: "demo-forbidden", limited: "demo-limited", unavailable: "demo-unavailable" };

export async function POST(request: Request): Promise<Response> {
  const asJson = wantsJson(request);
  if (!demoEnabled()) return json(404, { ok: false, error: "not_found", message: "Not found" });

  const fail = (code: Failure, headers: Record<string, string> = {}) =>
    asJson ? json(STATUS[code], { ok: false, error: code, message: MESSAGE[code] }, headers) : seeOther(withParam("/sign-in", "error", QUERY_CODE[code]));
  const done = () => (asJson ? json(200, { ok: true, redirect: DEMO_LANDING }) : seeOther(DEMO_LANDING));

  if (!isSameOrigin(request)) return fail("forbidden");
  const limit = rateLimit(`demo:sign-in:${await clientIp()}`, DEMO_PRESSES_PER_MINUTE, 60_000);
  if (!limit.ok) return fail("limited", { "retry-after": String(limit.retryAfterSeconds) });

  try {
    if (isDemoUser(await getCurrentUser())) return done();
  } catch {
    // Can't tell who is signed in: sign in afresh below.
  }

  try {
    const started = await startDemoSession();
    return started.ok ? done() : started.reason === "off" ? json(404, { ok: false, error: "not_found", message: "Not found" }) : fail("unavailable");
  } catch (error) {
    console.error("[api/demo] the demo sign-in failed", error);
    return fail("unavailable");
  }
}
