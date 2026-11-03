//
// The SEO surfaces' pure parts: pageMetadata, the JSON-LD builders and their
// escaping, the RSS document, the llms.txt helpers, robots and the seed
// content (valid against the post schema, and rendering cleanly).
//

import { describe, expect, it } from "vitest";
import type { Plan, Post } from "@/core/types";
import { postCreateSchema } from "@/core/schemas";
import { SEED_POSTS } from "@/content/seed-posts";
import { renderMarkdown } from "@/server/markdown";
import { formatPrice, offerPrice, toMajorUnits } from "@/shared/money";
import { ROBOTS_INDEX, absoluteUrl, canonicalPath, changelogFeed, isShowcase, pageMetadata, siteCardAlt, xProfileUrl } from "@/shared/seo";
import { OPENSHIPKIT_NAME } from "@/shared/project";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { openGraphLocale } from "@/core/content";
import { isStarterContent } from "@/content/seed-posts";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  collectionPageJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  serializeJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "@/shared/jsonld";
import { buildRss, cdata, xmlEscape } from "./rss";
import { buildIco } from "./ico";
import { demoteHeadings, getStartedLines, githubRepo, planSummary, pricingLines } from "./llms";
import { xHandle } from "./site-seo";
import { META_DESCRIPTION_MAX, metaDescription } from "./meta-description";
import robots from "@/app/robots";
import { isHiddenStarter, paginate, pageHref, parseTrail } from "@/components/blog/data";
import { isIndexableTag, isUnfinishedTemplate, pageLabel, safeImageUrl, tagLabel, templatePlaceholders, wasUpdated } from "@/components/blog/format";
import { tocItems } from "@/components/blog/toc";

const BASE = "https://example.test";

function post(over: Partial<Post> = {}): Post {
  return {
    id: "p1",
    kind: "post",
    slug: "hello",
    title: "Hello <world> & friends",
    description: "A first post",
    body: "## Intro\n\nSee [pricing](/pricing) and ![chart](/img/c.png).\n\n```ts\nconst x = ']]>';\n```",
    coverImage: null,
    coverAlt: null,
    tags: ["guides"],
    status: "published",
    listed: true,
    authorName: null,
    seoTitle: null,
    seoDescription: null,
    publishedAt: "2026-10-01T09:00:00.000Z",
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-03T09:00:00.000Z",
    ...over,
  };
}

const plans: Plan[] = [
  { id: "1", key: "free", name: "Free", description: "", features: [], prices: [], highlighted: false, contactSales: false, ctaLabel: "Start", trialDays: null, active: true, sortOrder: 0, limits: {}, updatedAt: "" },
  {
    id: "2",
    key: "pro",
    name: "Pro",
    description: "For founders.",
    features: ["Unlimited projects"],
    prices: [
      { interval: "month", amountCents: 1900, currency: "usd", polarProductId: null },
      { interval: "year", amountCents: 19000, currency: "usd", polarProductId: null },
    ],
    highlighted: true,
    contactSales: false,
    ctaLabel: "Upgrade",
    trialDays: 14,
    active: true,
    sortOrder: 1, limits: {},
    updatedAt: "",
  },
  { id: "3", key: "ent", name: "Enterprise", description: "", features: [], prices: [], highlighted: false, contactSales: true, ctaLabel: "Talk", trialDays: null, active: true, sortOrder: 2, limits: {}, updatedAt: "" },
];

describe("pageMetadata", () => {
  it("sets a normalised canonical, OG and Twitter for a page", () => {
    const m = pageMetadata({ title: "Pricing", description: "Plans", path: "pricing/?x=1#top", siteName: "Acme", twitterSite: "@acme" });
    expect(m.alternates?.canonical).toBe("/pricing");
    // The full directive set, the root layout's too: a page's robots replaces the layout's.
    expect(m.robots).toEqual({ index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 });
    expect(m.robots).toEqual(ROBOTS_INDEX);
    // The layout's title template reaches only <title>, so social titles carry the site name themselves.
    expect(m.title).toBe("Pricing");
    expect(m.openGraph).toMatchObject({ type: "website", url: "/pricing", siteName: "Acme", title: "Pricing · Acme" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", site: "@acme", title: "Pricing · Acme" });
    // An absolute title (the home page, an seoTitle) is used exactly, everywhere.
    const home = pageMetadata({ title: "Acme — Ship it", description: "", path: "/", absoluteTitle: true, siteName: "Acme" });
    expect(home.openGraph).toMatchObject({ title: "Acme — Ship it" });
    expect(home.twitter).toMatchObject({ title: "Acme — Ship it" });
  });

  it("emits article fields and noindex when asked", () => {
    const m = pageMetadata({
      title: "Post",
      description: "d",
      path: "/blog/post",
      type: "article",
      noindex: true,
      publishedTime: "2026-10-01",
      modifiedTime: "2026-10-02",
      tags: ["a"],
      image: "/cover.png",
    });
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.openGraph).toMatchObject({ type: "article", publishedTime: "2026-10-01", modifiedTime: "2026-10-02", tags: ["a"] });
    expect(m.twitter).toMatchObject({ images: [{ url: "/cover.png" }] });
  });

  it("gives an explicit card its size and alt, on Open Graph and Twitter alike", () => {
    const m = pageMetadata({ title: "Post", description: "", path: "/blog/x", image: "/blog/x/og", imageSize: { width: 1200, height: 630 }, imageAlt: "Post" });
    expect(m.openGraph).toMatchObject({ images: [{ url: "/blog/x/og", width: 1200, height: 630, alt: "Post" }] });
    expect(m.twitter).toMatchObject({ images: [{ url: "/blog/x/og", alt: "Post" }] });
  });

  it("uses the site-wide image in place of the generated card, but never over a page's own", () => {
    const d = pageMetadata({ title: "Pricing", description: "", path: "/pricing", siteImage: "https://cdn.test/og.png" });
    expect(d.openGraph).toMatchObject({ images: [{ url: "https://cdn.test/og.png" }] });
    expect(d.twitter).toMatchObject({ images: [{ url: "https://cdn.test/og.png" }] });
    const own = pageMetadata({ title: "Post", description: "", path: "/blog/x", image: "/blog/x/og", siteImage: "https://cdn.test/og.png" });
    expect(own.openGraph).toMatchObject({ images: [{ url: "/blog/x/og" }] });
    const empty = pageMetadata({ title: "Pricing", description: "", path: "/pricing", siteImage: "  " });
    expect(empty.openGraph).toMatchObject({ images: [{ url: "/opengraph-image", width: 1200, height: 630 }] });
  });

  it("defaults to the site card, and null defers to the route's own opengraph-image", () => {
    const d = pageMetadata({ title: "Blog", description: "", path: "/blog" });
    expect(d.openGraph).toMatchObject({ images: [{ url: "/opengraph-image", width: 1200, height: 630 }] });
    expect(d.twitter).toMatchObject({ images: [{ url: "/opengraph-image" }] });
    // The card's alt says what the card shows — never the page's title, which the card doesn't.
    expect(JSON.stringify(d.openGraph)).not.toContain('"alt":"Blog"');
    const n = pageMetadata({ title: "Post", description: "", path: "/blog/x", image: null });
    expect(n.openGraph).not.toHaveProperty("images");
    expect(n.twitter).not.toHaveProperty("images");
  });

  it("advertises the blog feed by default, and exactly the feeds passed otherwise", () => {
    const d = pageMetadata({ title: "Pricing", description: "", path: "/pricing", siteName: "Acme" });
    expect(d.alternates).toEqual({ canonical: "/pricing", types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "Acme blog" }] } });
    const c = pageMetadata({ title: "Changelog", description: "", path: "/changelog", feeds: [changelogFeed("Acme")] });
    expect(c.alternates?.types).toEqual({ "application/rss+xml": [{ url: "/changelog/rss.xml", title: "Acme changelog" }] });
    expect(pageMetadata({ title: "X", description: "", path: "/x", feeds: [] }).alternates).toEqual({ canonical: "/x" });
  });

  it("can skip the title template", () => {
    expect(pageMetadata({ title: "Exact", description: "", path: "/", absoluteTitle: true }).title).toEqual({ absolute: "Exact" });
  });

  it("joins origins and paths", () => {
    expect(absoluteUrl("https://a.test/", "/x")).toBe("https://a.test/x");
    expect(absoluteUrl("https://a.test", "x")).toBe("https://a.test/x");
    expect(absoluteUrl("https://a.test", "/")).toBe("https://a.test/");
    expect(absoluteUrl("https://a.test", "https://cdn.test/i.png")).toBe("https://cdn.test/i.png");
    expect(canonicalPath("/blog/")).toBe("/blog");
    expect(canonicalPath("/")).toBe("/");
    // A list page past the first keeps its cursor (its own canonical); the trail and tracking params go.
    expect(canonicalPath("/blog?cursor=abc&trail=x&utm_source=y#top")).toBe("/blog?cursor=abc");
    expect(canonicalPath("/pricing?utm_source=y")).toBe("/pricing");
    expect(pageMetadata({ title: "Blog", description: "", path: "/blog?cursor=abc" }).alternates?.canonical).toBe("/blog?cursor=abc");
  });
});

describe("JSON-LD", () => {
  it("escapes < > & so content can't close the script tag", () => {
    const out = serializeJsonLd(faqPageJsonLd([{ question: "</script><script>alert(1)</script>", answer: "a & b" }]));
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(out).mainEntity[0].name).toBe("</script><script>alert(1)</script>");
  });

  it("builds Organization and WebSite without empty placeholders", () => {
    const org = organizationJsonLd({ base: BASE, name: "Acme", legalName: "", email: "", sameAs: ["", "https://github.com/acme"], logo: "/apple-icon" });
    expect(org).toMatchObject({ "@type": "Organization", name: "Acme", url: `${BASE}/`, logo: `${BASE}/apple-icon`, sameAs: ["https://github.com/acme"] });
    expect(org).not.toHaveProperty("legalName");
    expect(org).not.toHaveProperty("contactPoint");
    expect(websiteJsonLd({ base: BASE, name: "Acme" })).toMatchObject({ "@type": "WebSite", url: `${BASE}/`, publisher: { "@id": `${BASE}/#organization` } });
  });

  it("mirrors plans as Offers, skipping contact-sales plans, with no rating", () => {
    const app = softwareApplicationJsonLd({ base: BASE, name: "Acme", plans });
    const offers = app.offers as Record<string, unknown>[];
    expect(offers).toHaveLength(3);
    expect(offers[0]).toMatchObject({ price: 0, priceCurrency: "USD" });
    expect(offers[1]).toMatchObject({ price: "19.00", priceCurrency: "USD" });
    expect(app).not.toHaveProperty("aggregateRating");
  });

  it("prices zero-decimal currencies in whole units (¥500 is 500, not 5)", () => {
    const yen: Plan = { ...plans[1], prices: [{ interval: "month", amountCents: 500, currency: "jpy", polarProductId: null }] };
    const offer = softwareApplicationJsonLd({ base: BASE, name: "Acme", plans: [yen] }).offers as Record<string, unknown>;
    expect(offer).toMatchObject({ price: "500", priceCurrency: "JPY", priceSpecification: { price: "500" } });
    expect(toMajorUnits(500, "JPY")).toBe(500);
    expect(toMajorUnits(1950, "usd")).toBe(19.5);
    expect(offerPrice(1950, "usd")).toBe("19.50");
    expect(formatPrice(500, "jpy")).toBe("¥500");
    expect(formatPrice(1950, "eur")).toBe("€19.50");
    expect(formatPrice(1900, "usd")).toBe("$19");
    expect(formatPrice(1900, "zzz")).toMatch(/19/);
  });

  it("uses the Organization as author when there's no real person", () => {
    const a = articleJsonLd({ base: BASE, path: "/blog/x", headline: "X", publisherName: "Acme", images: ["/blog/x/opengraph-image"], datePublished: "2026-10-01" });
    expect(a.author).toMatchObject({ "@type": "Organization", name: "Acme" });
    expect(a.image).toEqual([`${BASE}/blog/x/opengraph-image`]);
    expect(a.dateModified).toBe("2026-10-01");
  });

  it("numbers breadcrumbs and collection items from 1 with absolute URLs", () => {
    const b = breadcrumbJsonLd(BASE, [{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }]);
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${BASE}/blog` },
    ]);
    const c = collectionPageJsonLd({ base: BASE, path: "/blog", name: "Blog", items: [{ name: "A", path: "/blog/a" }] });
    expect(c).toMatchObject({ "@type": "CollectionPage", url: `${BASE}/blog`, mainEntity: { numberOfItems: 1 } });
  });
});

describe("RSS", () => {
  it("escapes XML text and splits ]]> inside CDATA", () => {
    expect(xmlEscape(`a<b>&"'`)).toBe("a&lt;b&gt;&amp;&quot;&apos;");
    expect(cdata("x]]>y")).toBe("<![CDATA[x]]]]><![CDATA[>y]]>");
  });

  it("builds a valid-looking RSS 2.0 feed with absolute links", () => {
    const xml = buildRss({
      base: BASE,
      title: "Acme Blog",
      description: "News & notes",
      language: "en",
      path: "/blog",
      feedPath: "/blog/rss.xml",
      itemPath: (p) => `/blog/${p.slug}`,
      posts: [post()],
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<atom:link href="${BASE}/blog/rss.xml" rel="self" type="application/rss+xml"/>`);
    expect(xml).toContain(`<link>${BASE}/blog/hello</link>`);
    expect(xml).toContain("<title>Hello &lt;world&gt; &amp; friends</title>");
    expect(xml).toContain("<lastBuildDate>Sat, 03 Oct 2026 09:00:00 GMT</lastBuildDate>");
    expect(xml).toContain(`href="${BASE}/pricing"`);
    expect(xml).toContain(`src="${BASE}/img/c.png"`);
    // the code block's "]]>" must not end the CDATA early
    const encoded = xml.slice(xml.indexOf("<content:encoded>"), xml.indexOf("</content:encoded>"));
    expect(encoded.split("<![CDATA[").length - 1).toBe(encoded.split("]]>").length - 1);
    expect(xml.trim().endsWith("</rss>")).toBe(true);
  });

  it("points in-page #fragment links at the post, not at the feed", () => {
    const xml = buildRss({
      base: BASE,
      title: "Acme Blog",
      description: "",
      language: "en",
      path: "/blog",
      feedPath: "/blog/rss.xml",
      itemPath: (p) => `/blog/${p.slug}`,
      posts: [post({ body: "## Setup\n\nSee [the end](#setup) or [pricing](/pricing)." })],
    });
    expect(xml).toContain(`href="${BASE}/blog/hello#setup"`);
    expect(xml).not.toContain('href="#');
    expect(xml).toContain(`href="${BASE}/pricing"`);
  });
});

describe("llms.txt helpers", () => {
  it("summarises plans in words", () => {
    expect(planSummary(plans[0])).toBe("Free: free.");
    expect(planSummary(plans[1])).toBe("Pro: $19/month or $190/year, 14-day free trial. For founders. Includes: Unlimited projects.");
    expect(planSummary(plans[2])).toBe("Enterprise: contact sales.");
    expect(planSummary({ ...plans[1], prices: [{ interval: "month", amountCents: 500, currency: "jpy", polarProductId: null }] })).toMatch(/^Pro: ¥500\/month/);
  });

  it("demotes headings two levels, so a body's ## sits under the ### title, and leaves fenced code alone", () => {
    expect(demoteHeadings("# A\n## B\n```bash\n# comment\n```\n#### D\n##### E")).toBe("### A\n#### B\n```bash\n# comment\n```\n###### D\n###### E");
  });

  it("labels the showcase's plans as samples and says the template is free", () => {
    const showcase = pricingLines({ base: BASE, name: "OpenShipKit", locale: "en", showcase: true, plans }).join("\n");
    expect(showcase).toContain("OpenShipKit is free and MIT-licensed");
    expect(showcase).toContain("### Sample plans");
    expect(showcase).toContain("They are not prices for OpenShipKit.");
    expect(showcase.indexOf("free and MIT-licensed")).toBeLessThan(showcase.indexOf("Pro: $19/month"));
    const product = pricingLines({ base: BASE, name: "Acme", locale: "en", showcase: false, plans }).join("\n");
    expect(product).not.toMatch(/sample|free and MIT/i);
    expect(product).toContain("- Pro: $19/month");
    expect(pricingLines({ base: BASE, name: "Acme", locale: "en", showcase: false, plans: [] })).toEqual([]);
  });

  it("lists the repo, quick start, docs and MCP endpoint only in the showcase", () => {
    const lines = getStartedLines({ base: BASE, showcase: true, repo: "https://github.com/acme/kit" }).join("\n");
    expect(lines).toContain("## Get started");
    expect(lines).toContain("git clone https://github.com/acme/kit.git my-saas && cd my-saas && npm install && npm run dev");
    expect(lines).toContain("https://github.com/acme/kit/blob/main/docs/mcp.md");
    expect(lines).toContain(`${BASE}/api/mcp`);
    expect(getStartedLines({ base: BASE, showcase: false, repo: "https://github.com/acme/kit" })).toEqual([]);
    expect(getStartedLines({ base: BASE, showcase: true, repo: "" })).toEqual([]);
    expect(githubRepo("https://github.com/acme/kit.git")).toBe("https://github.com/acme/kit");
    expect(githubRepo("https://github.com/acme")).toBe("");
    expect(githubRepo("https://evil.test/acme/kit")).toBe("");
  });
});

describe("robots.txt", () => {
  it("allows everyone, AI crawlers by name, with the same private disallows", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const agents = rules.map((x) => x.userAgent);
    for (const bot of ["*", "GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "OAI-SearchBot", "Claude-SearchBot"]) expect(agents).toContain(bot);
    for (const rule of rules) {
      expect(rule.allow).toBe("/");
      // Auth pages stay crawlable so their noindex is seen (see robots.ts).
      expect(rule.disallow).toEqual(["/admin", "/dashboard", "/api/"]);
    }
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("pagination and small helpers", () => {
  it("walks forward and back through cursor pages", () => {
    const p1 = paginate("/blog", null, [], "12");
    expect(p1).toMatchObject({ isFirst: true, newerHref: null, olderHref: "/blog?cursor=12&trail=", canonical: "/blog" });
    const t2 = new URL(`https://x.test${p1.olderHref}`).searchParams.get("trail") ?? undefined;
    const p2 = paginate("/blog", "12", parseTrail(t2), "24");
    expect(p2).toMatchObject({ isFirst: false, newerHref: "/blog", newerLabel: "Newer", canonical: "/blog?cursor=12" });
    const t3 = new URL(`https://x.test${p2.olderHref}`).searchParams.get("trail") ?? undefined;
    const p3 = paginate("/blog", "24", parseTrail(t3), null);
    expect(p3).toMatchObject({ newerHref: "/blog?cursor=12&trail=", newerLabel: "Newer", olderHref: null, canonical: "/blog?cursor=24" });
  });

  it("doesn't pretend to know the page before a canonical URL fetched cold", () => {
    // A crawler fetching /blog?cursor=24 has no trail: "Newer" can't be page 2, so it's "Newest" (page 1).
    const cold = paginate("/blog", "24", parseTrail(undefined), "36");
    expect(cold).toMatchObject({ isFirst: false, newerHref: "/blog", newerLabel: "Newest", canonical: "/blog?cursor=24" });
    // Walking on from there keeps a partial trail, so coming back is exact.
    const t = new URL(`https://x.test${cold.olderHref}`).searchParams.get("trail") ?? undefined;
    expect(paginate("/blog", "36", parseTrail(t), null)).toMatchObject({ newerHref: "/blog?cursor=24", newerLabel: "Newer" });
  });

  it("labels later pages by the date of their newest item, not a number the cursor can't know", () => {
    expect(pageLabel("2026-09-12T10:00:00.000Z", "en")).toBe("September 12, 2026 and earlier");
    expect(pageLabel("2026-09-12T10:00:00.000Z", "en-GB")).toBe("12 September 2026 and earlier");
    expect(pageLabel(null)).toBe("earlier");
  });

  it("keeps a cursor containing a comma intact in the trail", () => {
    const href = pageHref("/blog", "c3", ["", "a,b"]);
    const trail = new URL(`https://x.test${href}`).searchParams.get("trail") ?? undefined;
    expect(parseTrail(trail)).toEqual(["", "a,b"]);
  });

  it("accepts only path or http(s) images", () => {
    expect(safeImageUrl("/a.png")).toBe("/a.png");
    expect(safeImageUrl("https://cdn.test/a.png")).toBe("https://cdn.test/a.png");
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("//evil.test/a.png")).toBeNull();
    expect(safeImageUrl("data:image/png;base64,AAA")).toBeNull();
  });

  it("shows Updated only on a later day", () => {
    expect(wasUpdated("2026-10-01T09:00:00Z", "2026-10-01T18:00:00Z")).toBe(false);
    expect(wasUpdated("2026-10-01T09:00:00Z", "2026-10-02T08:00:00Z")).toBe(true);
  });

  it("shows tag slugs as readable labels", () => {
    expect(tagLabel("getting-started")).toBe("Getting started");
    expect(tagLabel("ai-agents")).toBe("AI agents");
    expect(tagLabel("self-hosting")).toBe("Self-hosting");
    expect(tagLabel("mcp")).toBe("MCP");
    expect(tagLabel("guides")).toBe("Guides");
    expect(tagLabel("Already Nice")).toBe("Already Nice");
  });

  it("emits the same og:locale as the root layout (one converter: openGraphLocale)", () => {
    for (const [tag, og] of [
      ["en", "en_US"],
      ["en-GB", "en_GB"],
      ["de", "de_DE"],
      ["ar", "ar_EG"],
      ["sr", "sr_RS"],
      ["zh-Hant", "zh_TW"],
    ] as const) {
      expect(openGraphLocale(tag)).toBe(og);
      expect(pageMetadata({ title: "T", description: "D", path: "/", locale: tag }).openGraph).toMatchObject({ locale: og });
    }
  });

  it("describes the generated card by what it shows", () => {
    expect(siteCardAlt("Acme", "Ship it  this weekend")).toBe("Acme: Ship it this weekend");
    expect(siteCardAlt("Acme", "")).toBe("Acme");
    const withAlt = pageMetadata({ title: "Pricing", description: "", path: "/pricing", siteName: "Acme", defaultImageAlt: "Acme: Ship it" });
    expect(withAlt.openGraph).toMatchObject({ images: [{ url: "/opengraph-image", alt: "Acme: Ship it" }] });
    expect(withAlt.twitter).toMatchObject({ images: [{ url: "/opengraph-image", alt: "Acme: Ship it" }] });
    const nameOnly = pageMetadata({ title: "Pricing", description: "", path: "/pricing", siteName: "Acme" });
    expect(nameOnly.openGraph).toMatchObject({ images: [{ alt: "Acme" }] });
    // Another image keeps its own alt, and never borrows the card's.
    const own = pageMetadata({ title: "P", description: "", path: "/p", image: "/x.png", defaultImageAlt: "Acme: Ship it" });
    expect(JSON.stringify(own.openGraph)).not.toContain("Ship it");
  });

  it("indexes a tag page only with enough posts and when it isn't on nearly every post", () => {
    expect(isIndexableTag(2, 10)).toBe(false);
    expect(isIndexableTag(3, 10)).toBe(true);
    expect(isIndexableTag(3, 3)).toBe(false);
    expect(isIndexableTag(4, 5)).toBe(false);
    expect(isIndexableTag(7, 10)).toBe(true);
    expect(isIndexableTag(8, 10)).toBe(false);
  });

  it("lists h2 and h3 in the TOC, and nothing below two sections", () => {
    const h = (depth: 2 | 3 | 4, id: string) => ({ depth, id, text: id });
    expect(tocItems([h(2, "a")])).toEqual([]);
    expect(tocItems([h(2, "a"), h(4, "b")])).toEqual([]);
    expect(tocItems([h(2, "a"), h(3, "b"), h(4, "c")]).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("packs PNGs into a valid .ico directory", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const ico = buildIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    const v = new DataView(ico.buffer);
    expect([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)]).toEqual([0, 1, 2]);
    expect([v.getUint8(6), v.getUint32(6 + 8, true), v.getUint32(6 + 12, true)]).toEqual([16, 3, 38]);
    expect([v.getUint8(22), v.getUint32(22 + 8, true), v.getUint32(22 + 12, true)]).toEqual([0, 2, 41]);
    expect([...ico.slice(38)]).toEqual([1, 2, 3, 4, 5]);
    expect(() => buildIco([])).toThrow(RangeError);
  });

  it("normalises X handles", () => {
    expect(xHandle("https://x.com/acme")).toBe("@acme");
    expect(xHandle("@acme")).toBe("@acme");
    expect(xHandle("acme")).toBe("@acme");
    expect(xHandle("")).toBeUndefined();
    expect(xHandle("x.com/acme/status/1")).toBe("@acme");
    expect(xHandle("https://bsky.app/profile/acme")).toBeUndefined();
    expect(xProfileUrl("@acme")).toBe("https://x.com/acme");
    expect(xProfileUrl("twitter.com/acme")).toBe("https://x.com/acme");
    expect(xProfileUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("knows the showcase by the template's own name", () => {
    expect(DEFAULT_CONTENT.site.name).toBe(OPENSHIPKIT_NAME);
    expect(isShowcase(DEFAULT_CONTENT.site)).toBe(true);
    expect(isShowcase({ name: "Acme" })).toBe(false);
  });
});

describe("seed content", () => {
  it("passes the post schema and has the required kinds", () => {
    for (const p of SEED_POSTS) expect(() => postCreateSchema.parse(p)).not.toThrow();
    const kinds = SEED_POSTS.map((p) => `${p.kind}:${p.slug}`);
    expect(kinds).toEqual(expect.arrayContaining(["changelog:openshipkit-1-0", "page:privacy", "page:terms"]));
    expect(SEED_POSTS.filter((p) => p.kind === "post")).toHaveLength(3);
  });

  it("recognises unchanged starter posts, and nothing else", () => {
    const welcome = SEED_POSTS.find((p) => p.slug === "welcome-to-openshipkit")!;
    const entry = SEED_POSTS.find((p) => p.kind === "changelog")!;
    const as = (p: (typeof SEED_POSTS)[number]) => ({ kind: p.kind, slug: p.slug, title: p.title, body: p.body ?? "" });
    expect(isStarterContent(as(welcome))).toBe(true);
    expect(isStarterContent(as(entry))).toBe(true);
    // CRLF from a pasted edit is still the seeded text.
    expect(isStarterContent({ ...as(welcome), title: "Hello", body: (welcome.body ?? "").replace(/\n/g, "\r\n") })).toBe(true);
    // Rewritten (new title and body): your post now.
    expect(isStarterContent({ ...as(welcome), title: "Welcome to Acme", body: "Our story." })).toBe(false);
    // Same slug, other kind; and the legal pages, which their placeholders govern.
    expect(isStarterContent({ ...as(welcome), kind: "changelog" })).toBe(false);
    for (const p of SEED_POSTS.filter((x) => x.kind === "page")) expect(isStarterContent(as(p))).toBe(false);
    // Hidden only once the site is renamed: the showcase IS OpenShipKit, so its story stays indexed there.
    expect(isHiddenStarter(as(welcome), true)).toBe(false);
    expect(isHiddenStarter(as(welcome), false)).toBe(true);
    expect(isHiddenStarter({ ...as(welcome), title: "Welcome to Acme", body: "Ours." }, false)).toBe(false);
  });

  it("puts no tag on every starter post (its tag page would repeat /blog)", () => {
    const posts = SEED_POSTS.filter((p) => p.kind === "post");
    const tags = new Set(posts.flatMap((p) => p.tags ?? []));
    for (const t of tags) expect(posts.every((p) => p.tags?.includes(t)), t).toBe(false);
  });

  it("uses stable October 2026 dates", () => {
    for (const p of SEED_POSTS) expect(p.publishedAt).toMatch(/^2026-10-\d\dT/);
  });

  it("renders every body with a TOC and no raw HTML leaking through", () => {
    for (const p of SEED_POSTS) {
      const { html, toc } = renderMarkdown(p.body ?? "");
      expect(toc.length).toBeGreaterThan(2);
      expect(html).not.toMatch(/<script|<h1/);
    }
  });

  it("marks the legal pages as templates, not legal advice", () => {
    for (const p of SEED_POSTS.filter((x) => x.kind === "page")) {
      expect(p.body).toContain("This is a template, not legal advice");
      expect(p.body).toMatch(/\[Company name\]/);
      expect(p.body).toMatch(/\[Jurisdiction\]/);
      // …so they stay noindex and out of the sitemap and llms files until filled in.
      expect(isUnfinishedTemplate({ body: p.body ?? "" }), p.slug).toBe(true);
    }
    for (const p of SEED_POSTS.filter((x) => x.kind !== "page")) expect(isUnfinishedTemplate({ body: p.body ?? "" }), p.slug).toBe(false);
  });

  it("finds template placeholders, but not links or footnotes", () => {
    expect(templatePlaceholders("By [Company name] in [Jurisdiction]; [Company name] again.")).toEqual(["[Company name]", "[Jurisdiction]"]);
    expect(templatePlaceholders("See [Region](/regions), [^1] and [x] done.")).toEqual([]);
    expect(isUnfinishedTemplate({ body: "Acme Ltd, registered in England." })).toBe(false);
  });

  it("links only to pages that exist", () => {
    const internal = SEED_POSTS.flatMap((p) => [...(p.body ?? "").matchAll(/\]\((\/[^)\s#]*)/g)].map((m) => m[1]));
    const known = new Set([
      "/pricing",
      "/contact",
      "/changelog",
      "/blog",
      ...SEED_POSTS.filter((p) => p.kind === "page").map((p) => `/legal/${p.slug}`),
      ...SEED_POSTS.filter((p) => p.kind === "post").map((p) => `/blog/${p.slug}`),
    ]);
    expect(internal.length).toBeGreaterThan(3);
    for (const href of internal) expect(known.has(href), href).toBe(true);
  });

  it("in-page #anchors land on a heading id the renderer produces", () => {
    for (const p of SEED_POSTS) {
      const { html } = renderMarkdown(p.body ?? "");
      const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
      for (const m of (p.body ?? "").matchAll(/\]\(#([^)\s]+)\)/g)) expect(ids.has(m[1]), `${p.slug} → #${m[1]}`).toBe(true);
    }
  });

  it("describes the one independent stack: no removed vendors, no stack switcher", () => {
    const removed = /\b(clerk|workos|supabase|convex|stripe|nodemailer|smtp)\b|npm run stack|five stacks/i;
    for (const p of SEED_POSTS) {
      const text = `${p.title}\n${p.description}\n${p.seoTitle ?? ""}\n${p.seoDescription ?? ""}\n${p.body ?? ""}`;
      // Not even the 1.0 changelog names them: it ships on every fork's public /changelog.
      const lines = text.split("\n").filter((line) => removed.test(line));
      expect(lines, p.slug).toEqual([]);
    }
  });

  it("keeps every seed title and description inside the SEO limits", () => {
    for (const p of SEED_POSTS) {
      expect((p.seoTitle ?? p.title).length, p.slug).toBeLessThanOrEqual(70);
      expect((p.seoDescription ?? p.description ?? "").length, p.slug).toBeLessThanOrEqual(170);
    }
  });

  it("names the optional processors in the privacy template", () => {
    const privacy = SEED_POSTS.find((p) => p.kind === "page" && p.slug === "privacy")?.body ?? "";
    expect(privacy).toMatch(/Polar/);
    expect(privacy).toMatch(/merchant of record/);
    expect(privacy).toMatch(/Resend/);
    expect(privacy).toMatch(/servers we operate/);
  });
});

describe("metaDescription", () => {
  it("keeps a description inside the budget untouched (whitespace collapsed)", () => {
    expect(metaDescription("  Ship a SaaS\n on your own server.  ")).toBe("Ship a SaaS on your own server.");
    const exact = "x".repeat(META_DESCRIPTION_MAX);
    expect(metaDescription(exact)).toBe(exact);
  });

  it("cuts a long one at a word boundary, with an ellipsis, within the budget", () => {
    const long = "Self-hosted auth, Postgres and billing in one Next.js app, so the first version of your product runs on a server you own, with an admin, a blog, an MCP server and more.";
    const out = metaDescription(long);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
    expect(out.slice(0, -1)).not.toMatch(/[\s,]$/);
    // One giant word is cut where it stands.
    expect(metaDescription("y".repeat(400)).length).toBe(META_DESCRIPTION_MAX);
  });

  it("is applied by pageMetadata to the meta, Open Graph and Twitter descriptions on every page", () => {
    const long = `${"Plans and prices, ".repeat(12)}and nothing else.`;
    const short = metaDescription(long);
    for (const type of ["website", "article"] as const) {
      const m = pageMetadata({ title: "Pricing", description: long, path: "/pricing", type });
      expect(m.description).toBe(short);
      expect(m.openGraph?.description).toBe(short);
      expect(m.twitter?.description).toBe(short);
    }
  });
});
