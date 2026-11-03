import "server-only";

//
// The shared body of /blog and /blog/tag/[tag]: header, tag filter, the list,
// the pager and the empty state, plus CollectionPage + BreadcrumbList JSON-LD.
// Everything is in the server HTML. Reads throw on a backend failure.
//

import Link from "next/link";
import { Container } from "@/components/marketing/layout";
import { Eyebrow } from "@/components/marketing/type";
import { JsonLd } from "@/components/seo/json-ld";
import type { Post } from "@/core/types";
import { readingMinutes } from "@/server/markdown";
import { breadcrumbJsonLd, collectionPageJsonLd, type Crumb } from "@/shared/jsonld";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "./breadcrumbs";
import { PostList } from "./post-list";
import { Pager } from "./pager";
import { TagFilter } from "./tag-links";

export interface ListPageProps {
  base: string;
  locale: string;
  path: string;
  eyebrow: string;
  /** The page's name: the CollectionPage's name (and the <title>, set by the route). */
  title: string;
  /** What the H1 says, when it should say more than the name ("Guides and notes" for "Blog"). Default: `title`. */
  heading?: string;
  lead: string;
  crumbs: Crumb[];
  posts: Post[];
  tags: { tag: string; count: number }[];
  currentTag: string | null;
  newerHref: string | null;
  newerLabel: "Newer" | "Newest";
  olderHref: string | null;
  /** Past the first page: "September 12, 2026 and earlier" (see pageLabel), shown after the title. Null on page 1. */
  pageLabel: string | null;
}

export function ListPage(props: ListPageProps) {
  const { base, locale, path, posts } = props;
  const jsonLd = [
    collectionPageJsonLd({
      base,
      path,
      name: props.title,
      description: props.lead,
      items: posts.map((p) => ({ name: p.title, path: `/blog/${p.slug}`, datePublished: p.publishedAt })),
    }),
    breadcrumbJsonLd(base, props.crumbs),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />
      <Container className="pt-12 pb-section md:pt-16">
        {props.crumbs.length > 2 && <Breadcrumbs crumbs={props.crumbs} className="mb-8" />}
        <header className="flex max-w-3xl flex-col gap-6">
          <Eyebrow>{props.eyebrow}</Eyebrow>
          {/* The page's one H1 at the H1 step, like /pricing. A one-word label ("Blog") can't
              outweigh the first post's two-line heading on a phone, so the H1 says what is here
              (`heading`) and the name sits in the eyebrow. Past page 1 the date range is a
              quieter second line, not more display type. */}
          <h1 data-rank="1" className="font-display text-h1 font-bold text-balance text-ink">
            {props.heading ?? props.title}
            {props.pageLabel && <span className="sr-only"> · </span>}
            {props.pageLabel && (
              <span className="mt-3 block font-sans text-h3 font-semibold tracking-normal text-ink-3">{props.pageLabel}</span>
            )}
          </h1>
          <p className="max-w-measure text-lead text-ink-2">{props.lead}</p>
          <p className="text-small text-ink-3">
            <a href="/blog/rss.xml" className="underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
              Subscribe with RSS
            </a>
          </p>
        </header>

        <div className="mt-10">
          <TagFilter tags={props.tags} current={props.currentTag} />
        </div>

        {posts.length > 0 ? (
          <PostList
            className="mt-10"
            locale={locale}
            items={posts.map((post) => ({ post, readingMinutes: readingMinutes(post.body) }))}
          />
        ) : (
          <div className="mt-10 rounded-xl border border-line bg-surface p-8 md:p-12">
            <h2 className="font-display text-h3 font-bold text-ink">No posts yet</h2>
            <p className="mt-3 max-w-measure text-ink-2">
              Nothing is published here yet. Posts written in the admin (or by an agent through the MCP server) appear
              here as soon as they’re published.
            </p>
            <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
              Back to the home page
            </Link>
          </div>
        )}

        <Pager newerHref={props.newerHref} newerLabel={props.newerLabel} olderHref={props.olderHref} label="Blog pages" />
      </Container>
    </>
  );
}
