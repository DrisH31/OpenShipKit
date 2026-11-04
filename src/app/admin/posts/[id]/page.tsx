//
// /admin/posts/<id> — edit one post: save, publish / unpublish, delete, see it
// live, and its change history. `?saved=` (from the create redirect) only
// picks the welcome line; it changes nothing.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLinkIcon, HistoryIcon, Trash2Icon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { BreadcrumbLeaf } from "@/components/product/app-breadcrumb";
import { PageHeader } from "@/components/product/page-header";
import { StatusBadge } from "@/components/product/status-badge";
import { MetaList } from "@/components/product/meta-list";
import { PostEditor } from "@/components/admin/post-editor";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { formatDateTime } from "@/lib/format";
import { POST_KIND, POST_STATUS } from "@/lib/status";
import { requireAdmin } from "@/server/session";
import { getPostById } from "@/server/services/posts";
import { deletePostAction, previewMarkdown, updatePostAction } from "../actions";
import { featureOn } from "@/server/profile";
import { postsListHref } from "../list-href";

export const metadata: Metadata = { title: "Edit post" };

/** The header's links: outline pills that never wrap (three share a phone's width). */
const pill = buttonVariants({ variant: "outline", size: "sm" });

export default async function EditPostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const post = await getPostById(id);
  if (!post) notFound();
  const word = POST_KIND[post.kind];
  const st = POST_STATUS[post.status];
  const justCreated = sp.saved === "published" ? "Published. It’s live now." : sp.saved === "draft" ? "Draft saved. Publish it when it’s ready." : null;

  return (
    <>
      <BreadcrumbLeaf name={post.title} />
      <PageHeader
        eyebrow={
          <Link href={postsListHref(post.kind)} className="underline-offset-4 hover:underline">
            {word.plural}
          </Link>
        }
        title={post.title}
        action={
          <>
            {/* A published blog post with the blog switched off isn't on the site: no "View live" to a 404. */}
            {post.status === "published" && (post.kind !== "post" || featureOn("blog")) ? (
              <Link href={`${word.publicPath}/${post.slug}`} target="_blank" className={pill}>
                <ExternalLinkIcon aria-hidden className="size-3.5" /> View live<span className="sr-only"> (opens a new tab)</span>
              </Link>
            ) : null}
            <Link href={`/admin/audit?entity=post&entityId=${post.id}`} className={pill}>
              <HistoryIcon aria-hidden className="size-3.5" /> History
            </Link>
            <ConfirmAction
              action={deletePostAction.bind(null, post.id)}
              trigger={
                <>
                  <Trash2Icon aria-hidden /> Delete
                </>
              }
              title={`Delete “${post.title}”?`}
              description={
                post.status === "published"
                  ? `It comes off ${word.publicPath}/${post.slug} right away. You can bring it back from the audit log.`
                  : "The draft is removed. You can bring it back from the audit log."
              }
              confirmLabel="Delete"
            />
          </>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-2">
        <StatusBadge label={st.label} tone={st.tone} />
        {post.listed || post.kind === "page" ? null : <StatusBadge label="Unlisted" tone="neutral" />}
        <MetaList>
          {post.publishedAt ? <span className="whitespace-nowrap">Published {formatDateTime(post.publishedAt)}</span> : null}
          <span className="whitespace-nowrap">Last saved {formatDateTime(post.updatedAt)}</span>
        </MetaList>
      </div>
      {justCreated ? (
        <p role="status" className="text-small text-positive">
          {justCreated}
        </p>
      ) : null}
      <PostEditor kind={post.kind} post={post} action={updatePostAction.bind(null, post.id)} preview={previewMarkdown} canPublish={post.kind !== "post" || featureOn("blog")} />
    </>
  );
}
