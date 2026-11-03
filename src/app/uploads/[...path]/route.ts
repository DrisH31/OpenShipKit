//
// GET /uploads/yyyy/mm/<hex>.<ext> — the media library, served publicly.
//
// Public on purpose: these are cover images and inline images on the
// marketing site, so every visitor, crawler and link-preview renderer must
// fetch them without a session. Writing is what needs one
// (/api/admin/media). robots.txt leaves /uploads/ crawlable: image search is
// a way in.
//
//  - Nothing here trusts the URL: the joined path must match the stored-path
//    pattern (yyyy/mm/<32 hex>.<allowed ext>) and resolve under UPLOADS_DIR
//    (src/server/services/media-storage.ts), so "..", encoded slashes, dot-files
//    and other extensions are all a plain 404.
//  - The Content-Type comes from the allow-list, never from the file; the
//    bytes were sniffed when written. `nosniff` stops a browser guessing
//    otherwise, and the CSP sandboxes a file opened directly.
//  - `immutable` for a year is honest: names are random and never reused, so
//    a URL's bytes can't change (a deleted image's URL just 404s). The ETag
//    answers revalidations with a 304 after one stat, no read.
//  - A 404 is not cached: there's nothing to keep, and it stays cheap.
//

import { readMedia, statMedia } from "@/server/services/media-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IMMUTABLE = "public, max-age=31536000, immutable";

const SAFETY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  // No Cross-Origin-Resource-Policy: feed readers and other sites' link previews embed these images.
};

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...SAFETY_HEADERS },
  });
}

/** A strong validator: the name is random and the bytes never change under it. */
function etagFor(path: string, size: number): string {
  return `"${path.replace(/\//g, "-")}-${size}"`;
}

/** If-None-Match may list several tags (or *); weak forms compare equal for a GET. */
function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const tag = t.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag;
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  // Rejoined whole and checked whole: a per-segment test can't see what segments mean together.
  const path = (segments ?? []).join("/");

  const item = await statMedia(path);
  if (!item) return notFound();
  const etag = etagFor(item.path, item.size);

  if (matches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": IMMUTABLE, ...SAFETY_HEADERS } });
  }

  // A file removed between the stat and the read is a 404, not a 500.
  const file = await readMedia(item.path);
  if (!file) return notFound();

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.item.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": IMMUTABLE,
      ETag: etag,
      "Last-Modified": new Date(file.item.uploadedAt).toUTCString(),
      ...SAFETY_HEADERS,
    },
  });
}
