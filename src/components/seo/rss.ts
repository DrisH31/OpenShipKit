import "server-only";

//
// RSS 2.0 for the blog and the changelog. Every text node is XML-escaped and
// the HTML body goes in a CDATA section (with "]]>" split so it can't close
// early). Links are absolute, from siteUrl(). Reads throw on a backend
// failure → a 500, never an empty feed that readers would treat as "no posts".
// On a renamed site, starter items still in OpenShipKit's words are left out
// (isHiddenStarter), as they are from the sitemap. Unlisted posts stay IN the
// feed (listPublished, not listListed): they are live, only not promoted.
//

import type { Post, PostKind } from "@/core/types";
import { isHiddenStarter } from "@/components/blog/data";
import { renderMarkdown } from "@/server/markdown";
import { listPublished } from "@/server/services/posts";
import { absoluteUrl, absolutizeHtmlLinks } from "@/shared/seo";
import { getSiteSeo } from "./site-seo";

/** Escape text for an XML element or attribute. Also drops characters XML 1.0 forbids. */
export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap HTML in CDATA, splitting any "]]>" inside it. */
export function cdata(html: string): string {
  const clean = html.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
  return `<![CDATA[${clean.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function rfc822(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toUTCString();
}

export interface FeedInput {
  base: string;
  title: string;
  description: string;
  language: string;
  /** Root-relative path of the HTML page the feed mirrors. */
  path: string;
  feedPath: string;
  /** Each item's permalink path. */
  itemPath: (post: Post) => string;
  posts: Post[];
}

/** Build the RSS 2.0 document. Pure — exported for tests. */
export function buildRss(input: FeedInput): string {
  const { base } = input;
  const newest = input.posts.reduce<string | null>((max, p) => {
    const t = p.updatedAt ?? p.publishedAt;
    return t && (!max || t > max) ? t : max;
  }, null);
  const items = input.posts
    .map((post) => {
      const link = absoluteUrl(base, input.itemPath(post));
      const { html } = renderMarkdown(post.body, { siteOrigin: base });
      // Feed readers resolve nothing against the site: make root-relative links and images
      // absolute, and point in-page "#fragment" links at the post (not at the feed itself).
      const absolute = absolutizeHtmlLinks(html, base, link);
      const categories = post.tags.map((t) => `      <category>${xmlEscape(t)}</category>`).join("\n");
      return [
        "    <item>",
        `      <title>${xmlEscape(post.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        `      <pubDate>${rfc822(post.publishedAt)}</pubDate>`,
        post.description ? `      <description>${xmlEscape(post.description)}</description>` : "",
        post.authorName ? `      <dc:creator>${xmlEscape(post.authorName)}</dc:creator>` : "",
        categories,
        `      <content:encoded>${cdata(absolute)}</content:encoded>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${xmlEscape(input.title)}</title>`,
    `    <link>${xmlEscape(absoluteUrl(base, input.path))}</link>`,
    `    <description>${xmlEscape(input.description)}</description>`,
    `    <language>${xmlEscape(input.language)}</language>`,
    `    <lastBuildDate>${rfc822(newest)}</lastBuildDate>`,
    `    <atom:link href="${xmlEscape(absoluteUrl(base, input.feedPath))}" rel="self" type="application/rss+xml"/>`,
    `    <generator>OpenShipKit</generator>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** The route handler body for a feed of `kind`. */
export async function rssResponse(opts: { kind: PostKind; path: string; feedPath: string; titleSuffix: string }): Promise<Response> {
  const [{ base, name, site, locale, showcase }, page] = await Promise.all([getSiteSeo(), listPublished(opts.kind, { limit: 50 })]);
  const xml = buildRss({
    base,
    title: `${name} ${opts.titleSuffix}`,
    description: opts.kind === "changelog" ? `What’s new in ${name}.` : site.description,
    language: locale,
    path: opts.path,
    feedPath: opts.feedPath,
    itemPath: (p) => (opts.kind === "changelog" ? `/changelog/${p.slug}` : `/blog/${p.slug}`),
    posts: page.items.filter((p) => !isHiddenStarter(p, showcase)),
  });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
