//
// Page metadata in one shape. Every public page builds its `Metadata` here so
// canonical, Open Graph and Twitter tags never drift apart.
//
// Pure: no env, no I/O. Callers pass values (the root layout sets metadataBase
// from siteUrl(), so a root-relative `path` resolves to an absolute canonical).
// Next REPLACES a parent's `openGraph` object rather than merging it, so this
// always emits a complete one — pass `siteName`/`locale` when you have them.
//

import type { Metadata } from "next";
import { openGraphLocale, xUsername } from "@/core/content";
import { metaDescription } from "./meta-description";
import { OPENSHIPKIT_NAME } from "./project";

export interface PageMetadataInput {
  /** The page's own title; the root layout's template appends " · Site name". */
  title: string;
  description: string;
  /** Root-relative path of this page, e.g. "/blog/hello". Becomes the canonical. */
  path: string;
  /**
   * Absolute or root-relative social image.
   *  - omitted (undefined): the site-wide image (`siteImage`) if one is set, else
   *    the site's generated card, /opengraph-image (Next does NOT inherit the
   *    root layout's image once a page sets its own openGraph);
   *  - null: no image here — the route's own opengraph-image file supplies it;
   *  - a URL: that image (it wins over an opengraph-image file and `siteImage`).
   */
  image?: string | null;
  /** What `image` shows. Wins over defaultImageAlt. */
  imageAlt?: string;
  /**
   * What the site's generated card shows, for when the page uses it: the site
   * name and tagline (getSiteSeo().cardAlt). Without it the alt falls back to
   * the site name, the card's largest text — never the page's own title, which
   * the card doesn't show.
   */
  defaultImageAlt?: string;
  /** Pixel size of an explicit `image` when it is known (a generated 1200×630 card). */
  imageSize?: { width: number; height: number };
  /**
   * The admin's site-wide social image (`site.ogImage`, via getSiteSeo().ogImage).
   * Used in place of the generated card on every page that doesn't pass its own
   * `image`; empty or undefined keeps the generated card.
   */
  siteImage?: string | null;
  type?: "website" | "article";
  /** true → noindex, follow (thin tag pages, filtered lists, account pages). */
  noindex?: boolean;
  publishedTime?: string | null;
  modifiedTime?: string | null;
  tags?: string[];
  authors?: string[];
  siteName?: string;
  /** The site's BCP 47 locale ("en", "en-GB"); emitted as og:locale in language_TERRITORY form (openGraphLocale, as the root layout does). */
  locale?: string;
  /** The site's X handle ("@openshipkit"), repeated because a page's `twitter` replaces the layout's. */
  twitterSite?: string;
  /** Use exactly this <title>, skipping the layout's template (the home page, an seoTitle). */
  absoluteTitle?: boolean;
  /**
   * RSS feeds advertised with <link rel="alternate" type="application/rss+xml">.
   * Default: the blog feed. A page's `alternates` replaces the root layout's,
   * so every page has to carry its feeds itself. Pass [] for none.
   */
  feeds?: FeedLink[];
}

export interface FeedLink {
  /** Root-relative or absolute feed URL. */
  url: string;
  title: string;
}

/** The blog feed (src/app/(marketing)/blog/rss.xml) — advertised on every page by default. */
export function blogFeed(siteName?: string): FeedLink {
  return { url: "/blog/rss.xml", title: siteName ? `${siteName} blog` : "Blog" };
}

/** The changelog feed — added on the changelog pages. */
export function changelogFeed(siteName?: string): FeedLink {
  return { url: "/changelog/rss.xml", title: siteName ? `${siteName} changelog` : "Changelog" };
}

/** Join an origin and a path into one absolute URL. Absolute `path`s pass through untouched. */
export function absoluteUrl(base: string, path = "/"): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = base.replace(/\/+$/, "");
  const rest = path.startsWith("/") ? path : `/${path}`;
  return rest === "/" ? `${origin}/` : `${origin}${rest}`;
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Make a rendered body's links work away from its page (an RSS reader resolves
 * nothing against the site): root-relative href/src become absolute, and
 * in-page "#fragment" links point at the page itself, not at wherever the body
 * now sits. `pageUrl` is the page's absolute URL.
 */
export function absolutizeHtmlLinks(html: string, base: string, pageUrl: string): string {
  const origin = base.replace(/\/+$/, "");
  return html
    .replace(/(\s(?:href|src))="\/(?!\/)/g, `$1="${escapeHtmlAttr(origin)}/`)
    .replace(/(\shref)="#/g, `$1="${escapeHtmlAttr(pageUrl)}#`);
}

/**
 * The same for Markdown source (llms-full.txt, where bodies sit one after
 * another in one file): inline links and images, reference definitions and
 * raw-HTML href/src. "#x" becomes `pageUrl#x`; "/x" becomes `base/x`. Fenced
 * code and inline code spans are left exactly as written.
 */
export function absolutizeMarkdownLinks(markdown: string, base: string, pageUrl: string): string {
  const origin = base.replace(/\/+$/, "");
  const target = (t: string) => (t.startsWith("#") ? `${pageUrl}${t}` : `${origin}${t}`);
  // [text](#x) · ![alt](/img.png) · [text](</a b>), and raw HTML.
  const prose = (text: string) =>
    absolutizeHtmlLinks(
      text.replace(/\]\(\s*(<?)(#|\/(?!\/))/g, (_m, angle: string, first: string) => `](${angle}${target(first)}`),
      base,
      pageUrl,
    );
  // [ref]: /path
  const definition = /^(\s{0,3}\[[^\]]+\]:\s*<?)(#|\/(?!\/))/;
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (marker) {
        if (!fence) fence = marker[0];
        else if (marker[0] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      if (definition.test(line)) return line.replace(definition, (_m, lead: string, first: string) => `${lead}${target(first)}`);
      // Odd parts are inline code spans: `x` or ``x``.
      return line
        .split(/(`+[^`]*?`+)/)
        .map((part, i) => (i % 2 === 1 ? part : prose(part)))
        .join("");
    })
    .join("\n");
}

/**
 * Query parameters that name a distinct page and so stay in its canonical: a
 * list page's cursor (/blog?cursor=…; such pages are noindex, follow, since a
 * cursor moves as posts are published). Everything else — the pager's trail,
 * utm_*, junk — is dropped.
 */
const CANONICAL_PARAMS = ["cursor"] as const;

/** Normalise a canonical path: leading slash, no trailing slash (except "/"), no hash, and only CANONICAL_PARAMS kept from the query. */
export function canonicalPath(path: string): string {
  const [rawPath = "/", rawQuery = ""] = (path.split("#")[0] ?? "").trim().split("?");
  const withSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const clean = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
  const from = new URLSearchParams(rawQuery);
  const kept = new URLSearchParams();
  for (const key of CANONICAL_PARAMS) {
    const value = from.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${clean}?${query}` : clean;
}

/** The root opengraph-image route (src/app/opengraph-image.tsx): the site's default card. */
export const DEFAULT_OG_IMAGE = "/opengraph-image";

/**
 * The robots directives of every indexable page. The root layout carries the
 * same object, and a page's `robots` REPLACES the layout's, so pageMetadata
 * repeats it in full: large image previews (the 1200×630 cards) in Search and
 * Discover, and snippets of any length.
 */
export const ROBOTS_INDEX = { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } as const;

/** Thin, filtered or private pages: kept out of the index, their links still followed. */
export const ROBOTS_NOINDEX = { index: false, follow: true } as const;

/**
 * Whether the site is still the OpenShipKit showcase: not yet renamed to the
 * template user's product. Its plans are samples and its story (the starter
 * posts, the FAQ) is the template's, so the home page, the footer, SEO and the
 * setup checklist all ask this one question.
 */
export function isShowcase(site: { name: string }): boolean {
  return site.name === OPENSHIPKIT_NAME;
}

/**
 * The X handle in what the admin typed, as "@name", or undefined when it isn't
 * one: "https://x.com/acme", "x.com/acme/status/1", "twitter.com/acme", "@acme"
 * and "acme" all give "@acme"; another site's address gives undefined. The rule
 * is xUsername (src/core/content.ts), which Site settings validates with, so
 * twitter:site (getSiteSeo().twitterSite), the footer's X link (xProfileUrl)
 * and the form can't disagree.
 */
export function xHandle(value: string): string | undefined {
  const name = xUsername(value);
  return name ? `@${name}` : undefined;
}

/** The X profile address for what the admin typed ("https://x.com/acme"), or undefined (see xHandle). */
export function xProfileUrl(value: string): string | undefined {
  const handle = xHandle(value);
  return handle ? `https://x.com/${handle.slice(1)}` : undefined;
}

/** What the site's generated card (/opengraph-image) shows, as its alt text: "Acme: The tagline". */
export function siteCardAlt(name: string, tagline?: string): string {
  const n = name.trim();
  const t = tagline?.replace(/\s+/g, " ").trim();
  return t ? `${n}: ${t}` : n;
}

/** The size of every generated card (src/components/seo/og-card.tsx renders at this size). */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * The title social previews show. The layout's "%s · Site" template reaches
 * only <title>, so og:title and twitter:title carry the site name themselves —
 * a link to /pricing previews as "Pricing · Acme", not a bare "Pricing".
 * Absolute titles (the home page, an seoTitle) are used exactly.
 */
export function socialTitle(input: Pick<PageMetadataInput, "title" | "absoluteTitle" | "siteName">): string {
  return !input.absoluteTitle && input.siteName ? `${input.title} · ${input.siteName}` : input.title;
}

/**
 * A changelog entry's absolute <title>, naming the brand once. Release titles
 * usually start with the product's name ("Acme 2.0"), so the layout's
 * "%s · Acme" template would say it twice: "Acme 2.0 · Changelog", but
 * "Dark mode · Acme changelog".
 */
export function changelogEntryTitle(title: string, siteName: string): string {
  const name = siteName.trim();
  if (!name) return `${title} · Changelog`;
  return title.toLowerCase().includes(name.toLowerCase()) ? `${title} · Changelog` : `${title} · ${name} changelog`;
}

/** Build a page's Metadata: title, description, canonical, feeds, robots, Open Graph and Twitter card. */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const path = canonicalPath(input.path);
  const type = input.type ?? "website";
  const siteImage = input.siteImage?.trim() || undefined;
  const image = input.image === undefined ? (siteImage ?? DEFAULT_OG_IMAGE) : input.image;
  const feeds = input.feeds ?? [blogFeed(input.siteName)];
  const title = socialTitle(input);
  // The meta, og and twitter descriptions keep to the snippet budget (an editable
  // subtitle or summary may run longer); the page itself shows the full text.
  const description = metaDescription(input.description);
  const size = image === DEFAULT_OG_IMAGE ? OG_IMAGE_SIZE : input.image === undefined ? undefined : input.imageSize;
  // The generated card shows the site's name and tagline; any other image says what it shows via imageAlt.
  const alt = input.imageAlt || (image === DEFAULT_OG_IMAGE ? input.defaultImageAlt || input.siteName || undefined : undefined);
  const images = image ? [{ url: image, ...(size ? { width: size.width, height: size.height } : {}), ...(alt ? { alt } : {}) }] : undefined;

  const openGraph: NonNullable<Metadata["openGraph"]> =
    type === "article"
      ? {
          type: "article",
          title,
          description,
          url: path,
          ...(input.siteName ? { siteName: input.siteName } : {}),
          ...(input.locale ? { locale: openGraphLocale(input.locale) } : {}),
          ...(images ? { images } : {}),
          ...(input.publishedTime ? { publishedTime: input.publishedTime } : {}),
          ...(input.modifiedTime ? { modifiedTime: input.modifiedTime } : {}),
          ...(input.tags?.length ? { tags: input.tags } : {}),
          ...(input.authors?.length ? { authors: input.authors } : {}),
        }
      : {
          type: "website",
          title,
          description,
          url: path,
          ...(input.siteName ? { siteName: input.siteName } : {}),
          ...(input.locale ? { locale: openGraphLocale(input.locale) } : {}),
          ...(images ? { images } : {}),
        };

  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description,
    alternates: {
      canonical: path,
      ...(feeds.length ? { types: { "application/rss+xml": feeds.map((f) => ({ url: f.url, title: f.title })) } } : {}),
    },
    robots: input.noindex ? { ...ROBOTS_NOINDEX } : { ...ROBOTS_INDEX },
    openGraph,
    twitter: {
      card: "summary_large_image",
      ...(input.twitterSite ? { site: input.twitterSite } : {}),
      title,
      description,
      // Objects, not bare URLs, so twitter:image:alt is emitted too.
      ...(images ? { images: images.map((i) => ({ url: i.url, ...(i.alt ? { alt: i.alt } : {}) })) } : {}),
    },
  };
}
