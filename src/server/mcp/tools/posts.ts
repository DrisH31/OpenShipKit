import "server-only";

//
// Blog posts, changelog entries and static pages (one table, three kinds).
//
// Every change goes through updatePost with the post's FULL field set
// (fullPostPatch): a field the agent did not mention keeps its stored value,
// whatever defaults the update schema applies. Writes are audited; a delete is
// undone with audit_restore.
//
// There is no scheduling: a published post is live at once whatever its
// publishedAt, so a published post dated in the future is refused
// (assertNotFutureDated) rather than going live at the top of /blog with a
// date that hasn't happened.
//

import { z } from "zod";
import { postCreateSchema, postKindSchema, postStatusSchema, postUpdateSchema, slugSchema } from "@/core/schemas";
import { ServiceError } from "@/server/services/errors";
import { createPost, deletePost, getPostById, getPostBySlug, listPosts, updatePost } from "@/server/services/posts";
import { DESTRUCTIVE, READ_ONLY, WRITE_ADDITIVE, WRITE_IDEMPOTENT, defineTool } from "../types";
import { assertNotFutureDated, fullPostPatch, paging, pagingShape, patchShape, postDetail, postSummary } from "./shared";

const postId = z.string().min(1).max(100).describe("The post's id (from posts_list or post_get)");

async function requirePost(id: string) {
  const post = await getPostById(id);
  if (!post) throw new ServiceError("not_found", `No post with id ${id}. Find it with posts_list.`);
  return post;
}

export const postsList = defineTool({
  name: "posts_list",
  title: "List posts",
  description:
    "List blog posts, changelog entries and static pages, newest first, without their bodies. Filter by kind (post | changelog | page), status (draft | published), listed (true: shown on the lists; false: unlisted), tag, or search (a phrase found in the title or body, case-insensitive). Each item has id, kind, slug, title, description, status, listed, tags, publishedAt, updatedAt, bodyChars and its public url. Pages through results with nextCursor.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({
    kind: postKindSchema.optional().describe("post = blog, changelog, page = static pages such as privacy"),
    status: postStatusSchema.optional(),
    listed: z.boolean().optional().describe("true: only posts shown on the lists; false: only unlisted ones (live but off /blog)"),
    tag: z.string().max(40).optional(),
    search: z.string().max(100).optional().describe("Text to find in the title or body: one phrase, matched case-insensitively as written"),
    ...pagingShape,
  }),
  async run(args) {
    const page = await listPosts({ kind: args.kind, status: args.status, listed: args.listed, tag: args.tag, search: args.search, ...paging(args) });
    return { items: page.items.map(postSummary), nextCursor: page.nextCursor };
  },
});

export const postGet = defineTool({
  name: "post_get",
  title: "Read a post",
  description:
    "Read one post in full, including its Markdown body, SEO fields and public url (a draft's url is a 404 until it is published). Pass id, or kind and slug together (e.g. {kind: \"page\", slug: \"privacy\"}).",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({
    id: postId.optional(),
    kind: postKindSchema.optional().describe("With slug, instead of id"),
    slug: slugSchema.optional().describe("With kind, instead of id"),
  }),
  async run(args) {
    let post;
    if (args.id) post = await getPostById(args.id);
    else if (args.kind && args.slug) post = await getPostBySlug(args.kind, args.slug);
    else throw new ServiceError("invalid", "Pass id, or kind and slug together");
    if (!post) throw new ServiceError("not_found", `No such post (${args.id ?? `${args.kind}/${args.slug}`}). Find it with posts_list.`);
    return postDetail(post);
  },
});

export const postCreate = defineTool({
  name: "post_create",
  title: "Create a post",
  description:
    "Create a blog post (kind post, the default), changelog entry or static page. It is saved as a DRAFT unless you pass status \"published\" — create drafts, show the person the result, and publish when they say so. The slug is derived from the title when omitted and must be unique within its kind. body is Markdown: start sections at ##, never #, because the title is the page's heading (check it first with render_markdown_preview). A published post can't be dated in the future (there is no scheduling). If the site has the blog switched off (OPENSHIPKIT_WITHOUT=blog; guide says), blog posts are refused: write a changelog entry or page instead. Returns the saved post with its id and url.",
  scope: "write",
  annotations: WRITE_ADDITIVE,
  input: z.strictObject(postCreateSchema.shape),
  async run(args, ctx) {
    assertNotFutureDated(args.status, args.publishedAt);
    return postDetail(await createPost(args, ctx.actor));
  },
});

export const postUpdate = defineTool({
  name: "post_update",
  title: "Edit a post",
  description:
    "Change some fields of a post by id; fields you leave out keep their current value. Read it with post_get first. Changing status here publishes or unpublishes too, but prefer post_publish / post_unpublish. listed: false takes a published post off /blog, tag pages and the home page while keeping it live at its url and in the sitemap and feed (use it instead of unpublishing a post that is merely out of date). Don't change the slug of a published post unless asked: the slug is its URL. A published post can't be dated in the future (there is no scheduling). Returns the saved post. Recorded in the audit log; audit_restore undoes it.",
  scope: "write",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({ id: postId, ...patchShape(postUpdateSchema.shape) }),
  async run({ id, ...changes }, ctx) {
    const post = await requirePost(id);
    const patch = fullPostPatch(post, changes);
    // Only when this call sets the date or the status: a title edit doesn't re-judge a stored date.
    if (changes.publishedAt !== undefined || changes.status !== undefined) assertNotFutureDated(patch.status, patch.publishedAt);
    return postDetail(await updatePost(id, patch, ctx.actor));
  },
});

export const postPublish = defineTool({
  name: "post_publish",
  title: "Publish a post",
  description:
    "Make a post live at its url, now. Its publishedAt is kept if it had one, otherwise stamped with now. To back-date it, give publishedAt (ISO 8601). There is no scheduling: a date in the future is refused, so to publish later keep the draft and call this on the day. Publishing an already published post changes nothing. Returns the post with its url.",
  scope: "write",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({
    id: postId,
    publishedAt: z.iso.datetime({ offset: true }).optional().describe("ISO 8601, not in the future, e.g. 2026-10-06T09:00:00Z; default: keep, or now"),
  }),
  async run({ id, publishedAt }, ctx) {
    const post = await requirePost(id);
    const stamp = publishedAt ?? post.publishedAt ?? new Date().toISOString();
    assertNotFutureDated("published", stamp);
    return postDetail(await updatePost(id, fullPostPatch(post, { status: "published", publishedAt: stamp }), ctx.actor));
  },
});

export const postUnpublish = defineTool({
  name: "post_unpublish",
  title: "Unpublish a post",
  description:
    "Turn a published post back into a draft: its url becomes a 404 and it leaves lists, feeds and the sitemap. Nothing is deleted, and post_publish brings it back with the same date. Returns the post.",
  scope: "write",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({ id: postId }),
  async run({ id }, ctx) {
    const post = await requirePost(id);
    return postDetail(await updatePost(id, fullPostPatch(post, { status: "draft" }), ctx.actor));
  },
});

export const postDelete = defineTool({
  name: "post_delete",
  title: "Delete a post",
  description:
    "Delete a post for good. Only when the person explicitly asks for deletion; to take a post off the site, use post_unpublish instead. The deleted post is kept in the audit log, so audit_restore can recreate it. Returns {deleted: id, auditHint}.",
  scope: "write",
  annotations: DESTRUCTIVE,
  input: z.strictObject({ id: postId }),
  async run({ id }, ctx) {
    const post = await requirePost(id);
    await deletePost(id, ctx.actor);
    return {
      deleted: id,
      title: post.title,
      auditHint: "To undo: audit_list {entity: \"post\", entityId: \"" + id + "\"} → audit_restore the post.delete entry.",
    };
  },
});

export const POST_TOOLS = [postsList, postGet, postCreate, postUpdate, postPublish, postUnpublish, postDelete];
