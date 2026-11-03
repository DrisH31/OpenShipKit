//
// GET /api/health/live — liveness: 200 whenever this process can answer at
// all. It never touches the database, so a restart policy pointed here
// doesn't restart a healthy app because Postgres blinked. Readiness (is the
// database there?) is /api/health.
//

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export function HEAD(): Response {
  return new Response(null, { headers: { "Cache-Control": "no-store" } });
}
