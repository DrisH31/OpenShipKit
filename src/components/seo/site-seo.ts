import "server-only";

//
// The site-wide values every SEO surface needs — origin, name, locale, the X
// handle, sameAs profiles, the social image — read once per request from the `site` content
// (defaults only when nothing is stored; a failed read throws) and siteUrl(). Pages pass these into the pure
// builders in src/shared/seo.ts and src/shared/jsonld.ts.
//

import { cache } from "react";
import type { SiteContent } from "@/core/content";
import { safeImageUrl } from "@/components/blog/format";
import { siteUrl } from "@/server/env";
import { getContent } from "@/server/services/content";
import { isShowcase, siteCardAlt, xHandle, xProfileUrl } from "@/shared/seo";

export interface SiteSeo {
  base: string;
  site: SiteContent;
  name: string;
  locale: string;
  /** "@handle", or undefined when no X profile is set. */
  twitterSite: string | undefined;
  /** Absolute profile URLs for Organization.sameAs. */
  sameAs: string[];
  /**
   * The admin's site-wide social image (`site.ogImage`) when it is a safe
   * http(s) or root-relative URL, else undefined (the generated card). Every
   * page without an image of its own passes it to pageMetadata as `siteImage`.
   */
  ogImage: string | undefined;
  /**
   * Alt text for the generated site card (/opengraph-image): what it shows,
   * "Acme: The tagline". Pages pass it to pageMetadata as `defaultImageAlt`.
   */
  cardAlt: string;
  /**
   * True while the site still carries the template's own name: it is the
   * OpenShipKit showcase, its plans are samples and its story is the template's.
   * isShowcase() in src/shared/seo.ts: the home page and footer ask it too.
   */
  showcase: boolean;
}

// isShowcase and xHandle live in src/shared/seo.ts (pure, with xProfileUrl); re-exported here for callers that already import them from this file.
export { isShowcase, xHandle } from "@/shared/seo";

function profileUrls(site: SiteContent): string[] {
  const s = site.social;
  return [xProfileUrl(s.x) ?? "", s.github, s.linkedin, s.youtube, s.discord].filter((u) => /^https?:\/\//.test(u));
}

/** Site values for metadata and JSON-LD; one content read per request. */
export const getSiteSeo = cache(async (): Promise<SiteSeo> => {
  const site = await getContent("site");
  return {
    base: siteUrl(),
    site,
    name: site.name,
    locale: site.locale,
    twitterSite: xHandle(site.social.x),
    sameAs: profileUrls(site),
    ogImage: safeImageUrl(site.ogImage) ?? undefined,
    cardAlt: siteCardAlt(site.name, site.tagline),
    showcase: isShowcase(site),
  };
});
