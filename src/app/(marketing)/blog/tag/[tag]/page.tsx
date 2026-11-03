//
// /blog/tag/[tag] — published, listed posts with one tag. A tag with fewer than three
// posts is thin, and a tag on nearly every post repeats /blog, so both are
// noindex (still followed: their posts are what should rank) and left out of
// the sitemap (isIndexableTag). Pages past the first are noindex too (see
// /blog). An unknown tag is a 404, not an empty page.
//

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListPage } from "@/components/blog/list-page";
import { PAGE_SIZE, cleanCursor, getListedPage, getTags, isCatchAllTag, paginate, parseTrail } from "@/components/blog/data";
import { MIN_INDEXABLE_TAG_POSTS, pageLabel, tagHref, tagLabel } from "@/components/blog/format";
import { getSiteSeo } from "@/components/seo/site-seo";
import { pageMetadata } from "@/shared/seo";
import { requireFeature } from "@/server/profile";

type Params = Promise<{ tag: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function decodeTag(raw: string): string | null {
  try {
    const tag = decodeURIComponent(raw).trim();
    return tag && tag.length <= 40 ? tag : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  requireFeature("blog"); // OPENSHIPKIT_WITHOUT=blog: a plain 404
  const [{ tag: raw }, sp] = await Promise.all([params, searchParams]);
  const tag = decodeTag(raw);
  if (!tag) return {};
  const cursor = cleanCursor(sp.cursor);
  // The same cached reads as the page: a later page is titled by its newest post's date.
  const [{ name, locale, twitterSite, ogImage, cardAlt }, tags, page] = await Promise.all([getSiteSeo(), getTags("post"), getListedPage("post", PAGE_SIZE, cursor, tag)]);
  const count = tags.find((t) => t.tag === tag)?.count ?? 0;
  const { canonical } = paginate(tagHref(tag), cursor, parseTrail(sp.trail), null);
  const label = tagLabel(tag);
  // Thin, a copy of /blog, or a cursor page (whose URL moves as posts are published): noindex, follow.
  const noindex = Boolean(cursor) || count < MIN_INDEXABLE_TAG_POSTS || (await isCatchAllTag(count));
  return pageMetadata({
    title: `Posts tagged “${label}”${cursor ? ` · ${pageLabel(page.items[0]?.publishedAt, locale)}` : ""}`,
    description: `${count} ${count === 1 ? "post" : "posts"} on the ${name} blog tagged “${label}”.`,
    path: canonical,
    noindex,
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
    siteName: name,
    locale,
    twitterSite,
  });
}

export default async function BlogTagPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  requireFeature("blog");
  const [{ tag: raw }, sp] = await Promise.all([params, searchParams]);
  const tag = decodeTag(raw);
  if (!tag) notFound();
  const cursor = cleanCursor(sp.cursor);
  const [{ base, locale }, page, tags] = await Promise.all([
    getSiteSeo(),
    getListedPage("post", PAGE_SIZE, cursor, tag),
    getTags("post"),
  ]);
  if (page.items.length === 0) notFound();

  const basePath = tagHref(tag);
  const nav = paginate(basePath, cursor, parseTrail(sp.trail), page.nextCursor);
  const count = tags.find((t) => t.tag === tag)?.count ?? page.items.length;
  const label = tagLabel(tag);

  return (
    <ListPage
      base={base}
      locale={locale}
      path={nav.canonical}
      eyebrow="Blog"
      title={`Tagged “${label}”`}
      lead={`${count} ${count === 1 ? "post" : "posts"} tagged “${label}”, newest first.`}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: label, path: basePath },
      ]}
      posts={page.items}
      tags={tags}
      currentTag={tag}
      newerHref={nav.newerHref}
      newerLabel={nav.newerLabel}
      olderHref={nav.olderHref}
      pageLabel={nav.isFirst ? null : pageLabel(page.items[0]?.publishedAt, locale)}
    />
  );
}
