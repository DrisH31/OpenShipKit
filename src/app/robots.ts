//
// /robots.txt — open to search engines AND to AI crawlers, by choice: for a
// small product the problem is not being known. Named groups list the bots
// explicitly (search/citation, user-fetch and training tokens) so the policy
// is visible and easy to change per bot. A named group REPLACES the * group
// for that bot, so every group repeats the same disallows.
//
// Never disallow /_next/ (stylesheets and the image optimiser live there, and
// a crawler that can't fetch them renders the page broken). /uploads/ (the
// media library's images) and the IndexNow key file stay crawlable too.
//
// Private surfaces are disallowed here AND protected by auth; robots.txt is a
// crawl hint, not access control. Request-time, so the sitemap URL follows
// NEXT_PUBLIC_SITE_URL on every deployment.
//

import type { MetadataRoute } from "next";
import { siteUrl } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * Never crawled: the product, the admin and the APIs. The auth pages (/sign-in,
 * /sign-up, /auth/*) are NOT listed: every page links to /sign-in, and a
 * blocked URL can still be indexed from links alone ("Indexed, though blocked
 * by robots.txt"). Left crawlable, their `noindex` meta is read and obeyed.
 */
const DISALLOW = ["/admin", "/dashboard", "/api/"];

/**
 * Crawlers allowed by name. Search and citation: Googlebot, Bingbot (also feeds
 * Copilot and much of ChatGPT search), Applebot, OAI-SearchBot (ChatGPT
 * search), Claude-SearchBot, PerplexityBot. Fetches a person asked for:
 * ChatGPT-User, Claude-User, Perplexity-User. Training and grounding tokens:
 * GPTBot, ClaudeBot, Google-Extended (also Gemini-app grounding),
 * Applebot-Extended, CCBot, Meta-ExternalAgent. Remove a name to fall back to
 * the * group; give it `disallow: "/"` to opt that bot out.
 */
const NAMED_BOTS = [
  "Googlebot",
  "Bingbot",
  "Applebot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Meta-ExternalAgent",
];

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...NAMED_BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow: DISALLOW })),
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
