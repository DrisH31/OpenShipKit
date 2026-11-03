//
// /changelog/[slug] — the permalink for one release: the entry in full, with
// Article + BreadcrumbList JSON-LD. Drafts and unknown slugs are 404. The
// /changelog#<slug> anchor shows the same entry in the running list. The
// social card is the cover if there is one, else the entry's generated card
// at /changelog/<slug>/og.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Breadcrumbs } from "@/components/blog/breadcrumbs";
import { ChangelogEntry } from "@/components/blog/changelog-entry";
import { getPublished, isHiddenStarter } from "@/components/blog/data";
import { coverAltText, safeImageUrl } from "@/components/blog/format";
import { Container } from "@/components/marketing/layout";
import { JsonLd } from "@/components/seo/json-ld";
import { getSiteSeo, siteFeeds } from "@/components/seo/site-seo";
import { renderMarkdown } from "@/server/markdown";
import { articleJsonLd, breadcrumbJsonLd } from "@/shared/jsonld";
import { changelogEntryTitle, changelogFeed, OG_IMAGE_SIZE, pageMetadata } from "@/shared/seo";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getPublished("changelog", slug);
  if (!entry) return {};
  const { name, locale, twitterSite, showcase } = await getSiteSeo();
  const cover = safeImageUrl(entry.coverImage);
  return pageMetadata({
    // Absolute either way: the brand once, not "Acme 2.0 · Changelog · Acme".
    title: entry.seoTitle || changelogEntryTitle(entry.title, name),
    absoluteTitle: true,
    description: entry.seoDescription || entry.description || `What changed in ${entry.title}.`,
    path: `/changelog/${entry.slug}`,
    type: "article",
    // A cover wins; without one, the entry's generated 1200×630 card at its stable URL.
    image: cover ?? `/changelog/${entry.slug}/og`,
    ...(cover ? {} : { imageSize: OG_IMAGE_SIZE }),
    imageAlt: coverAltText(entry) || entry.title,
    // Starter text on a renamed site: readable, but not indexed as this site's own (see isStarterContent).
    noindex: isHiddenStarter(entry, showcase),
    publishedTime: entry.publishedAt,
    modifiedTime: entry.updatedAt,
    tags: entry.tags,
    siteName: name,
    locale,
    twitterSite,
    feeds: siteFeeds(name, [changelogFeed(name)]),
  });
}

export default async function ChangelogEntryPage({ params }: { params: Params }) {
  const { slug } = await params;
  const entry = await getPublished("changelog", slug);
  if (!entry) notFound();
  const { base, name, locale } = await getSiteSeo();
  const path = `/changelog/${entry.slug}`;
  const cover = safeImageUrl(entry.coverImage);
  // The same count the blog states: words of the rendered, visible text.
  const { wordCount } = renderMarkdown(entry.body, { siteOrigin: base });
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Changelog", path: "/changelog" },
    { name: entry.title, path },
  ];

  return (
    <>
      <JsonLd
        data={[
          articleJsonLd({
            base,
            path,
            type: "Article",
            headline: entry.title,
            description: entry.description,
            // The cover if there is one, else this entry's generated card at its stable URL.
            images: [cover ?? `${path}/og`],
            datePublished: entry.publishedAt,
            dateModified: entry.updatedAt,
            authorName: entry.authorName,
            tags: entry.tags,
            wordCount,
            publisherName: name,
            publisherLogo: "/apple-icon",
          }),
          breadcrumbJsonLd(base, crumbs),
        ]}
      />
      <Container className="pt-10 pb-section md:pt-14">
        <Breadcrumbs crumbs={crumbs} className="mb-10" />
        <ChangelogEntry entry={entry} base={base} locale={locale} standalone />
        <div className="mt-16 border-t border-line pt-8 md:ml-[calc(12rem+3rem)]">
          <Link
            href={`/changelog#${entry.slug}`}
            className="inline-flex items-center gap-2 rounded-sm text-small font-semibold text-ink hover:underline pointer-coarse:min-h-11"
          >
            <ArrowLeftIcon aria-hidden className="size-4" />
            The full changelog
          </Link>
        </div>
      </Container>
    </>
  );
}
