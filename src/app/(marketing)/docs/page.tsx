//
// /docs — the docs' front door, from docs/README.md (the same file GitHub
// shows for the folder): its title as the H1, its first paragraph as the
// lead, then every page as a card under its nav.json group, then the rest of
// the README. The reader's question is "where do I start?", so the first
// group (Start) comes first and every card says what its page is for in the
// page's own first sentence.
// Published only while the site is the OpenShipKit showcase or
// OPENSHIPKIT_PUBLIC_DOCS=true (src/server/docs.ts); a 404 otherwise.
// Request-time: the gate reads the site's name from the database.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocBody } from "@/components/docs/doc-body";
import { DocsShell } from "@/components/docs/docs-shell";
import { JsonLd } from "@/components/seo/json-ld";
import { getSiteSeo, siteFeeds } from "@/components/seo/site-seo";
import { docsEnabled, docsPath, editUrl, getDoc, getDocsIndex, renderDoc } from "@/server/docs";
import { breadcrumbJsonLd, collectionPageJsonLd } from "@/shared/jsonld";
import { OPENSHIPKIT_NAME } from "@/shared/project";
import { pageMetadata } from "@/shared/seo";

const FALLBACK_TITLE = `${OPENSHIPKIT_NAME} docs`;

export async function generateMetadata(): Promise<Metadata> {
  if (!(await docsEnabled())) return {};
  const [readme, { name, locale, twitterSite, ogImage, cardAlt }] = await Promise.all([getDoc(""), getSiteSeo()]);
  if (!readme) return {};
  return pageMetadata({
    // The README's own title ("OpenShipKit docs") already names the brand.
    title: readme.entry.title || FALLBACK_TITLE,
    absoluteTitle: true,
    description: readme.entry.description || `How to set up, run and change ${name}.`,
    path: "/docs",
    siteName: name,
    feeds: siteFeeds(name),
    locale,
    twitterSite,
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
  });
}

export default async function DocsIndexPage() {
  if (!(await docsEnabled())) notFound();
  const [index, readme, { base }] = await Promise.all([getDocsIndex(), getDoc(""), getSiteSeo()]);
  if (!readme) notFound();
  const known = new Set(index.bySlug.keys());
  const rest = await renderDoc(readme, known, "afterLead");
  const title = readme.entry.title || FALLBACK_TITLE;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
  ];

  return (
    <>
      <JsonLd
        data={[
          collectionPageJsonLd({
            base,
            path: "/docs",
            name: title,
            description: readme.entry.description,
            items: index.order.map((e) => ({ name: e.title, path: docsPath(e.slug) })),
          }),
          breadcrumbJsonLd(base, crumbs),
        ]}
      />
      <DocsShell
        nav={index.nav}
        current=""
        title={title}
        lead={readme.afterLead ? readme.entry.description : undefined}
        crumbs={crumbs}
        next={index.order[0] ?? null}
        editHref={editUrl(readme.entry.file)}
      >
        <div className="flex flex-col gap-12">
          {index.nav.map((group, g) => (
            <section key={group.group} aria-labelledby={`docs-group-${g}`}>
              <h2 id={`docs-group-${g}`} className="font-display text-h3 font-bold text-ink">
                {group.group}
              </h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {group.items.map((item) => (
                  <li key={item.slug} className="flex">
                    <Link
                      href={docsPath(item.slug)}
                      className="group flex w-full flex-col gap-1.5 rounded-xl border border-line bg-surface px-5 py-4 transition-colors duration-(--dur-hover) hover:border-line-strong"
                    >
                      <span className="font-semibold text-ink group-hover:underline group-hover:decoration-ink-faint group-hover:underline-offset-4">
                        {item.title}
                      </span>
                      {item.description && <span className="line-clamp-3 text-small text-ink-2">{item.description}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {rest.html.trim() && <DocBody html={rest.html} />}
        </div>
      </DocsShell>
    </>
  );
}
