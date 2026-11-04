import "server-only";

//
// POST /api/v1/shout — the example API. Authorization: Bearer <a key from /api/api-keys>.
//   { text } → 200 { result, usage: { used, limit } }
//   401 no or bad key · 400 bad input · 429 the plan's api_calls are used up this period ·
//   Idempotency-Key (24 h, up to 200 characters): the same key and body replay the first answer
//   (Idempotent-Replayed: true; its usage figures are as of that answer), another body is 422, one
//   still running is 409 for up to a minute. A retry after a failure is never charged twice.
//
// Key-authenticated, not cookie-authenticated: there is no session to ride, so
// no Origin check (that's for cookies). Servers call this, not browsers.
//
// Mount:
//   // src/app/api/v1/shout/route.ts
//   export { POST } from "../../../../../examples/usage-api/routes/call";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json, readCappedText } from "@/server/http";
import { ServiceError, serializeError } from "@/server/services/errors";
import { authenticateApiKey, callApi } from "../service";

export async function POST(request: Request): Promise<Response> {
  const caller = await authenticateApiKey(request.headers.get("authorization"));
  if (!caller) return json(401, { error: "unauthorized", message: "Send Authorization: Bearer <your API key>." }, { "www-authenticate": "Bearer" });
  const text = await readCappedText(request, 64 * 1024);
  if (text === null) return json(413, { error: "too_large", message: "That request was too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid", message: "Send a JSON body." });
  }
  // Whole, never cut: two long keys mustn't collide. Over 200 characters is a 400 (the service says so).
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  try {
    const { replayed, ...answer } = await callApi(caller, idempotencyKey, body);
    return json(200, answer, replayed ? { "idempotent-replayed": "true" } : {});
  } catch (error) {
    if (error instanceof ServiceError) {
      const reason = (error.details as { reason?: string } | undefined)?.reason;
      const status = reason === "limit_reached" ? 429 : reason === "idempotency_mismatch" ? 422 : error.status;
      return json(status, serializeError(error));
    }
    throw error;
  }
}
