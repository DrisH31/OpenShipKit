import "server-only";

//
// The media library: upload, list and delete images, audited. The admin
// (/admin/media, the post editor's "Upload cover"), the upload route
// (/api/admin/media) and the MCP tools (media_list, media_upload) all call
// these; bytes live on disk (./media-storage.ts), URLs in posts.
//
// An upload is checked in this order, each refusal saying exactly why:
// empty → too large → an SVG (refused: see src/core/media.ts) → not a PNG,
// JPEG, WebP, AVIF or GIF by its bytes → a claimed type that disagrees with
// the bytes. Then it is written under a random name and audited
// ("media.upload"). A delete is refused while a post or a content section
// still uses the image — a broken cover is worse than a spare file — and is
// audited ("media.delete"). Deletes can't be undone from the audit log: the
// bytes are gone.
//

import { MAX_MEDIA_BYTES, formatBytes, looksLikeSvg, mediaPathFrom, normaliseClaimedType, sniffImage, type MediaItem } from "@/core/media";
import { clampLimit } from "@/core/data";
import type { Actor, Page } from "@/core/types";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { listMediaFiles, removeMediaFile, statMedia, writeMediaFile } from "./media-storage";

/** Why an upload was refused, as a fixed code (ServiceError.details.reason): the no-JavaScript form maps it to a sentence. */
export type MediaRefusal = "empty" | "too_large" | "svg" | "not_image" | "mismatch";

function refuse(reason: MediaRefusal, message: string): never {
  throw new ServiceError("invalid", message, { reason });
}

/** The refusal code a ServiceError from uploadMedia carries, if any. */
export function mediaRefusalOf(error: unknown): MediaRefusal | null {
  if (!(error instanceof ServiceError) || error.code !== "invalid") return null;
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  return reason === "empty" || reason === "too_large" || reason === "svg" || reason === "not_image" || reason === "mismatch" ? reason : null;
}

export interface MediaUploadInput {
  bytes: Uint8Array;
  /** The type the browser (or agent) claimed, if any. Only a cross-check: the bytes decide. */
  claimedType?: string | null;
}

/** Validate and store one image. Throws ServiceError("invalid") with the reason. */
export async function uploadMedia(input: MediaUploadInput, actor: Actor): Promise<MediaItem> {
  assertNotDemo(actor);
  const { bytes } = input;
  if (bytes.length === 0) refuse("empty", "That file is empty.");
  if (bytes.length > MAX_MEDIA_BYTES) {
    refuse("too_large", `That file is ${formatBytes(bytes.length)}; images can be up to ${formatBytes(MAX_MEDIA_BYTES)}. Export it smaller (a cover needs about 2400 px wide at most).`);
  }
  if (looksLikeSvg(bytes)) {
    refuse(
      "svg",
      "SVG files aren’t accepted: an SVG can carry a script, and served from this site it would run with your visitors’ sign-in in scope. Export a PNG or WebP instead.",
    );
  }
  const detected = sniffImage(bytes);
  if (!detected) refuse("not_image", "That file isn’t a PNG, JPEG, WebP, AVIF or GIF image.");
  const claimed = normaliseClaimedType(input.claimedType);
  // No claim, or the generic one a dropped file often gets, isn't a disagreement.
  if (claimed && claimed !== "application/octet-stream" && claimed !== detected) {
    refuse("mismatch", `That file says it is ${claimed}, but its contents are ${detected}. Re-export it and try again.`);
  }
  let item: MediaItem;
  try {
    item = await writeMediaFile(bytes, detected);
  } catch (error) {
    // The path names the server's filesystem: logged, never returned.
    console.error("[media] write failed:", error instanceof Error ? error.message : error);
    throw new ServiceError("unavailable", "The image couldn’t be saved. Check that the uploads folder exists and is writable (UPLOADS_DIR), then try again.");
  }
  await recordAudit(actor, "media.upload", "media", item.path, null, item);
  return item;
}

/** Sort key of an item in list order (newest first): the cursor a page ends on. */
function keyOf(item: MediaItem): string {
  return `${item.uploadedAt}|${item.path}`;
}

/** A page of stored images, newest first. The cursor is opaque (the last item's sort key). */
export async function listMedia(query: { limit?: number; cursor?: string | null } = {}): Promise<Page<MediaItem>> {
  const size = clampLimit(query.limit);
  const all = await listMediaFiles();
  const after = query.cursor ?? null;
  if (after !== null && !/^[0-9TZ:.+-]+\|[0-9a-z/.]+$/i.test(after)) throw new ServiceError("invalid", "That cursor isn’t one this list gave out.");
  // Items sort descending by key, so the next page is everything strictly below the cursor.
  const rest = after === null ? all : all.filter((item) => keyOf(item) < after);
  const items = rest.slice(0, size);
  const last = items.at(-1);
  return { items, nextCursor: rest.length > size && last ? keyOf(last) : null };
}

/** One stored image by path or URL ("/uploads/2026/10/<hex>.png"), or null. */
export async function getMedia(pathOrUrl: string): Promise<MediaItem | null> {
  const path = mediaPathFrom(pathOrUrl);
  return path ? statMedia(path) : null;
}

/**
 * What still uses an image: posts whose cover or body names its URL, and
 * content sections whose JSON does (the hero image, the site's social image,
 * a testimonial's avatar). Reads every post — fine for a blog; this runs only
 * on delete.
 */
export async function findMediaUsage(item: Pick<MediaItem, "url">): Promise<string[]> {
  const data = await getData();
  const uses: string[] = [];
  let cursor: string | null = null;
  let seen = 0;
  do {
    const page = await data.posts.list({ limit: 200, cursor });
    for (const p of page.items) {
      if ((p.coverImage ?? "").includes(item.url) || p.body.includes(item.url)) uses.push(`${p.kind} “${p.title}”`);
    }
    seen += page.items.length;
    cursor = page.nextCursor;
  } while (cursor && seen < 20_000);
  for (const entry of await data.content.all()) {
    if (JSON.stringify(entry.value).includes(item.url)) uses.push(`content section “${entry.key}”`);
  }
  return uses;
}

/** Delete a stored image by path or URL. Refused (conflict) while something uses it. */
export async function deleteMedia(pathOrUrl: string, actor: Actor): Promise<MediaItem> {
  assertNotDemo(actor);
  const item = await getMedia(pathOrUrl);
  if (!item) throw new ServiceError("not_found", `No image at ${pathOrUrl}. Find it with the media list.`);
  const uses = await findMediaUsage(item);
  if (uses.length) {
    const named = uses.slice(0, 5).join(", ") + (uses.length > 5 ? ` and ${uses.length - 5} more` : "");
    throw new ServiceError("conflict", `This image is still used by ${named}. Remove it there first, then delete it.`, { uses });
  }
  await removeMediaFile(item.path);
  await recordAudit(actor, "media.delete", "media", item.path, item, null);
  return item;
}
