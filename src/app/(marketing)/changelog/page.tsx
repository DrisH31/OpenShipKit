//
// /changelog — every published changelog entry rendered in full, newest
// first, ten a page, each with its date and an anchor (/changelog#<slug>) and
// a permalink (/changelog/<slug>). CollectionPage JSON-LD. Pages past the
// first are titled by the date of their newest entry (see pageLabel), which
// the canonical ?cursor URL alone fixes, and are noindex, follow: publishing
// an entry moves every cursor boundary (see /blog). Read failures throw.
//

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChangelogEntry } from "@/components/blog/changelog-entry";
import { CHANGELOG_PAGE_SIZE, cleanCursor, getListedPage, paginate, parseTrail } from "@/components/blog/data";
import { pageLabel } from "@/components/blog/format";
import { Pager } from "@/components/blog/pager";
import { Container } from "@/components/marketing/layout";
import { Eyebrow } from "@/components/marketing/type";
import { JsonLd } from "@/components/seo/json-ld";
import { getSiteSeo } from "@/components/seo/site-seo";
import { breadcrumbJsonLd, collectionPageJsonLd } from "@/shared/jsonld";
import { blogFeed, changelogFeed, pageMetadata } from "@/shared/seo";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const lead = (name: string) => `New features, fixes and breaking changes in ${name}, newest first.`;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const cursor = cleanCursor(sp.cursor);
  // The same cached read as the page: a later page is titled by its newest entry's date.
  const [{ name, locale, twitterSite, ogImage, cardAlt }, page] = await Promise.all([getSiteSeo(), getListedPage("changelog", CHANGELOG_PAGE_SIZE, cursor, null)]);
  const { canonical } = paginate("/changelog", cursor, parseTrail(sp.trail), null);
  return pageMetadata({
    title: cursor ? `Changelog · ${pageLabel(page.items[0]?.publishedAt, locale)}` : "Changelog",
    description: lead(name),
    path: canonical,
    noindex: Boolean(cursor),
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
    siteName: name,
    locale,
    twitterSite,
    feeds: [changelogFeed(name), blogFeed(name)],
  });
}

export default async function ChangelogPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const cursor = cleanCursor(sp.cursor);
  const [{ base, name, locale }, page] = await Promise.all([getSiteSeo(), getListedPage("changelog", CHANGELOG_PAGE_SIZE, cursor, null)]);
  if (cursor && page.items.length === 0) notFound();
  const nav = paginate("/changelog", cursor, parseTrail(sp.trail), page.nextCursor);

  const jsonLd = [
    collectionPageJsonLd({
      base,
      path: nav.canonical,
      name: `${name} changelog`,
      description: lead(name),
      items: page.items.map((e) => ({ name: e.title, path: `/changelog/${e.slug}`, datePublished: e.publishedAt })),
    }),
    breadcrumbJsonLd(base, [
      { name: "Home", path: "/" },
      { name: "Changelog", path: "/changelog" },
    ]),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />
      <Container className="pt-12 pb-section md:pt-16">
        <header className="flex max-w-3xl flex-col gap-6">
          <Eyebrow>Release notes</Eyebrow>
          <h1 className="font-display text-h2 font-bold text-ink">
            Changelog
            {!nav.isFirst && <span className="text-ink-3"> · {pageLabel(page.items[0]?.publishedAt, locale)}</span>}
          </h1>
          <p className="max-w-measure text-lead text-ink-2">{lead(name)}</p>
          <p className="text-small text-ink-3">
            <a
              href="/changelog/rss.xml"
              className="inline-flex items-center rounded-sm underline decoration-ink-faint underline-offset-4 hover:decoration-ink pointer-coarse:min-h-11"
            >
              Follow with RSS
            </a>
          </p>
        </header>

        {page.items.length > 0 ? (
          <ol className="mt-14 flex flex-col divide-y divide-line border-t border-line">
            {page.items.map((entry) => (
              <li key={entry.id} className="py-12">
                <ChangelogEntry entry={entry} base={base} locale={locale} />
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-14 rounded-xl border border-line bg-surface p-8 md:p-12">
            <h2 className="font-display text-h3 font-bold text-ink">No releases yet</h2>
            <p className="mt-3 max-w-measure text-ink-2">
              Changelog entries appear here when they’re published from the admin or through the MCP server.
            </p>
          </div>
        )}

        <Pager newerHref={nav.newerHref} newerLabel={nav.newerLabel} olderHref={nav.olderHref} label="Changelog pages" />
      </Container>
    </>
  );
}
