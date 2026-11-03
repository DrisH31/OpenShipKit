import "server-only";

//
// Orientation tools: what this site is, how it is built, and the manual an
// agent reads once before editing. `guide` is generated from the same
// registries the site renders from (CONTENT_KEYS, the zod schemas), so it
// cannot describe a field that doesn't exist.
//

import { z } from "zod";
import { CONTENT_KEYS, CONTENT_KEY_LIST, type ContentKey } from "@/core/content";
import { planSchema, postCreateSchema } from "@/core/schemas";
import { POST_KIND } from "@/lib/status";
import { siteProfile, siteUrl } from "@/server/env";
import { renderMarkdown } from "@/server/markdown";
import { getOverview } from "@/server/services/overview";
import { RESTORABLE_ENTITIES } from "@/server/services/audit";
import { toJsonSchema } from "../json-schema";
import { READ_ONLY, defineTool } from "../types";
import { auditSummary } from "./shared";

/** Per-section advice the schema can't express. Keys without an entry need none. */
const CONTENT_TIPS: Partial<Record<ContentKey, string>> = {
  site: "name appears in every <title>, the header and emails. contactEmail is where every contact-form message (with the sender's name and email) is sent, so changing it — by content_update, content_reset or audit_restore — needs an admin key.",
  navigation: "header, headerCta and footer are separate; the arrays replace whole, so send the full list when you change one link.",
  announcement: "Set enabled: false to hide the bar rather than emptying the text.",
  hero: "title is the page's only <h1> and its biggest SEO signal: plain words about what the product does, under ~70 characters.",
  logos: "Either the open-source tools the product is built on or deploys with (a tool's name shows its mark when one is known, else the name alone; href is its project page), or real customers who agreed to be listed — never a customer who didn't. Optional group puts items under a label (\"Built on\", \"Deploys to servers you control\"); items sharing a group show together, in the order groups first appear. Set enabled: false to hide the strip.",
  features: "icon is a lucide name in kebab-case. Each description is one or two plain sentences.",
  stats: "Every figure needs a real source; a figure with no source is not shown in production. Never estimate one.",
  testimonials: "Real quotes from real people only, word for word, with their real name and role. Never write one.",
  pricing: "Only the copy around the cards. The plans themselves are edited with the plan_* tools.",
  faq: "answer may be several sentences; questions are phrased the way a visitor would ask them.",
};

const GUIDE_TOPICS = ["all", "content", "posts", "plans", "workflow"] as const;

export const siteOverview = defineTool({
  name: "site_overview",
  title: "Site overview",
  description:
    "Start here. Returns the site's URL and admin URL, what it runs on (profile: saas, or site for a landing page + blog with no pricing, billing or plans; data: postgres, or embedded-postgres in a local demo; billing: polar or none; email: resend or console), database health, headline counts (users, admins, subscribers, active subscriptions, purchases, published and draft posts, open feedback) and the ten most recent changes from the audit log. Takes no arguments.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({}),
  async run(_args, ctx) {
    const overview = await getOverview();
    return { ...overview, recentChanges: overview.recentChanges.map((entry) => auditSummary(entry, ctx)), adminUrl: `${overview.siteUrl}/admin` };
  },
});

/** Under the site profile the pricing section isn't shown and there are no plans to edit. */
const SITE_PROFILE_PRICING_TIP = "Not shown: this site runs OPENSHIPKIT_PROFILE=site (no pricing page, billing or plans). Edits are stored and come back if the profile is switched to saas.";

function contentManual() {
  const site = siteProfile() === "site";
  return {
    howItWorks:
      "The landing page and site chrome are built from JSON documents, one per key below. Each key has a schema; every write must pass it. A key that was never edited renders its built-in default (content_get shows stored: false).",
    keys: CONTENT_KEY_LIST.map((key) => ({
      key,
      label: CONTENT_KEYS[key].label,
      description: CONTENT_KEYS[key].description,
      ...(site && key === "pricing" ? { tip: SITE_PROFILE_PRICING_TIP } : CONTENT_TIPS[key] ? { tip: CONTENT_TIPS[key] } : {}),
      schema: toJsonSchema(CONTENT_KEYS[key].schema),
    })),
    links: `A link is {label, href}; href is a path (${site ? "/blog" : "/pricing"}), an anchor (#faq), mailto: or an http(s) URL.`,
    icons: "Feature icons are lucide icon names in kebab-case (\"shield-check\", \"zap\"); an unknown name renders a dot.",
  };
}

function postsManual() {
  const { post, changelog, page } = POST_KIND;
  return {
    kinds: {
      post: `A blog post, at ${post.publicPath}/<slug>; listed on ${post.publicPath}, in the RSS feed and the sitemap.`,
      changelog: `A changelog entry, at ${changelog.publicPath}/<slug> and on ${changelog.publicPath}, newest first.`,
      page: `A static page such as privacy or terms, at ${page.publicPath}/<slug>.`,
    },
    body: "Markdown (GitHub-flavoured). The title is the page's only <h1>, so start sections at ## (a # heading renders as <h2>). Raw HTML is sanitised. render_markdown_preview shows exactly what a body renders to.",
    status: "draft = invisible to the public (a 404); published = live. Publishing stamps publishedAt with now unless you give a past date. There is no scheduling: a published post dated in the future is refused, so publish on the day.",
    listed:
      "listed (default true) is whether a post shows on the lists: /blog, tag pages, the changelog list, related posts, the home page and llms.txt. It is a different question from status: listed false keeps a PUBLISHED post live at its url, in the sitemap, the RSS feed and llms-full.txt, but stops promoting it. Use it for a post that has outlived its reason to be advertised (the feature it announced is gone, a newer guide replaces it) instead of unpublishing, which would lose its search rankings and break links.",
    images:
      "Images live in the media library and are served from /uploads/…: media_list finds one, media_upload adds one (base64). Put its root-relative url in coverImage (and describe it in coverAlt) or in the body as ![what it shows](url). Never hot-link an image from another site.",
    slugs: "Lower-case words joined by hyphens. Derived from the title when omitted. A slug is a URL: don't change the slug of a published post unless asked.",
    seo: "description (≤300) is the list summary and default meta description; seoTitle (≤70) and seoDescription (≤170) override the <title> and meta description. Search results show about 155 characters of a description: put the main claim first and end the sentence inside that.",
    schema: toJsonSchema(postCreateSchema),
  };
}

/** The plans part of the guide under OPENSHIPKIT_PROFILE=site: there are none to edit. */
const NO_PLANS = {
  profile: "site",
  model:
    "This site runs OPENSHIPKIT_PROFILE=site: a landing page and blog with no pricing page, billing or plans. There are no plan tools; /pricing and /api/billing answer 404. Stored plans are kept untouched for a switch back to saas.",
};

function plansManual() {
  if (siteProfile() === "site") return NO_PLANS;
  return {
    model:
      "Plans are the cards on /pricing and what checkout sells. key is the stable id (free, pro …). A plan with no prices is free. At most one price per interval (month, year, one_time). contactSales shows \"Contact us\" instead of a checkout. highlighted marks the recommended card. sortOrder orders the cards. active: false hides a plan without deleting it.",
    money: "amountCents is an integer in minor units: $24.00 → 2400. currency is ISO 4217 lower case (usd).",
    polar:
      "amountCents is what the pricing page SHOWS. What a customer is CHARGED is the Polar product in polarProductId (billing is optional; with it off, paid plans show but can't be bought). When you change a price, the Polar product must be changed to match by a person with Polar access — say so in your reply. Never invent a product id; leave it null.",
    tools: "plan_update changes some fields of one plan (send the whole prices or features array to change one item); plan_upsert writes a complete plan; plan_delete removes one (prefer active: false).",
    scopes:
      "A write key edits a plan's copy and presentation: name, description, features, highlighted, contactSales, ctaLabel, active, sortOrder. Prices (amounts, intervals, Polar product ids), trialDays and plan_delete need an admin key, because they decide what customers are charged and which purchases unlock which plan.",
    schema: toJsonSchema(planSchema),
  };
}

function workflowManual() {
  return {
    rules: [
      `Read first: content_get / post_get${siteProfile() === "site" ? "" : " / plan_get"}, then change only what you were asked to.`,
      "To change one field, use content_update with mode \"merge\" and pass only that field, e.g. {key: \"hero\", mode: \"merge\", value: {title: \"New headline\"}}. Arrays are replaced whole, so send the full array when you edit a list item.",
      "Changes are live when the call returns. Create posts as drafts, show the person the draft (post_get → url), and publish when asked.",
      "Every write is in the audit log with before and after. audit_list → find the entry → audit_restore puts the before value back.",
      `Restorable: ${RESTORABLE_ENTITIES.join(", ")}. Feedback, users, subscribers and agent keys are audited but not restorable — be deliberate.`,
      "Never invent facts, customers, quotes, numbers, prices or provider ids. Leave unknown fields empty and say so.",
      "A refusal comes back as isError with {error, message, details}. error is one of invalid, not_found, conflict, forbidden, unavailable, rate_limited.",
    ],
    scopes: {
      read: "Read everything that is neither a secret nor personal data: feedback senders' emails and names are withheld, and in the audit log only content, post, plan, feedback and seed entries show their before/after (user, subscriber, billing and key entries are withheld).",
      write: "read + edit and publish content and posts (except site.contactEmail); edit plans' copy and presentation; triage feedback; restore from the audit log.",
      admin: "write + plan prices, Polar product ids, trials and deletion; site.contactEmail; users (roles, bans), subscribers, agent keys and personal data.",
    },
  };
}

export const guide = defineTool({
  name: "guide",
  title: "Guide to this site",
  description:
    "The manual for editing this site — call it once before your first write. Returns what OpenShipKit is, working rules, every editable content key with its label, description and full JSON Schema, the post kinds and Markdown rules, and the pricing-plan model. Pass topic to get one part only: content, posts, plans or workflow (default all).",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({
    topic: z.enum(GUIDE_TOPICS).optional().describe("One part of the guide; default all"),
  }),
  async run(args, ctx) {
    const topic = args.topic ?? "all";
    const site = siteProfile() === "site";
    const about = {
      what: site
        ? "OpenShipKit is an open-source SaaS starter (Next.js), running here as a content site (OPENSHIPKIT_PROFILE=site): a landing page and blog with no pricing, billing or plans. This MCP server edits the live site through the same validated, audited services as the admin panel at /admin."
        : "OpenShipKit is an open-source SaaS starter (Next.js). This MCP server edits the live site through the same validated, audited services as the admin panel at /admin.",
      siteUrl: siteUrl(),
      yourKey: { name: ctx.key.name, scope: ctx.key.scope },
    };
    if (topic === "content") return { ...about, content: contentManual() };
    if (topic === "posts") return { ...about, posts: postsManual() };
    if (topic === "plans") return { ...about, plans: plansManual() };
    if (topic === "workflow") return { ...about, workflow: workflowManual() };
    // Under the site profile "all" leaves plans out; topic "plans" says why.
    return { ...about, workflow: workflowManual(), content: contentManual(), posts: postsManual(), ...(site ? {} : { plans: plansManual() }) };
  },
});

export const renderMarkdownPreview = defineTool({
  name: "render_markdown_preview",
  title: "Preview Markdown",
  description:
    "Render a Markdown body exactly as a post page will (GitHub-flavoured, sanitised) without saving anything. Use it to check a body before post_create or post_update. Returns the HTML, the table of contents built from ## / ### headings, and the estimated reading minutes. Pass kind \"changelog\" to render headings one level lower, as /changelog does.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({
    markdown: z.string().max(200_000).describe("The Markdown body"),
    kind: z.enum(["post", "changelog", "page"]).optional().describe("Default post"),
  }),
  async run(args) {
    const rendered = renderMarkdown(args.markdown, { siteOrigin: siteUrl(), minDepth: args.kind === "changelog" ? 3 : 2 });
    return { html: rendered.html, toc: rendered.toc, readingMinutes: rendered.readingMinutes };
  },
});

export const SITE_TOOLS = [siteOverview, guide, renderMarkdownPreview];
