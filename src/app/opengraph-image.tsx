//
// The site's default social card (1200×630 PNG): the mark, the site name, the
// tagline and description from the editable `site` content, and the host.
// Request-time, so an edit in the admin shows on the next share. The admin's
// site-wide OG image (`site.ogImage`) replaces it on every page, and a post's
// or changelog entry's own card or cover replaces it on that page.
//

import { OG_SIZE, ogCardResponse, siteHost } from "@/components/seo/og-card";
import { getSiteSeo } from "@/components/seo/site-seo";

export const dynamic = "force-dynamic";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "The site’s name and tagline";

export default async function Image() {
  const { base, name, site } = await getSiteSeo();
  return ogCardResponse(
    { siteName: name, title: site.tagline || name, subtitle: site.description, host: siteHost(base) },
    { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  );
}
