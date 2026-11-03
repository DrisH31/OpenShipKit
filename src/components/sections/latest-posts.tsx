import "server-only";

//
// The newest blog posts on the landing page (content key "latestPosts"):
// published and LISTED posts only (listListed — an unlisted post is live but
// never promoted), newest first, in the same list the blog uses. Hidden when
// the section is off or there are no posts. On a renamed site the starter
// posts still in OpenShipKit's words are left out, as they are from the
// sitemap and feeds (isHiddenStarter).
//
// ─── When the database is down ───────────────────────────────────────────────
// SPEC invariant 3: a failed read throws — content included. In a real outage
// the page never gets this far: the root layout's and the sections' content
// reads throw first, and the visitor gets the error page (500, noindex)
// while /api/health answers 503. What the catch in newestPosts() covers is
// narrower: the content reads succeeded but the posts read failed (a posts
// query erroring while the content table still answers). Then it is LOGGED and
// the section renders NOTHING, exactly as if it were switched off, rather
// than failing a page whose every other section is real. That is not the
// false 200 the invariant forbids: no page claims "no posts", nothing is
// cached, there is no default post to show instead, and /blog, the sitemap
// and the feeds still throw (500) on the same failure, so crawlers learn
// nothing false.
//

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { PostList } from "@/components/blog/post-list";
import { isHiddenStarter } from "@/components/blog/data";
import { Section } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { getSiteSeo } from "@/components/seo/site-seo";
import { buttonVariants } from "@/components/ui/button";
import type { Post } from "@/core/types";
import { readingMinutes } from "@/server/markdown";
import { getContent } from "@/server/services/content";
import { listListed } from "@/server/services/posts";
import { log } from "@/server/log";
import { featureOn } from "@/server/profile";

/** The newest listed posts, or null when they can't be read (logged; see the header). */
async function newestPosts(count: number, showcase: boolean): Promise<Post[] | null> {
  try {
    // A few extra, in case starter posts are filtered out on a renamed site.
    const page = await listListed("post", { limit: count + 3 });
    return page.items.filter((p) => !isHiddenStarter(p, showcase)).slice(0, count);
  } catch (error) {
    log.error("landing", "latest posts unavailable; section hidden", error);
    return null;
  }
}

export async function LatestPosts() {
  if (!featureOn("blog")) return null; // OPENSHIPKIT_WITHOUT=blog: no posts to point at
  const section = await getContent("latestPosts");
  if (!section.enabled) return null;
  const { locale, showcase } = await getSiteSeo();
  const posts = await newestPosts(section.count, showcase);
  if (!posts || posts.length === 0) return null;

  return (
    <Section aria-labelledby="latest-posts-title">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <SectionHeader id="latest-posts-title" eyebrow={section.eyebrow || undefined} title={section.title} lead={section.subtitle || undefined} className="max-w-3xl" />
        {section.linkLabel ? (
          <Link href="/blog" className={buttonVariants({ variant: "outline", className: "group w-full shrink-0 md:w-auto" })}>
            {section.linkLabel}
            <ArrowRightIcon
              aria-hidden
              data-icon="inline-end"
              className="transition-transform duration-(--dur-hover) ease-out-quart group-hover:translate-x-0.5"
            />
          </Link>
        ) : null}
      </div>
      <PostList className="mt-10" headingLevel={3} locale={locale} items={posts.map((post) => ({ post, readingMinutes: readingMinutes(post.body) }))} />
    </Section>
  );
}
