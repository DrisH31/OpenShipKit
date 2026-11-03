//
// /blog — every published, listed post (unlisted ones stay live at their URL
// and in the sitemap and feed, just not here), newest first, 12 a page via ?cursor (with
// rel="prev"/"next" links), a tag filter, and CollectionPage JSON-LD. Page 2+
// keeps its own canonical and is titled by the date of its newest post, but is
// noindex, follow: a cursor is the last row's sort key, so publishing a post
// moves every boundary and mints new ?cursor URLs that overlap the old ones.
// Crawlers still follow the pager to every post, and every post is in the
// sitemap. A read failure throws to the error page; it never renders an empty blog.
//

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListPage } from "@/components/blog/list-page";
import { PAGE_SIZE, cleanCursor, getListedPage, getTags, paginate, parseTrail } from "@/components/blog/data";
import { pageLabel } from "@/components/blog/format";
import { getSiteSeo } from "@/components/seo/site-seo";
import { pageMetadata } from "@/shared/seo";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function copy(name: string) {
  return {
    title: "Blog",
    heading: "Guides and notes",
    lead: `How-tos, release notes and the thinking behind ${name}.`,
  };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const cursor = cleanCursor(sp.cursor);
  // The same cached read as the page: the title of a later page needs its newest post's date.
  const [{ name, locale, twitterSite, ogImage, cardAlt }, page] = await Promise.all([getSiteSeo(), getListedPage("post", PAGE_SIZE, cursor, null)]);
  const { title, lead } = copy(name);
  const { canonical } = paginate("/blog", cursor, parseTrail(sp.trail), null);
  return pageMetadata({
    title: cursor ? `${title} · ${pageLabel(page.items[0]?.publishedAt, locale)}` : title,
    description: lead,
    path: canonical,
    // Cursor pages shift as posts are published (see the header): followed, not indexed.
    noindex: Boolean(cursor),
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
    siteName: name,
    locale,
    twitterSite,
  });
}

export default async function BlogIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const cursor = cleanCursor(sp.cursor);
  const [{ base, name, locale }, page, tags] = await Promise.all([
    getSiteSeo(),
    getListedPage("post", PAGE_SIZE, cursor, null),
    getTags("post"),
  ]);
  // A cursor past the end is a dead URL, not an empty blog.
  if (cursor && page.items.length === 0) notFound();

  const { title, heading, lead } = copy(name);
  const nav = paginate("/blog", cursor, parseTrail(sp.trail), page.nextCursor);

  return (
    <ListPage
      base={base}
      locale={locale}
      path={nav.canonical}
      eyebrow="Blog"
      title={title}
      heading={heading}
      lead={lead}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
      ]}
      posts={page.items}
      tags={tags}
      currentTag={null}
      newerHref={nav.newerHref}
      newerLabel={nav.newerLabel}
      olderHref={nav.olderHref}
      pageLabel={nav.isFirst ? null : pageLabel(page.items[0]?.publishedAt, locale)}
    />
  );
}
