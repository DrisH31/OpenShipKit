//
// /manifest.webmanifest — the web app manifest, from the editable `site`
// content (name, description) and the design tokens (the page colour as the
// theme and background, matching the root layout's viewport themeColor).
// Icons are the generated marks in src/app/icon.tsx and, for Android's
// adaptive launcher, src/app/icon-maskable. Request-time, so a rename
// in the admin shows up without a rebuild.
//

import type { MetadataRoute } from "next";
import { getContent } from "@/server/services/content";

export const dynamic = "force-dynamic";

/** tokens.css → --bg (light). Literal, because a manifest can't read CSS. */
const PAGE_BG = "#E6E6E6";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site = await getContent("site");
  // short_name shows under a home-screen icon: about 12 characters fit.
  const shortName = site.name.length <= 12 ? site.name : site.name.split(/\s+/)[0].slice(0, 12);
  return {
    name: site.tagline ? `${site.name} — ${site.tagline}` : site.name,
    short_name: shortName,
    description: site.description,
    lang: site.locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PAGE_BG,
    theme_color: PAGE_BG,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      // Full-bleed with the mark inside the central 80 % safe zone, so Android may mask it
      // (src/app/icon-maskable). iOS reads apple-touch-icon from <head>, not from here.
      { src: "/icon-maskable/192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
