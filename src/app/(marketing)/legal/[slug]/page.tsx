//
// /legal/[slug] — static pages (kind "page"): privacy, terms, and anything
// else an admin publishes as a page. Indexed on purpose: real privacy and
// terms pages are trust signals. "Last updated" is the page's updatedAt, so
// it moves when the text does. Drafts and unknown slugs are 404.
//
// Except while a page is still the seeded template: one that carries a
// "[Company name]"-style placeholder is noindex (and left out of the sitemap
// and llms files), and admins see which blanks remain. Fill them in and the
// page is indexed on the next request — nothing to switch on.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/blog/article-body";
import { Breadcrumbs } from "@/components/blog/breadcrumbs";
import { getPublished } from "@/components/blog/data";
import { formatPublishDate, isoDay, templatePlaceholders } from "@/components/blog/format";
import { ArticleToc } from "@/components/blog/toc";
import { Container } from "@/components/marketing/layout";
import { JsonLd } from "@/components/seo/json-ld";
import { getSiteSeo } from "@/components/seo/site-seo";
import type { User } from "@/core/types";
import { renderMarkdown } from "@/server/markdown";
import { getCurrentUser } from "@/server/session";
import { breadcrumbJsonLd, jsonLdIds } from "@/shared/jsonld";
import { absoluteUrl, pageMetadata } from "@/shared/seo";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublished("page", slug);
  if (!page) return {};
  const { name, locale, twitterSite, ogImage, cardAlt } = await getSiteSeo();
  return pageMetadata({
    title: page.seoTitle || page.title,
    absoluteTitle: Boolean(page.seoTitle),
    description: page.seoDescription || page.description || `${page.title} for ${name}.`,
    path: `/legal/${page.slug}`,
    noindex: templatePlaceholders(page.body).length > 0,
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
    siteName: name,
    locale,
    twitterSite,
  });
}

/** The signed-in admin, or null. A failed session read only hides the notice; it never breaks a public page. */
async function viewingAdmin(): Promise<User | null> {
  try {
    const user = await getCurrentUser();
    return user?.role === "admin" ? user : null;
  } catch {
    return null;
  }
}

/** Shown to admins only: the template blanks still on this page, and where to fill them in. */
function TemplateNotice({ placeholders }: { placeholders: string[] }) {
  return (
    <div role="note" className="mb-10 max-w-3xl rounded-xl border border-line-strong bg-warning-soft px-5 py-4 text-small text-ink">
      <p className="font-semibold">This page is still the template, so search engines are told not to index it.</p>
      <p className="mt-1 text-ink-2">
        Replace {placeholders.join(", ")} in{" "}
        <Link href="/admin/posts" className="rounded-sm underline underline-offset-4">
          Admin → Posts
        </Link>
        , and have it checked by someone qualified. It’s indexed as soon as the last one is gone. Only admins see this note.
      </p>
    </div>
  );
}

export default async function LegalPage({ params }: { params: Params }) {
  const { slug } = await params;
  const page = await getPublished("page", slug);
  if (!page) notFound();
  const placeholders = templatePlaceholders(page.body);
  const [{ base, locale }, admin] = await Promise.all([getSiteSeo(), placeholders.length ? viewingAdmin() : null]);
  const { html, toc } = renderMarkdown(page.body, { siteOrigin: base });
  const path = `/legal/${page.slug}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: page.title, path },
  ];
  const updated = page.updatedAt ?? page.publishedAt;

  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": absoluteUrl(base, path),
            url: absoluteUrl(base, path),
            name: page.title,
            ...(page.description ? { description: page.description } : {}),
            ...(updated ? { dateModified: updated } : {}),
            ...(page.publishedAt ? { datePublished: page.publishedAt } : {}),
            isPartOf: { "@id": jsonLdIds.website(base) },
            publisher: { "@id": jsonLdIds.organization(base) },
          },
          breadcrumbJsonLd(base, crumbs),
        ]}
      />
      <Container className="pt-10 pb-section md:pt-14">
        <Breadcrumbs crumbs={crumbs} className="mb-10" />
        {admin && <TemplateNotice placeholders={placeholders} />}
        <article>
          <header className="flex max-w-3xl flex-col gap-5">
            <h1 className="font-display text-h2 font-bold text-ink">{page.title}</h1>
            {page.description && <p className="max-w-measure text-lead text-ink-2">{page.description}</p>}
            {updated && (
              <p className="text-small text-ink-3">
                Last updated <time dateTime={isoDay(updated)}>{formatPublishDate(updated, locale)}</time>
              </p>
            )}
          </header>
          {/* The body track is the reading measure, so the TOC sits beside the text, not across a gap.
              Below lg the TOC is a closed card above the body (see ArticleToc). */}
          <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,var(--measure))_14rem] lg:gap-20">
            <ArticleToc items={toc} />
            <ArticleBody html={html} className="min-w-0" />
          </div>
        </article>
      </Container>
    </>
  );
}
