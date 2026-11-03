//
// The list of posts on /blog and tag pages: one <article> per post with its
// title as a real link, the summary, date, reading time and tags — all in the
// server HTML. The whole card is not one giant link, so tags stay reachable.
// Server component.
//

import Link from "next/link";
import type { Post } from "@/core/types";
import { cn } from "@/lib/utils";
import { PostMeta } from "./post-meta";
import { TagLinks } from "./tag-links";

export interface PostListItem {
  post: Post;
  readingMinutes: number;
}

export function PostList({
  items,
  locale,
  headingLevel = 2,
  className,
}: {
  items: PostListItem[];
  locale?: string;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <ol className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map(({ post, readingMinutes }) => (
        <li key={post.id}>
          <article className="grid gap-3 py-8 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-10">
            <PostMeta publishedAt={post.publishedAt} locale={locale} className="md:self-start md:pt-1.5" />
            <div className="flex min-w-0 flex-col gap-3">
              <H className="font-display text-h3 font-bold text-ink">
                <Link
                  href={`/blog/${post.slug}`}
                  className="rounded-sm decoration-ink-faint decoration-1 underline-offset-4 hover:underline"
                >
                  {post.title}
                </Link>
              </H>
              {post.description && <p className="max-w-measure text-body text-ink-2">{post.description}</p>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-small text-ink-3">{readingMinutes} min read</span>
                <TagLinks tags={post.tags} />
              </div>
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}
