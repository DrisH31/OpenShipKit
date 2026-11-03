//
// POST /api/admin/media — upload one image to the media library. Admins only.
//
// Takes multipart/form-data with the image in `file`. A route handler, not a
// server action, because server actions cap bodies at 1 MB and an image may
// be up to MAX_MEDIA_BYTES.
//
//  - fetch callers (the post editor's "Upload cover", the media page with
//    JavaScript) send Accept: application/json and get
//    { ok: true, item } (201) or { ok: false, error, message } with the
//    service's reason in words.
//  - a plain form post (the media page without JavaScript) gets a 303 back to
//    /admin/media?uploaded=<path> or ?error=<code>: a FIXED code the page maps
//    to a sentence, never the message itself in the URL.
//
// Order: Origin (CSRF) → admin session → not the read-only demo admin → body read with a byte cap (so an
// oversized or endless upload is refused without being buffered) → the media
// service, which sniffs the bytes and audits.
//

import { DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { MAX_MEDIA_BYTES } from "@/core/media";
import { isDemoUser } from "@/server/demo";
import { isSameOrigin, json, readCapped, seeOther, wantsJson } from "@/server/http";
import { actorFor, getCurrentUser } from "@/server/session";
import { ServiceError, serializeError } from "@/server/services/errors";
import { mediaRefusalOf, uploadMedia } from "@/server/services/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Multipart framing (boundaries, part headers) on top of the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

type Code = "forbidden" | "read_only" | "too_large" | "no_file" | "unavailable" | "error" | NonNullable<ReturnType<typeof mediaRefusalOf>>;

const HTTP: Record<Code, number> = {
  forbidden: 403,
  read_only: 403,
  too_large: 413,
  no_file: 400,
  empty: 400,
  svg: 415,
  not_image: 415,
  mismatch: 415,
  unavailable: 503,
  error: 500,
};

const MESSAGE: Record<Code, string> = {
  forbidden: "Uploads are only accepted from this site’s admin.",
  read_only: DEMO_READ_ONLY_MESSAGE,
  too_large: "That file is too large.",
  no_file: "Choose an image to upload.",
  empty: "That file is empty.",
  svg: "SVG files aren’t accepted.",
  not_image: "That file isn’t a PNG, JPEG, WebP, AVIF or GIF image.",
  mismatch: "That file’s type doesn’t match its contents.",
  unavailable: "The image couldn’t be saved.",
  error: "Something went wrong.",
};

export async function POST(request: Request): Promise<Response> {
  const asJson = wantsJson(request);
  const fail = (code: Code, message = MESSAGE[code]) =>
    asJson ? json(HTTP[code], { ok: false, error: code, message }) : seeOther(`/admin/media?error=${code}`);

  if (!isSameOrigin(request)) return fail("forbidden");
  const user = await getCurrentUser();
  // Like every /admin route: not an admin → it doesn't exist.
  if (!user || user.role !== "admin") return json(404, { ok: false, error: "not_found", message: "Not found" });
  // The read-only demo admin: refused before a byte is read (uploadMedia refuses it too).
  if (isDemoUser(user)) return fail("read_only");

  const body = await readCapped(request, MAX_MEDIA_BYTES + MULTIPART_OVERHEAD);
  if (body === null) return fail("too_large");

  let file: File | null = null;
  try {
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    file = null;
  }
  if (!file || file.size === 0) return fail(file ? "empty" : "no_file");

  try {
    const item = await uploadMedia({ bytes: new Uint8Array(await file.arrayBuffer()), claimedType: file.type }, actorFor(user));
    return asJson ? json(201, { ok: true, item }) : seeOther(`/admin/media?uploaded=${encodeURIComponent(item.path)}`);
  } catch (error) {
    const reason = mediaRefusalOf(error);
    if (reason) return fail(reason, error instanceof Error ? error.message : MESSAGE[reason]);
    if (error instanceof ServiceError) return asJson ? json(error.status, { ok: false, ...serializeError(error) }) : seeOther(`/admin/media?error=unavailable`);
    console.error("[api/admin/media] upload failed", error);
    return fail("error");
  }
}
