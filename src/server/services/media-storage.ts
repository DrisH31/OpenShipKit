import "server-only";

//
// Where uploaded images live: plain files under UPLOADS_DIR, or, with
// MEDIA_STORAGE=s3, objects in an S3-compatible bucket (src/adapters/media/s3,
// through src/server/media-store.ts). Every function below checks the path
// first, then works on the disk or the bucket; callers can't tell which. The database
// stores URLs (posts.coverImage, Markdown bodies), never bytes — Postgres can
// hold binaries but shouldn't here: pg_dump doubles them as hex, every read
// holds a pool connection for the whole transfer, and a blob loses immutable
// URL caching. There is no media table: the folder IS the library.
//
//   UPLOADS_DIR   default ".data/uploads" (relative to the working directory;
//                 gitignored with the rest of .data/). In production mount a
//                 VOLUME there — the container's own filesystem is thrown
//                 away on every deploy, and every image with it. The compose
//                 file mounts one at /app/uploads and sets UPLOADS_DIR=/app/uploads.
//                 Back it up with the database: a restore of one without the
//                 other is a site of broken images.
//
// This module only moves bytes. Validation (type sniffing, size, SVG) and the
// audit log are ./media.ts; nothing else should call writeMediaFile.
//
// Path safety: every path is first checked against MEDIA_PATH_PATTERN
// (yyyy/mm/<32 hex>.<ext> — no "..", no separators beyond the two, no
// dot-files), then resolved and required to sit under the root. Either check
// alone would do; both make a traversal impossible rather than unlikely.
//

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { MEDIA_TYPES, MEDIA_URL_PREFIX, isMediaPath, mediaTypeOf, type MediaItem, type MediaType } from "@/core/media";
import { optionalEnv } from "../env";
import { getBucket } from "../media-store";

/** The uploads root, absolute. Read per call (lazily), so the build needs no env. */
export function uploadsRoot(): string {
  // Runtime-only directory: the ignore comment stops the build's file tracer from
  // copying the whole project (and a local .data/uploads) into .next/standalone.
  return resolve(/*turbopackIgnore: true*/ optionalEnv("UPLOADS_DIR") ?? ".data/uploads");
}

/** The absolute file for a stored path, or null when the path isn't one of ours or escapes the root. */
export function resolveMediaFile(path: string): string | null {
  if (!isMediaPath(path)) return null;
  const root = uploadsRoot();
  const file = resolve(/*turbopackIgnore: true*/ root, path);
  // root + sep: "/app/uploads-old" must not pass for "/app/uploads".
  return file.startsWith(root + sep) ? file : null;
}

function itemFor(path: string, size: number, mtime: Date): MediaItem | null {
  const contentType = mediaTypeOf(path);
  if (!contentType) return null;
  return { path, url: `${MEDIA_URL_PREFIX}${path}`, contentType, size, uploadedAt: mtime.toISOString() };
}

/**
 * Write already-validated bytes under a new random name in this month's
 * folder (UTC). Written to a temporary dot-file and renamed into place —
 * atomic on one filesystem — so the public route never serves half a file
 * (which `immutable` would make permanent in a browser's cache).
 */
export async function writeMediaFile(bytes: Uint8Array, type: MediaType, now = new Date()): Promise<MediaItem> {
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const path = `${folder}/${randomBytes(16).toString("hex")}.${MEDIA_TYPES[type]}`;
  const bucket = await getBucket();
  if (bucket) {
    if (!isMediaPath(path)) throw new Error(`[media] generated an invalid path ${path}`);
    const stored = await bucket.put(path, bytes, type);
    const item = itemFor(path, stored.size, stored.modified);
    if (!item) throw new Error(`[media] wrote an unservable path ${path}`);
    return item;
  }
  const file = resolveMediaFile(path);
  if (!file) throw new Error(`[media] generated an invalid path ${path}`);
  const dir = join(uploadsRoot(), folder);
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.tmp-${randomUUID()}`);
  try {
    // wx: never overwrite (a 128-bit name won't collide; if it ever did, failing beats replacing someone's image).
    await writeFile(temporary, bytes, { mode: 0o644, flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  const info = await stat(/*turbopackIgnore: true*/ file);
  const item = itemFor(path, info.size, info.mtime);
  if (!item) throw new Error(`[media] wrote an unservable path ${path}`);
  return item;
}

/** One stored image's details, or null when there is no such file. */
export async function statMedia(path: string): Promise<MediaItem | null> {
  const bucket = await getBucket();
  if (bucket) {
    if (!isMediaPath(path)) return null;
    const object = await bucket.head(path);
    return object ? itemFor(path, object.size, object.modified) : null;
  }
  const file = resolveMediaFile(path);
  if (!file) return null;
  try {
    const info = await stat(/*turbopackIgnore: true*/ file);
    return info.isFile() ? itemFor(path, info.size, info.mtime) : null;
  } catch {
    return null;
  }
}

/** A stored image's bytes and details, or null. For the public route. */
export async function readMedia(path: string): Promise<{ item: MediaItem; bytes: Buffer } | null> {
  const bucket = await getBucket();
  if (bucket) {
    if (!isMediaPath(path)) return null;
    const got = await bucket.get(path);
    const item = got ? itemFor(path, got.object.size, got.object.modified) : null;
    return got && item ? { item, bytes: got.bytes } : null;
  }
  const item = await statMedia(path);
  const file = resolveMediaFile(path);
  if (!item || !file) return null;
  const bytes = await readFile(/*turbopackIgnore: true*/ file).catch(() => null);
  return bytes ? { item, bytes } : null;
}

/** Remove a stored image. True when a file was removed. */
export async function removeMediaFile(path: string): Promise<boolean> {
  const bucket = await getBucket();
  if (bucket) return isMediaPath(path) ? bucket.remove(path) : false;
  const file = resolveMediaFile(path);
  if (!file) return false;
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function names(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => pattern.test(n));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Every stored image, newest first (by write time, then path). Walks the
 * yyyy/mm folders and stats each file: fine for the hundreds of images a
 * site's blog has; past tens of thousands, add a table. Files that aren't ours
 * (a stray file copied in, a temporary dot-file) are skipped. A missing root
 * is an empty library, not an error.
 */
export async function listMediaFiles(): Promise<MediaItem[]> {
  const bucket = await getBucket();
  if (bucket) {
    // Objects that aren't ours (a stray key under the prefix) are skipped, as stray files are on disk.
    const items = (await bucket.list()).flatMap((o) => (isMediaPath(o.path) ? (itemFor(o.path, o.size, o.modified) ?? []) : []));
    return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.path.localeCompare(a.path));
  }
  const root = uploadsRoot();
  const out: MediaItem[] = [];
  for (const year of await names(root, /^\d{4}$/)) {
    for (const month of await names(join(root, year), /^(0[1-9]|1[0-2])$/)) {
      for (const name of await names(join(root, year, month), /^[0-9a-f]{32}\.[a-z]+$/)) {
        const item = await statMedia(`${year}/${month}/${name}`);
        if (item) out.push(item);
      }
    }
  }
  return out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.path.localeCompare(a.path));
}
