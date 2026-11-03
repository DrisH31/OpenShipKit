import "server-only";

//
// The generated 1200×630 card for one published post or changelog entry, as
// an ImageResponse. Served at a stable URL — blog/[slug]/og and
// changelog/[slug]/og — that both og:image and the Article JSON-LD name. An
// unknown or draft slug gets the plain site card, never an error image.
//

import type { ImageResponse } from "next/og";
import { formatPublishDate, readingLabel } from "@/components/blog/format";
import { readingMinutes } from "@/server/markdown";
import { getPublishedPost } from "@/server/services/posts";
import { ogCardResponse, siteHost } from "./og-card";
import { getSiteSeo } from "./site-seo";

/** The small label above the title, per kind. */
const EYEBROW = { post: "Blog", changelog: "Changelog" } as const;

export async function postCardResponse(slug: string, kind: keyof typeof EYEBROW = "post"): Promise<ImageResponse> {
  const [{ base, name, site, locale }, post] = await Promise.all([getSiteSeo(), getPublishedPost(kind, slug)]);
  const host = siteHost(base);
  const card = post
    ? {
        siteName: name,
        eyebrow: EYEBROW[kind],
        title: post.title,
        subtitle: post.description,
        footer: [formatPublishDate(post.publishedAt, locale), readingLabel(readingMinutes(post.body))].filter(Boolean).join("  ·  "),
        host,
      }
    : { siteName: name, title: site.tagline || name, subtitle: site.description, host };
  return ogCardResponse(card, { "Cache-Control": "public, max-age=3600, s-maxage=3600" });
}
