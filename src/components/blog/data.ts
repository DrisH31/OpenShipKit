import "server-only";

//
// Request-scoped reads for the blog, changelog and legal routes. Wrapped in
// React's cache() so generateMetadata, the page and its JSON-LD share one
// read. Reads THROW on a backend failure (the services do) — never caught
// here: an empty blog served as 200 would be indexed as empty.
//
// Two kinds of list, on purpose (src/server/services/posts.ts says why):
//   getListedPage                          — the indexes: /blog, tag pages, the
//                                            changelog list, related posts, llms.txt.
//   getAllPublished / getPublishedRefs     — the corpus: sitemap, RSS, llms-full.txt.
//                                            Unlisted posts stay in these.
//

import { cache } from "react";
import { notFound } from "next/navigation";
import { DataError, MAX_LIMIT } from "@/core/data";
import type { Post, PostKind } from "@/core/types";
import { isStarterContent } from "@/content/seed-posts";
import { getPublishedPost, listListed, listPublished, listTags } from "@/server/services/posts";
import { CATCH_ALL_TAG_PERCENT, isUnfinishedTemplate } from "./format";

/** Posts per page on /blog and tag pages. */
export const PAGE_SIZE = 12;

/** Changelog entries per page on /changelog (rendered in full). */
export const CHANGELOG_PAGE_SIZE = 10;

/** Opaque cursors from the adapters are short; anything longer is junk or abuse. */
export function cleanCursor(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || v.length > 200) return null;
  return v;
}

/**
 * The trail of earlier cursors ("" = the first page), so "Newer" can link back
 * without a reverse cursor. No trail param is an unknown past ([]); an empty
 * one ("?trail=") is the first page alone ([""]).
 */
export function parseTrail(value: string | string[] | undefined): string[] {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === undefined) return [];
  if (v === "") return [""];
  return v
    .split(",")
    .slice(-50)
    .map((c) => {
      try {
        return decodeURIComponent(c);
      } catch {
        return "";
      }
    })
    .filter((c) => c.length <= 200);
}

/**
 * The href for a list page. Each cursor in the trail is encoded on its own,
 * so a cursor containing a comma survives the join.
 */
export function pageHref(basePath: string, cursor: string | null, trail: string[]): string {
  if (!cursor) return basePath;
  const params = new URLSearchParams({ cursor });
  // Set even when it joins to "" (the first page alone): no param means "unknown past".
  if (trail.length) params.set("trail", trail.map((c) => encodeURIComponent(c)).join(","));
  return `${basePath}?${params.toString()}`;
}

export const getPublished = cache(async (kind: PostKind, slug: string): Promise<Post | null> => getPublishedPost(kind, slug));

/** True for the store's "that cursor isn't one of mine" error (DataError code "invalid"). */
function isInvalidCursor(error: unknown): boolean {
  return error instanceof DataError && error.code === "invalid";
}

/**
 * One page of published, LISTED items — what an index shows. A cursor the
 * store rejects (hand-edited, from another store, or junk) is a dead URL: 404,
 * not a 500. Every other failure still throws.
 */
export const getListedPage = cache(async (kind: PostKind, limit: number, cursor: string | null, tag: string | null) => {
  try {
    return await listListed(kind, { limit, cursor, ...(tag ? { tag } : {}) });
  } catch (error) {
    if (cursor && isInvalidCursor(error)) notFound();
    throw error;
  }
});

export const getTags = cache(async (kind: PostKind) => listTags(kind));

/**
 * Every published item of a kind, newest first, following cursors. For the
 * sitemap, RSS, llms-full.txt and prev/next. Capped so a runaway store can't
 * turn one request into an unbounded scan.
 */
export const getAllPublished = cache(async (kind: PostKind, cap = 5000): Promise<Post[]> => {
  const out: Post[] = [];
  let cursor: string | null = null;
  do {
    const page = await listPublished(kind, { limit: 200, cursor });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < cap);
  return out.slice(0, cap);
});

/** What the sitemap needs of a published item: no body. */
export interface PublishedRef {
  slug: string;
  updatedAt: string;
  tags: string[];
  /** On the indexes. Unlisted items stay in the sitemap; only their tag pages leave them out. */
  listed: boolean;
  /** A legal page still carrying the seeded template's placeholders (noindex; see isUnfinishedTemplate). */
  unfinished: boolean;
  /** A starter post or changelog entry still in OpenShipKit's words (see isStarterContent; hidden only on a renamed site). */
  starter: boolean;
}

/**
 * Every published item of a kind as a bodiless ref, newest first, following
 * cursors. Unlike getAllPublished it drops each page's bodies as soon as the
 * page is read, so memory stays at one page of 200 however large the blog
 * grows. (It still reads full rows: the DataStore has no summary projection
 * yet.) Capped like getAllPublished.
 */
export const getPublishedRefs = cache(async (kind: PostKind, cap = 5000): Promise<PublishedRef[]> => {
  const out: PublishedRef[] = [];
  let cursor: string | null = null;
  do {
    const page = await listPublished(kind, { limit: 200, cursor });
    for (const p of page.items) {
      out.push({ slug: p.slug, updatedAt: p.updatedAt, tags: p.tags, listed: p.listed, unfinished: isUnfinishedTemplate(p), starter: isStarterContent(p) });
    }
    cursor = page.nextCursor;
  } while (cursor && out.length < cap);
  return out.slice(0, cap);
});

/**
 * True when a published item is kept out of search and the machine-readable
 * indexes on this site: a starter post or changelog entry (isStarterContent)
 * on a site that is no longer the OpenShipKit showcase. The page still
 * renders, noindex; the sitemap, RSS feeds and llms files leave it out.
 */
export function isHiddenStarter(post: { kind: string; slug: string; title: string; body: string }, showcase: boolean): boolean {
  return !showcase && isStarterContent(post);
}

/**
 * Whether a tag with `count` posts is on at least CATCH_ALL_TAG_PERCENT of all
 * listed posts (isCatchAllShare) — its page would repeat /blog, so it's
 * noindex. Reads only as many items as the answer needs, in pages of
 * MAX_LIMIT: a read that comes back short gives the exact total.
 */
export const isCatchAllTag = cache(async (count: number): Promise<boolean> => {
  if (count <= 0) return false;
  // Catch-all iff total <= count * 100 / percent; reading one past that settles it.
  const enough = Math.floor((count * 100) / CATCH_ALL_TAG_PERCENT) + 1;
  let seen = 0;
  let cursor: string | null = null;
  do {
    const page = await listListed("post", { limit: Math.min(MAX_LIMIT, enough - seen), cursor });
    seen += page.items.length;
    cursor = page.nextCursor;
  } while (cursor && seen < enough);
  return seen < enough;
});

export interface Pagination {
  /** True on the first page (no cursor). Later pages are labelled by date, not number: see pageLabel in ./format. */
  isFirst: boolean;
  newerHref: string | null;
  /**
   * "Newer" when newerHref is the page just before this one (the trail says
   * which); "Newest" when it can only point at the first page because the
   * visitor arrived without a trail — from the canonical URL, a search result
   * or a shared link. A bare cursor can't be walked backwards.
   */
  newerLabel: "Newer" | "Newest";
  olderHref: string | null;
  /** The canonical URL path of this page (cursor kept, trail dropped). */
  canonical: string;
}

/**
 * Newer/older links for a cursor-paginated list. The trail lists the cursors
 * of the pages before this one: "" (the first page) first, the page just
 * before this one last. It is only ever a navigation aid. Nothing a crawler indexes depends on it: the
 * canonical is the cursor alone, and pages past the first are titled by the
 * date of their newest item (the same with or without a trail), so a page
 * fetched at its canonical URL says exactly what it says when walked to.
 */
export function paginate(basePath: string, cursor: string | null, trail: string[], nextCursor: string | null): Pagination {
  if (!cursor) {
    return { isFirst: true, newerHref: null, newerLabel: "Newer", olderHref: nextCursor ? pageHref(basePath, nextCursor, [""]) : null, canonical: basePath };
  }
  const known = trail.length > 0;
  const previous = known ? trail[trail.length - 1] : "";
  return {
    isFirst: false,
    newerHref: pageHref(basePath, previous || null, known ? trail.slice(0, -1) : []),
    newerLabel: known ? "Newer" : "Newest",
    olderHref: nextCursor ? pageHref(basePath, nextCursor, [...trail, cursor]) : null,
    canonical: `${basePath}?${new URLSearchParams({ cursor }).toString()}`,
  };
}
