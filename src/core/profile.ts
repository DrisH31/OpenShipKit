//
// The app's profiles (OPENSHIPKIT_PROFILE), and what the content-site profile
// switches off. Pure data and a path test, safe anywhere: the server reads the
// profile (src/server/env.ts), then hands plain values to whatever renders.
//
//   saas (default)  the SaaS starter: pricing, checkout, billing, plans.
//   site            a landing page + blog with no pricing, billing or plans
//                   (docs/site-profile.md). Nothing is deleted and stored data
//                   is untouched; switching back brings it all back.
//
// SAAS_ONLY_PATHS is the one list of what disappears: the pages answer 404,
// and every link the app draws to one of them (navigation, the 404 page's
// suggestions, the sitemap, the dashboard and admin sidebars, the command
// menu) is left out with isSaasOnlyPath. Add a SaaS-only route here and every
// one of those surfaces drops it.
//

import type { ContentValue } from "./content";

export type SiteProfile = "saas" | "site";

export const SITE_PROFILES: readonly SiteProfile[] = ["saas", "site"];

/** Paths (and everything under them) that exist only in the saas profile. */
export const SAAS_ONLY_PATHS: readonly string[] = ["/pricing", "/api/billing", "/dashboard/billing", "/admin/plans"];

/**
 * Does this href lead to a page the site profile switches off? Root-relative
 * paths only, with or without a query or fragment: "/pricing", "/pricing#compare",
 * "/admin/plans/pro". An anchor on the home page ("/#pricing"), an absolute URL or
 * mailto: is someone else's business and is kept.
 */
export function isSaasOnlyPath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return SAAS_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Keep the items whose href the profile serves: everything under saas, no SaaS-only path under site. */
export function forProfile<T extends { href: string }>(profile: SiteProfile, items: readonly T[]): T[] {
  return profile === "site" ? items.filter((i) => !isSaasOnlyPath(i.href)) : [...items];
}

/**
 * The `navigation` content as this profile renders it. Under site, links to a
 * SaaS-only path are dropped at render time — the defaults' Pricing link and
 * one an admin saved before switching alike — and a footer column left empty
 * goes with them. Stored content is never changed: switching back to saas
 * shows the links again.
 */
export function navigationForProfile(profile: SiteProfile, nav: ContentValue<"navigation">): ContentValue<"navigation"> {
  if (profile === "saas") return nav;
  return {
    header: forProfile(profile, nav.header),
    headerCta: nav.headerCta && isSaasOnlyPath(nav.headerCta.href) ? null : nav.headerCta,
    footer: nav.footer.map((col) => ({ ...col, links: forProfile(profile, col.links) })).filter((col) => col.links.length > 0),
  };
}
