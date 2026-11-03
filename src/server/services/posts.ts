import "server-only";

//
// Blog posts, changelog entries and static pages (privacy, terms, about).
// Reads THROW on a backend failure — never render an empty blog.
//
// There is no scheduling: a published post is live at once whatever its
// publishedAt, so a published post dated in the future is refused
// (assertNotFutureDated) — from the admin editor, MCP and audit restore alike —
// rather than going live at the top of /blog and the feed with a date that
// hasn't happened.
//
// Two public list readers, deliberately separate functions rather than one
// with a flag (a flag invites passing the wrong value, and the mistake is
// silent — URLs just stop being advertised and rankings decay weeks later):
//   listPublished — EVERY published post, listed or not: the sitemap, RSS,
//                   llms-full.txt. Unlisted posts must stay in these.
//   listListed    — published AND listed: /blog, tag pages, the changelog
//                   list, "Keep reading", the landing page, llms.txt.
//
// A write to a published post (publish, unpublish, edit, delete) also pings
// IndexNow when INDEXNOW_KEY is set — fire and forget, after the write and
// its audit row (./indexnow.ts).
//

import type { Actor, Page, Post, PostKind, PostQuery } from "@/core/types";
import { postCreateSchema, postUpdateSchema } from "@/core/schemas";
import { slugify } from "@/shared/slug";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { recordAudit } from "./audit";
import { ServiceError, fromDataError, parseInput } from "./errors";
import { announcePostChange } from "./indexnow";

export async function listPosts(query: PostQuery): Promise<Page<Post>> {
  return (await getData()).posts.list(query);
}

type PublicListOptions = { limit?: number; cursor?: string | null; tag?: string };

/** Every published item of `kind`, listed or not — the sitemap, feeds and llms-full.txt (see the header). */
export async function listPublished(kind: PostKind, opts: PublicListOptions = {}) {
  return listPosts({ kind, status: "published", ...opts });
}

/** Published AND listed items of `kind` — the indexes: /blog, tag pages, the landing page (see the header). */
export async function listListed(kind: PostKind, opts: PublicListOptions = {}) {
  return listPosts({ kind, status: "published", listed: true, ...opts });
}

export async function getPostById(id: string): Promise<Post | null> {
  return (await getData()).posts.getById(id);
}

/** A published post by slug, or null (drafts are invisible to the public site). */
export async function getPublishedPost(kind: PostKind, slug: string): Promise<Post | null> {
  const post = await (await getData()).posts.getBySlug(kind, slug);
  return post && post.status === "published" ? post : null;
}

export async function getPostBySlug(kind: PostKind, slug: string): Promise<Post | null> {
  return (await getData()).posts.getBySlug(kind, slug);
}

/** Tags on published, listed items, with counts (what the tag pages list). */
export async function listTags(kind: PostKind) {
  return (await getData()).posts.tags(kind);
}

/** Clock skew a "now" typed in another tab (or by an agent) may carry. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

/** Refuse a published post dated more than a few minutes ahead (see the header). */
export function assertNotFutureDated(status: string | undefined, publishedAt: string | null | undefined): void {
  if (status !== "published" || !publishedAt) return;
  const at = Date.parse(publishedAt);
  if (Number.isNaN(at) || at <= Date.now() + FUTURE_SLACK_MS) return;
  throw new ServiceError(
    "invalid",
    `publishedAt ${publishedAt} is in the future. Publishing is immediate (there is no scheduling), so a published post can't be dated ahead: keep it a draft and publish it on the day, or pick a date that has passed.`,
    [{ path: "publishedAt", message: "A published post can’t be dated in the future. Keep it a draft, or pick a date that has passed." }],
  );
}

/** Same instant (or both empty), whatever the string format. */
function sameDate(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return Date.parse(a) === Date.parse(b);
}

async function requirePost(id: string): Promise<Post> {
  const post = await getPostById(id);
  if (!post) throw new ServiceError("not_found", `No post with id ${id}`);
  return post;
}

export async function createPost(input: unknown, actor: Actor): Promise<Post> {
  assertNotDemo(actor);
  const parsed = parseInput(postCreateSchema, input);
  const slug = parsed.slug ?? slugify(parsed.title);
  if (!slug) throw new ServiceError("invalid", "Could not derive a slug from the title, so give the post an explicit slug");
  const data = await getData();
  if (await data.posts.getBySlug(parsed.kind, slug)) {
    throw new ServiceError("conflict", `A ${parsed.kind} with slug "${slug}" already exists`);
  }
  assertNotFutureDated(parsed.status, parsed.publishedAt);
  const post = await data.posts
    .create({
      ...parsed,
      slug,
      publishedAt: parsed.status === "published" ? (parsed.publishedAt ?? new Date().toISOString()) : parsed.publishedAt,
    })
    .catch(fromDataError);
  await recordAudit(actor, "post.create", "post", post.id, null, post);
  announcePostChange(null, post);
  return post;
}

export async function updatePost(id: string, patch: unknown, actor: Actor): Promise<Post> {
  assertNotDemo(actor);
  const parsed = parseInput(postUpdateSchema, patch);
  const before = await requirePost(id);
  const data = await getData();
  if (parsed.slug && parsed.slug !== before.slug) {
    const clash = await data.posts.getBySlug(before.kind, parsed.slug);
    if (clash && clash.id !== id) throw new ServiceError("conflict", `Slug "${parsed.slug}" is taken`);
  }
  const next = { ...parsed };
  if (next.status === "published" && !before.publishedAt && !next.publishedAt) next.publishedAt = new Date().toISOString();
  // Judge the date only when this change sets the status or the date: a title
  // edit (or a full patch that repeats both) doesn't re-judge a stored date.
  const statusChanges = next.status !== undefined && next.status !== before.status;
  const dateChanges = next.publishedAt !== undefined && !sameDate(next.publishedAt, before.publishedAt);
  if (statusChanges || dateChanges) {
    assertNotFutureDated(next.status ?? before.status, next.publishedAt === undefined ? before.publishedAt : next.publishedAt);
  }
  const post = await data.posts.update(id, next).catch(fromDataError);
  const action = before.status !== post.status ? (post.status === "published" ? "post.publish" : "post.unpublish") : "post.update";
  await recordAudit(actor, action, "post", id, before, post);
  announcePostChange(before, post);
  return post;
}

export async function setPostStatus(id: string, status: "draft" | "published", actor: Actor): Promise<Post> {
  assertNotDemo(actor);
  return updatePost(id, { status }, actor);
}

export async function deletePost(id: string, actor: Actor): Promise<void> {
  assertNotDemo(actor);
  const before = await requirePost(id);
  await (await getData()).posts.delete(id);
  await recordAudit(actor, "post.delete", "post", id, before, null);
  announcePostChange(before, null);
}
