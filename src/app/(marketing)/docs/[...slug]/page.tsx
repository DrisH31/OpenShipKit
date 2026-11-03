//
// /docs/<slug> — one page of the repository's docs (docs/<slug>.md, or
// docs/modules/<name>.md at /docs/modules/<name>), rendered on the server:
// highlighted code with a copy button on each block, links between docs kept
// on the site and links into the code sent to GitHub (src/server/docs.ts).
// The sidebar marks the page, "On this page" lists its h2/h3, prev/next follow
// nav.json, and "Edit this page on GitHub" opens the same file there.
// TechArticle + BreadcrumbList JSON-LD say what the page shows: no dates (a
// file's mtime is the deploy's, not the edit's) and no author persona.
// Unknown or malformed slugs are 404, and so is every page while the docs are
// off (a renamed site without OPENSHIPKIT_PUBLIC_DOCS=true).
//

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocBody } from "@/components/docs/doc-body";
import { DocsShell } from "@/components/docs/docs-shell";
import { JsonLd } from "@/components/seo/json-ld";
import { getSiteSeo } from "@/components/seo/site-seo";
import { docsEnabled, docsPath, docsTitle, editUrl, getDoc, getDocsIndex, renderDoc, type DocPage } from "@/server/docs";
import { articleJsonLd, breadcrumbJsonLd } from "@/shared/jsonld";
import { pageMetadata } from "@/shared/seo";

type Params = Promise<{ slug: string[] }>;

/** The page a URL names, or null. "" (the index) is /docs itself, never /docs/README. */
async function pageFor(params: Params): Promise<DocPage | null> {
  const { slug } = await params;
  let joined: string;
  try {
    joined = slug.map((s) => decodeURIComponent(s)).join("/");
  } catch {
    return null;
  }
  return joined ? getDoc(joined) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!(await docsEnabled())) return {};
  const page = await pageFor(params);
  if (!page) return {};
  const { name, locale, twitterSite, ogImage, cardAlt } = await getSiteSeo();
  return pageMetadata({
    title: docsTitle(page.entry.title),
    absoluteTitle: true,
    description: page.entry.description || `${page.entry.title}: part of the ${name} docs.`,
    path: docsPath(page.entry.slug),
    type: "article",
    siteName: name,
    locale,
    twitterSite,
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
  });
}

export default async function DocPageRoute({ params }: { params: Params }) {
  if (!(await docsEnabled())) notFound();
  const page = await pageFor(params);
  if (!page) notFound();

  const [index, { base, name }] = await Promise.all([getDocsIndex(), getSiteSeo()]);
  const known = new Set(index.bySlug.keys());
  const { html, toc, wordCount } = await renderDoc(page, known);
  const path = docsPath(page.entry.slug);
  const at = index.order.findIndex((e) => e.slug === page.entry.slug);
  // The first page steps back to the overview.
  const prev = at > 0 ? index.order[at - 1] : at === 0 ? (index.bySlug.get("") ?? null) : null;
  const next = at >= 0 ? (index.order[at + 1] ?? null) : null;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
    { name: page.entry.title, path },
  ];

  return (
    <>
      <JsonLd
        data={[
          articleJsonLd({
            base,
            path,
            type: "TechArticle",
            headline: page.entry.title,
            description: page.entry.description,
            wordCount,
            publisherName: name,
            publisherLogo: "/apple-icon",
          }),
          breadcrumbJsonLd(base, crumbs),
        ]}
      />
      <DocsShell
        nav={index.nav}
        current={page.entry.slug}
        title={page.entry.title}
        crumbs={crumbs}
        toc={toc}
        prev={prev}
        next={next}
        editHref={editUrl(page.entry.file)}
      >
        <DocBody html={html} lead />
      </DocsShell>
    </>
  );
}
