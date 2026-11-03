//
// Dates and small labels for the blog, changelog and legal pages. Pure and
// client-safe. Dates format in UTC so the server and any client render the
// same day for the same ISO string.
//
// Publication dates read long ("6 October 2026") in the site's locale; the
// signed-in app's compact dates ("Oct 6, 2026") are src/lib/format.ts's
// formatDate. Different names on purpose, so auto-import can't swap them.
//

/** A publication date, "6 October 2026" style, in the site's locale. Empty string for a missing date. */
export function formatPublishDate(iso: string | null | undefined, locale = "en"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  }
}

/** The machine-readable value for <time dateTime>: the ISO date (YYYY-MM-DD). */
export function isoDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

/**
 * Whether an "Updated" date is worth showing: a different calendar day from
 * publication. A same-day fix-up isn't news, and showing it reads as noise.
 */
export function wasUpdated(publishedAt: string | null | undefined, updatedAt: string | null | undefined): boolean {
  if (!publishedAt || !updatedAt) return false;
  return isoDay(updatedAt) > isoDay(publishedAt);
}

/**
 * The label for a list page past the first: "September 12, 2026 and earlier",
 * from the publication date of the page's newest item. Cursor pages have no
 * stable number (the cursor doesn't know how many pages precede it), but they
 * do have a stable date, so the title and heading read the same whether the
 * page was walked to or fetched cold at its canonical URL.
 */
export function pageLabel(newestPublishedAt: string | null | undefined, locale = "en"): string {
  const day = formatPublishDate(newestPublishedAt, locale);
  return day ? `${day} and earlier` : "earlier";
}

/** "4 min read". */
export function readingLabel(minutes: number): string {
  return `${minutes} min read`;
}

/** Tag pages with fewer posts than this are thin: noindex, and left out of the sitemap. */
export const MIN_INDEXABLE_TAG_POSTS = 3;

/**
 * A tag on at least this share of all published posts is a catch-all ("guides"
 * on every guide): its page repeats /blog, so it's noindex and left out of the
 * sitemap however many posts it has.
 */
export const CATCH_ALL_TAG_PERCENT = 80;

/** Whether a tag on `count` of `total` published posts is a catch-all (integer maths: no float edge at exactly 80%). */
export function isCatchAllShare(count: number, total: number): boolean {
  return total > 0 && count * 100 >= total * CATCH_ALL_TAG_PERCENT;
}

/** Whether a tag's page is worth indexing: enough posts, and not a copy of /blog (`total` = published posts). */
export function isIndexableTag(count: number, total: number): boolean {
  return count >= MIN_INDEXABLE_TAG_POSTS && !isCatchAllShare(count, total);
}

/** The URL for a tag's page. Tags are free text, so they're encoded. */
export function tagHref(tag: string): string {
  return `/blog/tag/${encodeURIComponent(tag)}`;
}

/** A cover image URL that is safe to render and to put in metadata: a root path or http(s). Else null. */
export function safeImageUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  const v = src.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : null;
}

/**
 * A cover image's alt text, from the post's `coverAlt` (set in the admin post
 * editor or by the MCP post tools). Empty means decorative (alt=""), which is
 * right for a mood photo and wrong for a chart or a screenshot. The [slug]
 * pages use it for the <img> and for og:image:alt (falling back to the title
 * there, since a link preview has no "decorative").
 */
export function coverAltText(post: { coverImage: string | null; coverAlt: string | null }): string {
  if (!post.coverImage) return "";
  return (post.coverAlt ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Words a tag slug spells in capitals or a fixed case ("ai-agents" → "AI agents"). */
const TAG_WORDS: Record<string, string> = {
  ai: "AI",
  api: "API",
  apis: "APIs",
  css: "CSS",
  dns: "DNS",
  html: "HTML",
  llm: "LLM",
  llms: "LLMs",
  mcp: "MCP",
  rss: "RSS",
  saas: "SaaS",
  seo: "SEO",
  sql: "SQL",
  ui: "UI",
  ux: "UX",
  vps: "VPS",
  nextjs: "Next.js",
  postgres: "Postgres",
};

/** Prefixes that keep their hyphen in a label ("self-hosting" → "Self-hosting"). */
const HYPHEN_PREFIXES = new Set(["self", "open", "e", "co", "re", "multi", "non", "pre"]);

/**
 * A tag slug as a readable label: "getting-started" → "Getting started",
 * "ai-agents" → "AI agents", "self-hosting" → "Self-hosting". A tag that is
 * already free text (spaces, capitals) is shown as written. The slug stays in
 * the URL; only the visible text changes.
 */
export function tagLabel(tag: string): string {
  const t = tag.trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t)) return t;
  const words = t.split("-");
  let out = "";
  words.forEach((word, i) => {
    const shown = TAG_WORDS[word] ?? word;
    if (i === 0) out = TAG_WORDS[word] ? shown : shown.charAt(0).toUpperCase() + shown.slice(1);
    else out += (HYPHEN_PREFIXES.has(words[i - 1]) && i === 1 ? "-" : " ") + shown;
  });
  return out;
}

/**
 * The fill-in-the-blank placeholders the seeded privacy policy and terms ship
 * with (src/content/seed-posts.ts). A page that still carries one is an
 * unfinished template: noindex, out of the sitemap and llms files, and flagged
 * to admins. Fill them all in and the page is indexed on the next request.
 */
const TEMPLATE_PLACEHOLDER =
  /\[(?:Company name|Effective date|Product name|website URL|Jurisdiction|Registered address|Hosting provider|Region|City, Jurisdiction|GitHub \/ Google|one sentence describing what your product does)\](?!\()/gi;

/** The distinct template placeholders still in a Markdown body, in order of first use ([] when none). */
export function templatePlaceholders(body: string): string[] {
  return [...new Set(body.match(TEMPLATE_PLACEHOLDER) ?? [])];
}

/** True when a page still carries the template's placeholders (see templatePlaceholders). */
export function isUnfinishedTemplate(page: { body: string }): boolean {
  return templatePlaceholders(page.body).length > 0;
}
