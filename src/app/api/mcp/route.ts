//
// POST /api/mcp — the site's MCP server (stateless Streamable HTTP).
//
// One JSON-RPC message per POST, answered with JSON; a notification gets 202.
// No sessions, no SSE stream (GET and DELETE are 405), no batches. The
// protocol and tools live in src/server/mcp; this file is the door:
//
//   1. Origin   — a browser request must come from the site itself or an
//                 MCP_ALLOWED_ORIGINS entry (stops DNS rebinding); desktop
//                 and CLI clients send no Origin.
//   2. Bearer   — an agent key, or MCP_DEV_KEY in the local demo (auth.ts).
//                 Failures are 401 with WWW-Authenticate and counted per IP
//                 (auth.ts); an IP over the limit gets 429 before any key lookup.
//   3. Limits   — per-key rate limit, 1 MB body (read by src/server/http.ts),
//                 JSON only.
//
// Outside src/proxy.ts (it never runs on /api/*): an agent has no cookie.
//

import { json, readCappedText } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { authBlockedFor, authenticateMcp, bearerToken, noteAuthFailure, originAllowed } from "@/server/mcp/auth";
import { RPC_ERROR, handleMcpMessage, isSupportedProtocolVersion, rpcError } from "@/server/mcp/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
/** Calls per key per minute. A busy agent session makes a few dozen. */
const KEY_LIMIT = 120;
const WINDOW_MS = 60_000;

const NO_STORE = { "Cache-Control": "no-store" };

function tooManyFailures(retryAfterSeconds: number, cors: Record<string, string>): Response {
  return json(429, { error: "rate_limited", message: "Too many failed attempts." }, { ...cors, "Retry-After": String(retryAfterSeconds) });
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!originAllowed(origin)) {
    return json(403, { error: "forbidden", message: "This origin may not call the MCP server. Add it to MCP_ALLOWED_ORIGINS if it should." });
  }
  const cors = corsHeaders(origin);

  const ip = await clientIp();
  const blocked = authBlockedFor(ip);
  if (blocked > 0) return tooManyFailures(blocked, cors);

  const bearer = bearerToken(req.headers.get("authorization"));
  let ctx: Awaited<ReturnType<typeof authenticateMcp>>;
  try {
    ctx = await authenticateMcp(bearer);
  } catch (error) {
    console.error("[mcp] key lookup failed", error);
    return json(503, { error: "unavailable", message: "The site's database is unavailable. Try again shortly." }, { ...cors, "Retry-After": "30" });
  }
  if (!ctx) {
    const blockedNow = noteAuthFailure(ip);
    if (blockedNow > 0) return tooManyFailures(blockedNow, cors);
    const challenge = bearer ? 'Bearer realm="openshipkit", error="invalid_token"' : 'Bearer realm="openshipkit"';
    return json(
      401,
      { error: "unauthorized", message: bearer ? "That agent key is unknown or revoked." : "Send an agent key: Authorization: Bearer osk_…" },
      { ...cors, "WWW-Authenticate": challenge },
    );
  }

  const limited = rateLimit(`mcp:${ctx.key.id}`, KEY_LIMIT, WINDOW_MS);
  if (!limited.ok) {
    return json(429, rpcError(null, RPC_ERROR.internalError, `Rate limit: ${KEY_LIMIT} calls a minute per key. Retry in ${limited.retryAfterSeconds} s.`), {
      ...cors,
      "Retry-After": String(limited.retryAfterSeconds),
    });
  }

  const version = req.headers.get("mcp-protocol-version");
  if (version && !isSupportedProtocolVersion(version)) {
    return json(400, rpcError(null, RPC_ERROR.invalidRequest, `Unsupported MCP-Protocol-Version: ${version}`), cors);
  }
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return json(415, rpcError(null, RPC_ERROR.invalidRequest, "Content-Type must be application/json"), cors);
  }

  const text = await readCappedText(req, MAX_BODY_BYTES);
  if (text === null) return json(413, rpcError(null, RPC_ERROR.invalidRequest, "Request body is over 1 MB"), cors);
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return json(400, rpcError(null, RPC_ERROR.parseError, "Parse error: the body is not valid JSON"), cors);
  }
  if (Array.isArray(message)) {
    return json(400, rpcError(null, RPC_ERROR.invalidRequest, "Batches are not supported: send one JSON-RPC message per request"), cors);
  }

  const reply = await handleMcpMessage(message, ctx);
  if (reply === null) return new Response(null, { status: 202, headers: { ...NO_STORE, ...cors } });
  return json(200, reply, cors);
}

/** CORS preflight, for an allowed browser origin only. */
export async function OPTIONS(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!origin || !originAllowed(origin)) return new Response(null, { status: 403, headers: NO_STORE });
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version",
      "Access-Control-Max-Age": "600",
    },
  });
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...NO_STORE } });
}

/** No server-to-client stream: this server is stateless. */
export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

/** No sessions to end. */
export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
