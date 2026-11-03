import "server-only";

//
// Request and response helpers shared by the route handlers that take plain
// HTML form posts or fetch() JSON from this site's own pages: the public forms
// (src/app/api/forms), billing checkout and portal (src/app/api/billing), and
// any body that must be read with a size cap (the MCP endpoint, the Polar
// webhook). One copy, so a fix to the CSRF check or the body cap reaches every
// route at once.
//
// Bodies are read by streaming with a byte cap: Content-Length is checked
// first, then every chunk is counted, so a chunked upload with no length can't
// make the server buffer more than the cap before it is refused.
//

import { safeRedirect } from "@/core/auth";
import { siteUrl } from "@/server/env";

/** The cap for a public form's body: a contact message is at most a few KB. */
export const FORM_BODY_BYTES = 64 * 1024;

/** The cap for each string value in a form or JSON body. */
export const FIELD_VALUE_CHARS = 10_000;

/**
 * True when the request's Origin is this site (the configured URL, the URL the
 * request came in on, or the host a reverse proxy forwarded). Browsers send
 * Origin on every POST, form posts included; a missing or foreign one is
 * refused, so another site can't post on a visitor's behalf (the CSRF defence
 * for every cookie-carrying POST route).
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const allowed = new Set<string>([new URL(siteUrl()).origin, new URL(request.url).origin]);
  // Behind a reverse proxy request.url is the internal address; the browser saw the forwarded host.
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  return allowed.has(origin);
}

/** fetch callers (a JSON body, or Accept: application/json without text/html) get JSON; form posts get redirects. */
export function wantsJson(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

/**
 * The body's bytes, or null when it is over `maxBytes`: refused on a declared
 * Content-Length above the cap, and while streaming once the running count
 * passes it (the rest of the upload is cancelled, never buffered).
 */
export async function readCapped(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** As readCapped, decoded as UTF-8 text. */
export async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  const bytes = await readCapped(request, maxBytes);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/**
 * A form post's (urlencoded or multipart) or a JSON object body's string
 * fields, each capped at FIELD_VALUE_CHARS. The body is read with a byte cap
 * first: over `maxBytes` → null (answer 413, or treat it as invalid). An
 * unreadable or unsupported body → {} (validation then says what's missing).
 * Files in a multipart body are ignored.
 */
export async function readFields(
  request: Request,
  maxBytes: number = FORM_BODY_BYTES,
): Promise<Record<string, string> | null> {
  const type = request.headers.get("content-type") ?? "";
  const isJson = type.includes("application/json");
  const isForm = type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
  if (!isJson && !isForm) return {};
  const bytes = await readCapped(request, maxBytes);
  if (bytes === null) return null;
  const out: Record<string, string> = {};
  try {
    if (isJson) {
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v.slice(0, FIELD_VALUE_CHARS);
      }
    } else {
      // The capped bytes, re-wrapped so the platform's parser handles both encodings (and multipart boundaries).
      const form = await new Response(bytes, { headers: { "content-type": type } }).formData();
      for (const [k, v] of form) if (typeof v === "string") out[k] = v.slice(0, FIELD_VALUE_CHARS);
    }
  } catch {
    // A malformed body is treated as empty; validation then says what's missing.
  }
  return out;
}

/**
 * A same-site path to send a form post back to, or `fallback`. Never an
 * absolute or protocol-relative URL: the value goes through safeRedirect
 * (src/core/auth.ts) — control characters and backslashes refused, dot
 * segments resolved, so "/..//evil.example" can't become "//evil.example" —
 * then loses its #hash and is capped at 500 characters.
 */
export function safeReturnPath(value: string | undefined | null, fallback: string): string {
  const safe = safeRedirect(value, "");
  return safe.split("#")[0].slice(0, 500) || fallback;
}

/** The path (and query) of a same-origin Referer, or `fallback`. For answering before the body is read. */
export function refererPath(request: Request, fallback: string): string {
  const referer = request.headers.get("referer");
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    const origin = request.headers.get("origin");
    if (!origin || url.origin !== origin) return fallback;
    return safeReturnPath(`${url.pathname}${url.search}`, fallback);
  } catch {
    return fallback;
  }
}

/**
 * `path` with `?key=value` set (replacing an earlier value) and an optional
 * #hash. Always a same-site path: a pathname that resolves to "//host" (dot
 * segments, a path that isn't one) collapses to a single leading slash, so the
 * answer is never a protocol-relative Location.
 */
export function withParam(path: string, key: string, value: string, hash?: string): string {
  const url = new URL(path, "http://local");
  url.searchParams.set(key, value);
  const pathname = url.origin === "http://local" ? url.pathname.replace(/^\/{2,}/, "/") : "/";
  return `${pathname}${url.search}${hash ? `#${hash}` : ""}`;
}

/** 303 See Other: "your POST is done, now GET this". Relative, so it works behind any host. */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

/** A JSON answer that is never cached. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}
