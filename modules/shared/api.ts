import "server-only";

//
// What every module route handler does before and after calling its service:
//
//   const user = await apiUser(request);           // same-origin check + session → User, or a 401/403 Response
//   const body = await readJsonObject(request, n); // capped JSON object body, or a 400/413 Response
//   …service call…
//   catch (error) { return apiError(error, "ai"); } // ServiceError / UpstreamError → JSON + Retry-After
//
// The answer shape is the app's own (src/app/api/billing/checkout/route.ts):
// `{ error: <code>, message, details? }`, never cached. Anything that isn't a
// ServiceError or an UpstreamError is a bug or an outage: logged here with
// its name and message only (an upstream error can echo a prompt), and
// answered with a generic 500.
//
// These are JSON APIs for this site's own pages, called with fetch() and the
// session cookie. Cookie-authenticated writes are CSRF targets, so anything
// but GET/HEAD must carry this site's Origin (isSameOrigin, the same check
// the forms and billing routes use).
//

import type { User } from "@/core/types";
import { isSameOrigin, json, readCappedText } from "@/server/http";
import { ServiceError, serializeError } from "@/server/services/errors";
import { getCurrentUser } from "@/server/session";

/**
 * A failure at a third party a module calls (an AI provider, an embeddings
 * endpoint) — not ours, not the caller's. `status` is what the route answers:
 * 502 broken, 504 too slow, 499 the caller went away.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: 499 | 502 | 503 | 504 = 502,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * The signed-in user, or the Response to return instead: 403 for a
 * cross-site write, 401 when nobody (or a banned person) is signed in.
 * API routes answer 401 rather than redirecting: a fetch() caller can't follow
 * a redirect to a sign-in page in any useful way.
 */
export async function apiUser(request: Request): Promise<User | Response> {
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return json(403, { error: "forbidden", message: "Cross-site request refused" });
  }
  const user = await getCurrentUser();
  if (!user) return json(401, { error: "unauthorized", message: "Sign in first" });
  return user;
}

/**
 * The body as a JSON object (not an array or a primitive: every caller reads
 * named fields, and `[].question` is undefined rather than an error), or the
 * Response to return: 413 over `maxBytes` (read with the shared streaming cap,
 * so an oversized upload is refused without being buffered), 400 otherwise.
 */
export async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  const text = await readCappedText(request, maxBytes);
  if (text === null) return json(413, { error: "too_large", message: "That request was too large to read" });
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  return json(400, { error: "invalid", message: "Send a JSON object body" });
}

/** `details.retryAfterSeconds` from a ServiceError, when a refusal carries one. */
function retryAfter(details: unknown): number | null {
  if (!details || typeof details !== "object" || !("retryAfterSeconds" in details)) return null;
  const n = Number((details as { retryAfterSeconds: unknown }).retryAfterSeconds);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/**
 * The Response for a failure. 429 and 503 carry Retry-After (seconds) when the
 * refusal knows how long to wait: a client that backs off by exactly that much
 * doesn't hammer a server that is already saying no.
 */
export function apiError(error: unknown, tag: string): Response {
  if (error instanceof ServiceError) {
    const wait = retryAfter(error.details);
    return json(error.status, serializeError(error), wait ? { "retry-after": String(wait) } : {});
  }
  if (error instanceof UpstreamError) {
    const code = error.status === 504 ? "timeout" : error.status === 499 ? "cancelled" : "upstream";
    return json(error.status, { error: code, message: error.message });
  }
  console.error(`[${tag}] request failed`, error instanceof Error ? `${error.name}: ${error.message}` : error);
  return json(500, { error: "error", message: "Something went wrong. Try again in a moment." });
}
