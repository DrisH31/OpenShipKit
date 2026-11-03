"use server";

//
// Posts: create, save, publish / unpublish, delete, and the editor's preview.
// requireAdmin() first in each. The submit button's `intent` says what the
// person meant: "save" keeps the status, "publish" / "unpublish" change it
// (the service stamps publishedAt on first publish and audits either way).
// An edit sends publishedAt only when the person changed the field: the input
// shows minutes, so echoing it back would cut the stored seconds, and on a
// published post an emptied field keeps the date rather than re-dating it.
// `listed` is read only when the form carries the checkbox (`listedField`):
// an unticked box posts nothing, so its absence alone can't mean "unlisted".
//

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { PostKind } from "@/core/types";
import { attempt, failure, success, type ActionState } from "@/lib/action-state";
import { changedDateTimeLocal, dateTimeLocal, list, nullableText, text } from "@/lib/form-data";
import { siteUrl } from "@/server/env";
import { renderMarkdown } from "@/server/markdown";
import { actorFor, requireAdmin } from "@/server/session";
import { createPost, deletePost, getPostById, updatePost } from "@/server/services/posts";

const KINDS: readonly PostKind[] = ["post", "changelog", "page"];

/** The editor's fields, as the service's input. Empty slug = derive / keep. publishedAt is read by each action. */
function fieldsFrom(form: FormData) {
  const slug = text(form, "slug");
  const coverImage = nullableText(form, "coverImage");
  return {
    title: text(form, "title"),
    ...(slug ? { slug } : {}),
    description: text(form, "description"),
    body: typeof form.get("body") === "string" ? String(form.get("body")) : "",
    tags: list(form, "tags"),
    coverImage,
    // The description means nothing without a cover: no cover, no alt.
    coverAlt: coverImage ? nullableText(form, "coverAlt") : null,
    authorName: nullableText(form, "authorName"),
    seoTitle: nullableText(form, "seoTitle"),
    seoDescription: nullableText(form, "seoDescription"),
    ...(form.has("listedField") ? { listed: form.get("listed") === "on" } : {}),
  };
}

export async function createPostAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const kind = text(form, "kind") as PostKind;
  if (!KINDS.includes(kind)) return failure("Pick what you’re writing: a post, a changelog entry or a page.");
  const publish = text(form, "intent") === "publish";
  let id = "";
  const result = await attempt("admin.posts.create", async () => {
    const post = await createPost({ kind, ...fieldsFrom(form), publishedAt: dateTimeLocal(form, "publishedAt"), status: publish ? "published" : "draft" }, actorFor(admin));
    id = post.id;
    return publish ? "Published." : "Draft saved.";
  });
  if (!result.ok) return result;
  redirect(`/admin/posts/${id}?saved=${publish ? "published" : "draft"}`);
}

export async function updatePostAction(id: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const intent = text(form, "intent");
  const status = intent === "publish" ? "published" : intent === "unpublish" ? "draft" : undefined;
  return attempt("admin.posts.update", async () => {
    const current = await getPostById(id);
    const publishedAt = changedDateTimeLocal(form, "publishedAt", { keepWhenEmpty: current?.status === "published" });
    await updatePost(id, { ...fieldsFrom(form), ...(publishedAt !== undefined ? { publishedAt } : {}), ...(status ? { status } : {}) }, actorFor(admin));
    refresh();
    return intent === "publish" ? "Published. It’s live now." : intent === "unpublish" ? "Unpublished. It’s a draft again and off the site." : "Saved.";
  });
}

export async function deletePostAction(id: string): Promise<ActionState> {
  const admin = await requireAdmin();
  const result = await attempt("admin.posts.delete", async () => {
    await deletePost(id, actorFor(admin));
    return "Deleted.";
  });
  if (!result.ok) return result;
  redirect("/admin/posts?deleted=1");
}

/**
 * The preview: the body through the same renderer and sanitiser the public
 * page uses. Returns the HTML in `data.html`; nothing is saved.
 */
export async function previewMarkdown(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const body = typeof form.get("body") === "string" ? String(form.get("body")) : "";
  if (body.length > 200_000) return failure("That’s longer than a post can be (200,000 characters).");
  const rendered = renderMarkdown(body, { siteOrigin: siteUrl() });
  return success(`About ${rendered.readingMinutes} min read.`, { html: rendered.html });
}
