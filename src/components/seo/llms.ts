import "server-only";

//
// /llms.txt and /llms-full.txt, in the llmstxt.org shape: an H1 with the site
// name, a blockquote summary, then H2 sections of links. llms-full.txt adds
// the full Markdown of every published post, changelog entry and page.
// llms.txt is a map, so it names the newest LISTED posts; llms-full.txt is
// the corpus, so it carries unlisted ones too (they are live and indexable).
//
// While the site is the OpenShipKit showcase (not yet renamed), the files say
// what an agent needs about the template itself — the repo, the one-line
// quick start, the docs and the MCP endpoint — and label the plans as the
// samples they are: OpenShipKit is free. Rename the site and both sections
// step aside for your product's real pricing, as the home page does.
//
// Under OPENSHIPKIT_PROFILE=site there is no pricing page and nothing for sale:
// no plans are read, no /pricing link is written, and the showcase's pricing
// section says only that the template is free.
//
// Legal pages still carrying the seeded template's placeholders are left out
// (they're noindex too; see legal/[slug]), and so, on a renamed site, are the
// starter posts and changelog entry still in OpenShipKit's words
// (isHiddenStarter): they'd tell an agent your product is OpenShipKit.
//
// Honest framing: no AI vendor or Google treats llms.txt as a ranking or
// citation signal; the server-rendered pages are what crawlers read. It's a
// cheap, accurate map for agents that do fetch it. Reads throw on failure.
//

import type { Plan, Post } from "@/core/types";
import { siteProfile, without } from "@/server/env";
import { listPlans } from "@/server/services/plans";
import { formatPrice } from "@/shared/money";
import { OPENSHIPKIT_REPO } from "@/shared/project";
import { absoluteUrl, absolutizeMarkdownLinks } from "@/shared/seo";
import { getAllPublished, getListedPage, isHiddenStarter } from "@/components/blog/data";
import { isUnfinishedTemplate } from "@/components/blog/format";
import { getSiteSeo } from "./site-seo";

/** One line per plan: "Pro: $19/month or $190/year, 14-day free trial. For founders …". */
export function planSummary(plan: Plan, locale = "en"): string {
  let price: string;
  if (plan.contactSales) price = "contact sales";
  else if (plan.prices.length === 0) price = "free";
  else {
    price = plan.prices
      .map((p) => `${formatPrice(p.amountCents, p.currency, locale)}${p.interval === "month" ? "/month" : p.interval === "year" ? "/year" : " once"}`)
      .join(" or ");
  }
  const trial = plan.trialDays ? `, ${plan.trialDays}-day free trial` : "";
  const desc = plan.description ? ` ${plan.description}` : "";
  const features = plan.features.length ? ` Includes: ${plan.features.join("; ")}.` : "";
  return `${plan.name}: ${price}${trial}.${desc}${features}`;
}

/** Markdown-safe link text: no brackets that would break the [text](url) syntax. */
function linkText(text: string): string {
  return text.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function linkLine(base: string, title: string, path: string, note?: string): string {
  return `- [${linkText(title)}](${absoluteUrl(base, path)})${note ? `: ${oneLine(note)}` : ""}`;
}

interface Corpus {
  base: string;
  name: string;
  description: string;
  locale: string;
  /** Still the OpenShipKit showcase: plans are samples, and the template's own facts are listed. */
  showcase: boolean;
  /** The template's source repository (showcase only; "" otherwise). */
  repo: string;
  /** False under OPENSHIPKIT_PROFILE=site: no /pricing page to link, and no plans. */
  pricingPage: boolean;
  /** The blog is on (not in OPENSHIPKIT_WITHOUT). */
  blog: boolean;
  plans: Plan[];
  posts: Post[];
  changelog: Post[];
  pages: Post[];
}

/** How much to read: the short map needs the newest few; the full file needs everything. */
interface CorpusSize {
  posts: number;
  changelog: number;
}

async function loadCorpus(size: CorpusSize | "all"): Promise<Corpus> {
  const newest = (kind: "post" | "changelog", limit: number) => getListedPage(kind, limit, null, null).then((page) => page.items);
  const pricingPage = siteProfile() === "saas";
  const blog = !without().includes("blog"); // OPENSHIPKIT_WITHOUT=blog: no posts, no /blog links
  const [{ base, name, site, locale, showcase }, plans, posts, changelog, pages] = await Promise.all([
    getSiteSeo(),
    pricingPage ? listPlans({ activeOnly: true }) : [],
    !blog ? [] : size === "all" ? getAllPublished("post", 1000) : newest("post", size.posts),
    size === "all" ? getAllPublished("changelog", 1000) : newest("changelog", size.changelog),
    getAllPublished("page", 200),
  ]);
  return {
    base,
    name,
    description: site.description,
    locale,
    showcase,
    // The showcase IS the template, so its repository is OpenShipKit's own
    // (src/shared/project.ts). The site's GitHub profile is deliberately empty
    // by default (Invariant 8), so it can't be the source here.
    repo: showcase ? githubRepo(OPENSHIPKIT_REPO) : "",
    pricingPage,
    blog,
    plans,
    posts: posts.filter((p) => !isHiddenStarter(p, showcase)),
    changelog: changelog.filter((p) => !isHiddenStarter(p, showcase)),
    pages: pages.filter((p) => !isUnfinishedTemplate(p)),
  };
}

/** "https://github.com/owner/repo" (trailing slash or .git dropped), or "" for anything else. */
export function githubRepo(url: string): string {
  const m = url.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}` : "";
}

function header(c: Corpus): string[] {
  return [`# ${c.name}`, "", `> ${oneLine(c.description)}`, ""];
}

/**
 * The facts an agent needs about the template itself: where the code is, how
 * to start it, where the docs are and how to reach the MCP server. Showcase
 * only — a renamed site is your product, and this section is OpenShipKit's.
 * To list your own developer facts, return them here.
 */
export function getStartedLines(c: Pick<Corpus, "base" | "showcase" | "repo">): string[] {
  if (!c.showcase || !c.repo) return [];
  const doc = (file: string) => `${c.repo}/blob/main/docs/${file}`;
  return [
    "## Get started",
    "",
    `- Source code (MIT): ${c.repo}`,
    `- Quick start: \`git clone ${c.repo}.git my-saas && cd my-saas && npm install && npm run dev\` — runs on an embedded Postgres with no accounts to create.`,
    `- [Getting started](${doc("getting-started.md")}): install, configure and customise`,
    `- [Deployment](${doc("deployment.md")}): Docker compose on a VPS, Dokploy, Coolify or plain Node`,
    `- [MCP server](${doc("mcp.md")}): the tools an agent gets, keys and scopes`,
    `- [SEO and AI search](${doc("seo.md")}): metadata, JSON-LD, sitemap, RSS and these llms files`,
    `- MCP endpoint: ${absoluteUrl(c.base, "/api/mcp")} (Streamable HTTP; send an agent key as \`Authorization: Bearer <key>\`, created in /admin/agents)`,
    "",
  ];
}

/** The pricing section: the real plans, or — in the showcase — "free", then the plans labelled as samples. */
export function pricingLines(c: Pick<Corpus, "base" | "name" | "locale" | "showcase" | "plans"> & { pricingPage?: boolean }): string[] {
  if (c.showcase) {
    // The template is free; its plans are samples for the SaaS you build (see the home page FAQ).
    return [
      "## Pricing",
      "",
      `${c.name} is free and MIT-licensed: no paid tier and no licence key. You pay only for the server you run it on.`,
      "",
      ...(c.plans.length
        ? [
            "### Sample plans",
            "",
            `These ship with the template as a starting point for your own SaaS. They are not prices for ${c.name}.`,
            "",
            ...c.plans.map((p) => `- ${planSummary(p, c.locale)}`),
            "",
          ]
        : []),
    ];
  }
  if (c.plans.length === 0 || c.pricingPage === false) return [];
  return ["## Pricing", "", ...c.plans.map((p) => `- ${planSummary(p, c.locale)}`), "", linkLine(c.base, "Pricing page", "/pricing", "current plans and checkout"), ""];
}

/** The short map: key pages, pricing, the newest posts and releases, legal pages. */
export async function buildLlmsTxt(): Promise<string> {
  const c = await loadCorpus({ posts: 30, changelog: 10 });
  const lines = [
    ...header(c),
    `This file lists the main pages of ${c.name} for language models and agents. The full text of every post, release note and policy is in ${absoluteUrl(c.base, "/llms-full.txt")}.`,
    "",
    "## Key pages",
    "",
    linkLine(c.base, "Home", "/", "what the product is and who it’s for"),
    ...(c.pricingPage ? [linkLine(c.base, "Pricing", "/pricing", c.showcase ? "the sample plans a new SaaS starts with" : "plans and prices")] : []),
    ...(c.blog ? [linkLine(c.base, "Blog", "/blog", "guides and articles")] : []),
    linkLine(c.base, "Changelog", "/changelog", "every release, newest first"),
    linkLine(c.base, "Contact", "/contact", "questions, sales and support"),
    "",
    ...getStartedLines(c),
    ...pricingLines(c),
  ];
  if (c.posts.length) {
    lines.push("## Blog", "", ...c.posts.map((p) => linkLine(c.base, p.title, `/blog/${p.slug}`, p.description)), "");
  }
  if (c.changelog.length) {
    lines.push("## Changelog", "", ...c.changelog.map((p) => linkLine(c.base, p.title, `/changelog/${p.slug}`, p.description)), "");
  }
  const optional = [
    ...c.pages.map((p) => linkLine(c.base, p.title, `/legal/${p.slug}`, p.description)),
    ...(c.blog ? [linkLine(c.base, "Blog RSS feed", "/blog/rss.xml")] : []),
    linkLine(c.base, "Changelog RSS feed", "/changelog/rss.xml"),
    linkLine(c.base, "Sitemap", "/sitemap.xml"),
  ];
  lines.push("## Optional", "", ...optional, "");
  return lines.join("\n");
}

/**
 * Push every ATX heading down two levels (max h6) so a document's own
 * headings sit directly under its "###" title: a body's "##" becomes "####".
 * (Bodies use "##" as their top level; the page title is the only h1.) Fenced
 * code is left alone: a "# comment" in a shell block is not a heading.
 */
export function demoteHeadings(markdown: string): string {
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
      const m = line.match(/^(#{1,6})(\s.*)?$/);
      if (!m) return line;
      return `${"#".repeat(Math.min(6, m[1].length + 2))}${m[2] ?? ""}`;
    })
    .join("\n");
}

function document(c: Corpus, post: Post, path: string): string[] {
  const url = absoluteUrl(c.base, path);
  const meta = [
    `URL: ${url}`,
    post.publishedAt ? `Published: ${post.publishedAt.slice(0, 10)}` : "",
    post.updatedAt && post.updatedAt.slice(0, 10) !== post.publishedAt?.slice(0, 10) ? `Updated: ${post.updatedAt.slice(0, 10)}` : "",
    post.authorName ? `Author: ${post.authorName}` : "",
    post.tags.length ? `Tags: ${post.tags.join(", ")}` : "",
  ].filter(Boolean);
  // The file holds many documents: a body's "#fragment" and root-relative links must name its own page.
  const body = absolutizeMarkdownLinks(demoteHeadings(post.body), c.base, url).trim();
  return [`### ${oneLine(post.title)}`, "", ...meta, "", ...(post.description ? [`> ${oneLine(post.description)}`, ""] : []), body, "", "---", ""];
}

/** Everything: the short map's header, get-started and pricing, then every published document in full. */
export async function buildLlmsFullTxt(): Promise<string> {
  const c = await loadCorpus("all");
  const lines = [...header(c), ...getStartedLines(c), ...pricingLines(c)];
  if (c.posts.length) {
    lines.push("## Blog posts", "");
    for (const p of c.posts) lines.push(...document(c, p, `/blog/${p.slug}`));
  }
  if (c.changelog.length) {
    lines.push("## Changelog", "");
    for (const p of c.changelog) lines.push(...document(c, p, `/changelog/${p.slug}`));
  }
  if (c.pages.length) {
    lines.push("## Pages", "");
    for (const p of c.pages) lines.push(...document(c, p, `/legal/${p.slug}`));
  }
  return lines.join("\n");
}

/** A plain-text response for either file (Markdown content; text/plain so browsers display it). */
export function llmsResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
      "X-Robots-Tag": "noindex",
    },
  });
}
