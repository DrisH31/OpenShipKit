//
// /admin/posts/new?kind=post|changelog|page — a blank editor. Saving creates
// the post (draft, or published straight away) and lands on its own page.
//

import type { Metadata } from "next";
import Link from "next/link";
import type { PostKind } from "@/core/types";
import { PageHeader } from "@/components/product/page-header";
import { PostEditor } from "@/components/admin/post-editor";
import { POST_KIND } from "@/lib/status";
import { requireAdmin } from "@/server/session";
import { createPostAction, previewMarkdown } from "../actions";
import { featureOn } from "@/server/profile";
import { notFound } from "next/navigation";
import { postsListHref } from "../list-href";

export const metadata: Metadata = { title: "New post" };

export default async function NewPostPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const kind: PostKind = sp.kind === "changelog" ? "changelog" : sp.kind === "page" ? "page" : "post";
  // OPENSHIPKIT_WITHOUT=blog: no new blog posts (the service refuses them too), so no editor for one.
  if (kind === "post" && !featureOn("blog")) notFound();
  const word = POST_KIND[kind];
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={postsListHref(kind)} className="underline-offset-4 hover:underline">
            {word.plural}
          </Link>
        }
        title={`New ${word.label.toLowerCase()}`}
        answer={kind === "page" ? `Pages live at ${word.publicPath}/<address> and aren’t listed on the blog.` : "It stays a draft, off the site, until you publish it."}
      />
      <PostEditor kind={kind} post={null} action={createPostAction} preview={previewMarkdown} />
    </>
  );
}
