//
// /blog/[slug] — one published post: title, byline with real dates, the body
// (sanitised Markdown in .prose), an "On this page" TOC beside it on wide
// screens, tags, related posts, and BlogPosting + BreadcrumbList JSON-LD that
// state exactly what the page shows. Drafts and unknown slugs are 404; an
// unlisted post renders like any other (it is only off the lists), and its
// related posts are drawn from listed ones.
// The social card is the cover if there is one, else the post's generated card
// at /blog/<slug>/og — the same URL the BlogPosting JSON-LD names.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { ArticleBody } from "@/components/blog/article-body";
import { Breadcrumbs } from "@/components/blog/breadcrumbs";
import { CoverImage } from "@/components/blog/cover-image";
import { getPublished, getListedPage, isHiddenStarter } from "@/components/blog/data";
import { coverAltText, safeImageUrl } from "@/components/blog/format";
import { PostList } from "@/components/blog/post-list";
import { PostMeta } from "@/components/blog/post-meta";
import { TagLinks } from "@/components/blog/tag-links";
import { ArticleToc } from "@/components/blog/toc";
import { Container } from "@/components/marketing/layout";
import { JsonLd } from "@/components/seo/json-ld";
import { metaDescription } from "@/components/seo/meta-description";
import { getSiteSeo } from "@/components/seo/site-seo";
import type { Post } from "@/core/types";
import { readingMinutes, renderMarkdown } from "@/server/markdown";
import { articleJsonLd, breadcrumbJsonLd } from "@/shared/jsonld";
import { OG_IMAGE_SIZE, pageMetadata } from "@/shared/seo";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublished("post", slug);
  if (!post) return {};
  const { name, locale, twitterSite, showcase } = await getSiteSeo();
  const cover = safeImageUrl(post.coverImage);
  return pageMetadata({
    title: post.seoTitle || post.title,
    absoluteTitle: Boolean(post.seoTitle),
    // Cut to the snippet budget at a word boundary (claim-first copy fits untouched); the page keeps the full text.
    description: metaDescription(post.seoDescription || post.description),
    path: `/blog/${post.slug}`,
    type: "article",
    // A cover wins; without one, the post's generated 1200×630 card at its stable URL.
    image: cover ?? `/blog/${post.slug}/og`,
    ...(cover ? {} : { imageSize: OG_IMAGE_SIZE }),
    // A described cover says what it shows; a decorative one is named by the post.
    imageAlt: coverAltText(post) || post.title,
    // Starter text on a renamed site: readable, but not indexed as this site's own (see isStarterContent).
    noindex: isHiddenStarter(post, showcase),
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    tags: post.tags,
    authors: post.authorName ? [post.authorName] : undefined,
    siteName: name,
    locale,
    twitterSite,
  });
}

/** Up to three posts sharing the most tags, then the most recent; never the post itself. */
function related(post: Post, candidates: Post[]): Post[] {
  const others = candidates.filter((p) => p.id !== post.id);
  const scored = others.map((p) => ({ p, score: p.tags.filter((t) => post.tags.includes(t)).length }));
  scored.sort((a, b) => b.score - a.score || (b.p.publishedAt ?? "").localeCompare(a.p.publishedAt ?? ""));
  return scored.slice(0, 3).map((s) => s.p);
}

/** Tags whose newest posts are read as related candidates; more add little but cost a query each. */
const RELATED_TAGS = 3;

/**
 * The candidate pool for related posts: the newest four with each of the
 * post's first tags (the tag filter is indexed), plus the newest four overall
 * as a fallback. At most four small reads, never the whole blog. Four, not
 * three, so a pool that contains this post still has three others.
 */
async function relatedCandidates(post: Post): Promise<Post[]> {
  const pages = await Promise.all([
    ...post.tags.slice(0, RELATED_TAGS).map((tag) => getListedPage("post", 4, null, tag)),
    getListedPage("post", 4, null, null),
  ]);
  const byId = new Map<string, Post>();
  for (const page of pages) for (const p of page.items) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()];
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const { slug } = await params;
  const post = await getPublished("post", slug);
  if (!post) notFound();

  const [{ base, name, locale }, candidates] = await Promise.all([getSiteSeo(), relatedCandidates(post)]);
  const { html, toc, readingMinutes: minutes, wordCount } = renderMarkdown(post.body, { siteOrigin: base });
  const cover = safeImageUrl(post.coverImage);
  const path = `/blog/${post.slug}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Blog", path: "/blog" },
    { name: post.title, path },
  ];
  const more = related(post, candidates);

  const jsonLd = [
    articleJsonLd({
      base,
      path,
      headline: post.title,
      description: post.description,
      // The cover if there is one, else this post's generated 1200×630 card at its stable URL.
      images: [cover ?? `${path}/og`],
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      authorName: post.authorName,
      tags: post.tags,
      wordCount,
      publisherName: name,
      publisherLogo: "/apple-icon",
    }),
    breadcrumbJsonLd(base, crumbs),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />
      <Container className="pt-10 pb-section md:pt-14">
        <Breadcrumbs crumbs={crumbs} className="mb-10" />

        <article>
          <header className="flex max-w-4xl flex-col gap-6">
            <h1 data-rank="1" className="font-display text-h2 font-bold text-ink">{post.title}</h1>
            {post.description && <p className="max-w-measure text-lead text-ink-2">{post.description}</p>}
            <PostMeta
              publishedAt={post.publishedAt}
              updatedAt={post.updatedAt}
              readingMinutes={minutes}
              authorName={post.authorName}
              locale={locale}
            />
            <TagLinks tags={post.tags} />
          </header>

          {cover && <CoverImage src={cover} alt={coverAltText(post)} className="mt-10" />}

          {/* The body track is the reading measure, so the TOC sits beside the text, not across a gap.
              Below lg the TOC is a closed card above the body (see ArticleToc). */}
          <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,var(--measure))_14rem] lg:gap-20">
            <ArticleToc items={toc} />
            <ArticleBody html={html} className="min-w-0" />
          </div>
        </article>

        <div className="mt-16 max-w-measure border-t border-line pt-8">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 rounded-sm text-small font-semibold text-ink hover:underline pointer-coarse:min-h-11"
          >
            <ArrowLeftIcon aria-hidden className="size-4" />
            All posts
          </Link>
        </div>

        {more.length > 0 && (
          <section aria-labelledby="related-heading" className="mt-16">
            <h2 id="related-heading" className="font-display text-h3 font-bold text-ink">
              Keep reading
            </h2>
            <PostList
              className="mt-6"
              headingLevel={3}
              locale={locale}
              items={more.map((p) => ({ post: p, readingMinutes: readingMinutes(p.body) }))}
            />
          </section>
        )}
      </Container>
    </>
  );
}
