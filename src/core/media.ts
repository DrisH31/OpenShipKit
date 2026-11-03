//
// Uploaded images: what may be stored, how a file is recognised, and the
// shape of a stored path. Pure — no I/O — so the upload service, the public
// /uploads route, the admin page (the file picker's `accept`) and the tests
// share one allow-list.
//
// Rules:
//  - The BYTES decide the type (magic numbers), never the filename or the
//    Content-Type the browser claims. A claim that disagrees with the bytes is
//    refused rather than trusted.
//  - SVG is REFUSED. An SVG is an XML document that can carry <script> and
//    event handlers; served from this origin it would run with this site's
//    cookies in scope (the admin's session included). Logos that must be
//    vector belong in the repository as components, where they are reviewed.
//  - A stored file is `yyyy/mm/<32 hex>.<ext>`: a random name, so the URL never
//    carries anything from the uploader's filename (path separators, control
//    characters, personal names) and is never reused — which is what makes the
//    public route's `immutable` caching honest.
//

/** The formats that may be stored, with the extension each gets. An allow-list: adding one is a deliberate edit. */
export const MEDIA_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
} as const;

export type MediaType = keyof typeof MEDIA_TYPES;
export type MediaExtension = (typeof MEDIA_TYPES)[MediaType];

/** Extension → media type, for serving. Only what MEDIA_TYPES writes. */
export const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, MediaType>> = Object.fromEntries(
  Object.entries(MEDIA_TYPES).map(([type, ext]) => [ext, type as MediaType]),
);

/** The largest image accepted, in bytes (5 MB): a cover photo, not a print master. */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/** For <input type="file" accept>: the browser filters the picker; the server still sniffs. */
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(",");

/** The public URL prefix every stored image is served under (src/app/uploads/[...path]/route.ts). */
export const MEDIA_URL_PREFIX = "/uploads/";

/** A stored path: yyyy/mm/<32 lower-case hex>.<allowed extension>. Anything else is not ours. */
export const MEDIA_PATH_PATTERN = /^(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f]{32})\.(png|jpg|webp|avif|gif)$/;

/** One stored image, as the admin, the MCP tools and the audit log see it. */
export interface MediaItem {
  /** Relative to the uploads root: "2026/10/<hex>.png". */
  path: string;
  /** Root-relative public URL: "/uploads/2026/10/<hex>.png". Use this in posts (coverImage, Markdown). */
  url: string;
  contentType: MediaType;
  /** Bytes. */
  size: number;
  /** ISO-8601: when the file was written. */
  uploadedAt: string;
}

/** Whether `path` names a stored image (and nothing else — no "..", no dot-files, no other extension). */
export function isMediaPath(path: string): boolean {
  return MEDIA_PATH_PATTERN.test(path);
}

/** The stored path a public URL or path names, or null: "/uploads/2026/10/x.png" or "2026/10/x.png" → "2026/10/x.png". */
export function mediaPathFrom(value: string): string | null {
  let v = value.trim();
  try {
    // An absolute URL on any host: keep the path (the caller decides whether the host is ours).
    if (/^https?:\/\//i.test(v)) v = new URL(v).pathname;
  } catch {
    return null;
  }
  if (v.startsWith(MEDIA_URL_PREFIX)) v = v.slice(MEDIA_URL_PREFIX.length);
  return isMediaPath(v) ? v : null;
}

/** The media type for a stored path, from its extension (already sniffed when it was written). */
export function mediaTypeOf(path: string): MediaType | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_TYPE_BY_EXTENSION[ext] ?? null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

/**
 * The ISO-BMFF brands of an `ftyp` box (major + compatible), or [] when the
 * file doesn't start with one. AVIF and HEIC share this container; only the
 * brand says which, and an AVIF file may carry `mif1` as its major brand with
 * `avif` among the compatible ones.
 */
function ftypBrands(bytes: Uint8Array): string[] {
  if (ascii(bytes, 4, 4) !== "ftyp") return [];
  const size = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  const end = Math.min(bytes.length, size > 16 && size <= 4096 ? size : 64);
  const brands = [ascii(bytes, 8, 4)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(bytes, at, 4));
  return brands;
}

/**
 * The type of these bytes, or null. Signatures are checked in full (a JPEG's
 * first two bytes alone match plenty of things that aren't one), and the
 * container formats by their inner tag: RIFF must say WEBP (not WAV or AVI),
 * and ISO-BMFF must carry an AVIF brand (HEIC is refused: most browsers can't
 * show it).
 */
export function sniffImage(bytes: Uint8Array): MediaType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  const brands = ftypBrands(bytes);
  if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  return null;
}

/**
 * Whether the bytes look like an SVG (or any XML document) — only so the
 * refusal can say why, instead of "not a recognised image". A BOM and leading
 * whitespace are skipped: design tools export both.
 */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  let at = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (at < bytes.length && (bytes[at] ?? 0) <= 0x20) at++;
  const head = ascii(bytes, at, Math.min(256, bytes.length - at)).toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml") || (head.startsWith("<!--") && head.includes("<svg"));
}

/** A browser's claimed type, normalised: "image/jpg" and "image/pjpeg" mean JPEG. "" when absent. */
export function normaliseClaimedType(type: string | null | undefined): string {
  const v = (type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return v === "image/jpg" || v === "image/pjpeg" ? "image/jpeg" : v;
}

/** "1.2 MB", "820 KB", "12 bytes" — for refusals and the media grid. */
export function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} ${size === 1 ? "byte" : "bytes"}`;
}
