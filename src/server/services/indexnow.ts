import "server-only";

//
// IndexNow — tell search engines a URL changed, the moment it changes.
// Optional and OFF unless INDEXNOW_KEY is set.
//
// Why: Bing (and the engines that share IndexNow submissions: Yandex, Seznam,
// Naver …) recrawl a pushed URL within minutes instead of whenever the sitemap
// is next read, and Bing's index feeds several AI search products. Google does
// not take part; the sitemap still covers it. One POST, no account.
//
// Turning it on:
//   1. Pick a key: 8–128 characters of A–Z, a–z, 0–9 and "-"
//      (`openssl rand -hex 16`). Set INDEXNOW_KEY to it.
//   2. Engines verify the key by fetching /<key>.txt from your site and
//      comparing the body. src/app/api/indexnow/[key]/route.ts answers it, and a
//      rewrite in next.config.ts maps /<key>.txt onto it (or put the key, alone,
//      in public/<key>.txt). Check: `curl https://your.site/<key>.txt`.
//
// The key is PUBLIC by design — holding it only lets someone ask for a
// recrawl of this site's own URLs. It is not a secret; don't rotate it on a
// schedule. If the key and the file drift apart, every submission is refused
// (403) and nothing else breaks — the log line below is the only symptom.
//
// Rules:
//  - Fire and forget. pingIndexNow() never throws and callers don't await it:
//    a search engine having a bad afternoon must never make saving a post slow
//    or fail. Failures are logged, nothing more.
//  - Only a PUBLIC origin is announced. With NEXT_PUBLIC_SITE_URL unset, local
//    or a reserved example domain, nothing is sent: announcing a host you
//    don't own is the one failure here whose cost lands outside this process.
//  - Drafts are never announced (a draft is a 404). Publishing, unpublishing,
//    editing or deleting a published post announces its URL — a URL that
//    just started answering 404 is worth a recrawl too, so engines drop it.
//    `listed` doesn't matter: an unlisted post is live and in the sitemap.
//

import type { Post, PostKind } from "@/core/types";
import { optionalEnv, siteUrl } from "../env";
import { log } from "@/server/log";

/** Submits once to every participating engine (they share submissions). */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** The protocol's key format. */
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/** A ping nobody waits for still mustn't hold a socket open for long. */
const TIMEOUT_MS = 5_000;

/** Hosts that are never announced: local machines and the reserved example/test names (RFC 2606, RFC 6761). */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h === "[::1]") return true;
  return /(?:^|\.)example(?:\.(?:com|net|org))?$/.test(h) || /\.(?:test|invalid|example)$/.test(h);
}

/** The key in force, or null when IndexNow is off (unset, or malformed — which is logged). */
export function indexNowKey(): string | null {
  const key = optionalEnv("INDEXNOW_KEY")?.trim();
  if (!key) return null;
  if (!KEY_PATTERN.test(key)) {
    log.warn("indexnow", "INDEXNOW_KEY must be 8–128 characters of A–Z, a–z, 0–9 or '-'; IndexNow is off.");
    return null;
  }
  return key;
}

/** Whether a ping would be sent: a valid key and a public origin. One predicate, so the reasons can't disagree. */
export function indexNowEnabled(): boolean {
  if (!indexNowKey()) return false;
  try {
    const url = new URL(siteUrl());
    return url.protocol === "https:" && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

/** The public path of a document of `kind`. */
export function postPath(kind: PostKind, slug: string): string {
  if (kind === "changelog") return `/changelog/${slug}`;
  if (kind === "page") return `/legal/${slug}`;
  return `/blog/${slug}`;
}

/**
 * Announce changed paths (root-relative). Resolves when the request settles;
 * NEVER rejects. Callers write `void pingIndexNow(…)` — see the header.
 */
export async function pingIndexNow(paths: readonly string[]): Promise<void> {
  if (!indexNowEnabled()) return;
  const key = indexNowKey();
  const base = siteUrl();
  const urlList = [...new Set(paths.filter((p) => p.startsWith("/")))].map((p) => `${base}${p}`).slice(0, 10_000);
  if (!key || urlList.length === 0) return;
  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      // keyLocation is optional at the root; sent so a misplaced key file fails loudly at the engine, not silently.
      body: JSON.stringify({ host: new URL(base).host, key, keyLocation: `${base}/${key}.txt`, urlList }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 accepted, 202 accepted pending key verification. 403 = the key file doesn't match INDEXNOW_KEY.
    if (response.ok) log.info("indexnow", `announced ${urlList.length} URL(s) (${response.status})`);
    else log.warn("indexnow", `${response.status} ${response.statusText} for ${urlList.length} URL(s)${response.status === 403 ? `: /${key}.txt doesn't serve the key` : ""}`);
  } catch (error) {
    log.warn("indexnow", "submission failed", error instanceof Error ? error.message : error);
  }
}

/**
 * What a post write should announce: the URLs of the post before and after the
 * change that are (or just stopped being) live. Empty for a draft that stays a
 * draft. Pure, for tests.
 */
export function changedPostPaths(before: Pick<Post, "kind" | "slug" | "status"> | null, after: Pick<Post, "kind" | "slug" | "status"> | null): string[] {
  const paths = new Set<string>();
  // Was live: its old URL changed or went away. Is live: its URL is new or changed.
  if (before?.status === "published") paths.add(postPath(before.kind, before.slug));
  if (after?.status === "published") paths.add(postPath(after.kind, after.slug));
  return [...paths];
}

/** Fire-and-forget announcement for one post write (see changedPostPaths). */
export function announcePostChange(before: Pick<Post, "kind" | "slug" | "status"> | null, after: Pick<Post, "kind" | "slug" | "status"> | null): void {
  const paths = changedPostPaths(before, after);
  if (paths.length) void pingIndexNow(paths);
}
