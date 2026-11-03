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
// Features can be switched off the same way, whatever the profile
// (OPENSHIPKIT_WITHOUT=blog,mcp, or `npm run setup -- --without blog,mcp`):
// FEATURE_PATHS lists each one's routes, which then answer 404 and drop out of
// every surface above. Switched off, not deleted: nothing in the code or the
// database goes, so switching back brings it all back and template updates
// still merge (docs/site-profile.md#switching-features-off).
//

import type { ContentValue } from "./content";

export type SiteProfile = "saas" | "site";

export const SITE_PROFILES: readonly SiteProfile[] = ["saas", "site"];

/** Paths (and everything under them) that exist only in the saas profile. */
export const SAAS_ONLY_PATHS: readonly string[] = ["/pricing", "/api/billing", "/dashboard/billing", "/admin/plans"];

/** The features that can be switched off (OPENSHIPKIT_WITHOUT), and the paths each one owns. */
export const FEATURE_PATHS = {
  /** The blog: /blog, its posts, tags and feed. The changelog and legal pages are posts too, and stay. */
  blog: ["/blog"],
  /** The MCP server for AI agents, and the admin's agent keys. */
  mcp: ["/api/mcp", "/admin/agents"],
} as const satisfies Record<string, readonly string[]>;

export type Feature = keyof typeof FEATURE_PATHS;
export const FEATURES = Object.keys(FEATURE_PATHS) as Feature[];

const under = (href: string, prefixes: readonly string[]): boolean => {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
};

/** Does this href lead to a feature that's switched off? Root-relative paths only, like isSaasOnlyPath. */
export function isWithoutPath(href: string, without: readonly Feature[]): boolean {
  return without.length > 0 && under(href, without.flatMap((f) => FEATURE_PATHS[f]));
}

/**
 * Does this href lead to a page the site profile switches off? Root-relative
 * paths only, with or without a query or fragment: "/pricing", "/pricing#compare",
 * "/admin/plans/pro". An anchor on the home page ("/#pricing"), an absolute URL or
 * mailto: is someone else's business and is kept.
 */
export function isSaasOnlyPath(href: string): boolean {
  return under(href, SAAS_ONLY_PATHS);
}

/** Whether this profile, with these features switched off, hides `href`. */
export function isHiddenPath(href: string, profile: SiteProfile, without: readonly Feature[] = []): boolean {
  return (profile === "site" && isSaasOnlyPath(href)) || isWithoutPath(href, without);
}

/** Keep the items whose href is served: no SaaS-only path under site, no path of a switched-off feature. */
export function forProfile<T extends { href: string }>(profile: SiteProfile, items: readonly T[], without: readonly Feature[] = []): T[] {
  return items.filter((i) => !isHiddenPath(i.href, profile, without));
}

/**
 * The `navigation` content as this profile renders it. Under site, links to a
 * SaaS-only path are dropped at render time — the defaults' Pricing link and
 * one an admin saved before switching alike — and a footer column left empty
 * goes with them. Stored content is never changed: switching back to saas
 * shows the links again.
 */
export function navigationForProfile(profile: SiteProfile, nav: ContentValue<"navigation">, without: readonly Feature[] = []): ContentValue<"navigation"> {
  if (profile === "saas" && without.length === 0) return nav;
  return {
    header: forProfile(profile, nav.header, without),
    headerCta: nav.headerCta && isHiddenPath(nav.headerCta.href, profile, without) ? null : nav.headerCta,
    footer: nav.footer.map((col) => ({ ...col, links: forProfile(profile, col.links, without) })).filter((col) => col.links.length > 0),
  };
}
