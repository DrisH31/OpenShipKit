//
// /sitemap.xml — every canonical, indexable URL: the marketing pages, the blog
// and changelog indexes, each published post, changelog entry and page, and
// tag pages with enough posts to be indexed (and not on nearly every post:
// see isIndexableTag). Legal pages that are still the seeded template
// (placeholders unfilled) are noindex, so they're left out — and so, on a
// renamed site, are the starter posts and changelog entry still in
// OpenShipKit's words (isHiddenStarter).
// lastModified comes from real content changes only (Google ignores a lastmod
// that isn't accurate), so the static pages carry none. Request-time: it reads
// the DataStore.
//
// Unlisted posts ARE here: they are published and answer 200, only no longer
// promoted on /blog. Never filter this list on `listed` — nothing would
// error, the URLs would just stop being advertised and decay out of the index.
//
// Under OPENSHIPKIT_PROFILE=site, /pricing (a 404 there) is left out: the
// static paths go through forProfile (src/core/profile.ts) like every link.
//
// The docs (/docs and every page under it, from docs/*.md) are listed only
// while they're published: the showcase, or OPENSHIPKIT_PUBLIC_DOCS=true
// (src/server/docs.ts). No lastModified: a file's mtime is the deploy's.
//
// One file holds up to 50,000 URLs (the protocol's limit), across every kind;
// past that we stop and log. Items are read as bodiless refs (getPublishedRefs),
// so a large blog costs one page of rows in memory at a time, not every body. generateSitemaps isn't used: it moves the file to /sitemap/<id>.xml
// and calls the DataStore at build time, which has no database.
//

import type { MetadataRoute } from "next";
import { getPublishedRefs } from "@/components/blog/data";
import { isIndexableTag, tagHref } from "@/components/blog/format";
import { getSiteSeo } from "@/components/seo/site-seo";
import { forProfile, type SiteProfile } from "@/core/profile";
import { docsOn, docsPath, getDocsIndex } from "@/server/docs";
import { publicDocs, siteProfile } from "@/server/env";
import { absoluteUrl } from "@/shared/seo";

export const dynamic = "force-dynamic";

/** The sitemap protocol's per-file limit. */
const MAX_URLS = 50_000;

const STATIC_PATHS = ["/", "/pricing", "/contact", "/blog", "/changelog"] as const;

/** The static paths this profile serves: /pricing only in saas. */
function staticPaths(profile: SiteProfile): string[] {
  return forProfile(profile, STATIC_PATHS.map((href) => ({ href }))).map((p) => p.href);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ base, showcase }, allPosts, allChangelog, pages] = await Promise.all([
    getSiteSeo(),
    getPublishedRefs("post", MAX_URLS),
    getPublishedRefs("changelog", MAX_URLS),
    getPublishedRefs("page", MAX_URLS),
  ]);
  const docs = docsOn(showcase, publicDocs()) ? await getDocsIndex() : null;
  // On a renamed site, starter items still in OpenShipKit's words are noindex (blog/[slug], changelog/[slug]).
  const posts = showcase ? allPosts : allPosts.filter((p) => !p.starter);
  const changelog = showcase ? allChangelog : allChangelog.filter((p) => !p.starter);
  // Tag counts over listed posts only, as the tag pages list them (listTags): an unlisted post is on no tag page.
  const listedPosts = allPosts.filter((p) => p.listed);
  const tagCounts = new Map<string, number>();
  for (const p of listedPosts) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = [...tagCounts].filter(([, count]) => isIndexableTag(count, listedPosts.length)).map(([tag]) => tag);

  const newest = (list: { updatedAt: string }[]) => list.reduce<string | undefined>((m, p) => (!m || p.updatedAt > m ? p.updatedAt : m), undefined);
  const indexModified: Record<string, string | undefined> = { "/blog": newest(posts), "/changelog": newest(changelog) };

  const entries: MetadataRoute.Sitemap = [
    ...staticPaths(siteProfile()).map((path) => ({
      url: absoluteUrl(base, path),
      ...(indexModified[path] ? { lastModified: indexModified[path] } : {}),
    })),
    ...posts.map((p) => ({ url: absoluteUrl(base, `/blog/${p.slug}`), lastModified: p.updatedAt })),
    ...tags.map((tag) => ({
      url: absoluteUrl(base, tagHref(tag)),
      lastModified: newest(listedPosts.filter((p) => p.tags.includes(tag))),
    })),
    ...changelog.map((p) => ({ url: absoluteUrl(base, `/changelog/${p.slug}`), lastModified: p.updatedAt })),
    ...pages.filter((p) => !p.unfinished).map((p) => ({ url: absoluteUrl(base, `/legal/${p.slug}`), lastModified: p.updatedAt })),
    ...(docs ? [docs.bySlug.get(""), ...docs.order].filter((e) => e !== undefined).map((e) => ({ url: absoluteUrl(base, docsPath(e.slug)) })) : []),
  ];

  if (entries.length > MAX_URLS) {
    console.warn(`[sitemap] ${entries.length} URLs; only the first ${MAX_URLS} are listed. Split the sitemap (see the header comment).`);
    return entries.slice(0, MAX_URLS);
  }
  return entries;
}
