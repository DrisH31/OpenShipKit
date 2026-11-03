//
// Input schemas for every write, shared by the services (src/server/services),
// the admin forms and the MCP tools (converted with z.toJSONSchema). Content
// section schemas are in ./content.ts.
//

import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lower-case words joined by hyphens: my-first-post");

export const postKindSchema = z.enum(["post", "changelog", "page"]);
export const postStatusSchema = z.enum(["draft", "published"]);

const isoDate = z.iso.datetime({ offset: true });

/**
 * A tag as it is stored and linked: lower case, words joined by hyphens
 * ("Getting Started" → "getting-started"). Letters of any script are kept.
 * Every writer (admin, MCP, seed, audit restore) stores this form, so one
 * topic has one /blog/tag/<tag> page, never "Guides" beside "guides".
 */
export function normalizeTag(tag: string): string {
  return tag
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Normalised, without empties and duplicates, in their first order. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

/** One tag: any text in, its normalised form out ("Getting Started" → "getting-started"). */
const tagSchema = z
  .string()
  .max(80)
  .transform(normalizeTag)
  .pipe(z.string().min(1, "a tag needs a letter or a digit").max(40));

/** Every editable post field, with no defaults — the base both schemas below derive from. */
const postFields = {
  slug: slugSchema.describe("Derived from the title when omitted"),
  title: z.string().min(1).max(200),
  description: z.string().max(300).describe("Summary for lists, meta description and RSS"),
  body: z.string().max(200_000).describe("Markdown (GitHub-flavoured)"),
  coverImage: z.string().max(500).nullable(),
  coverAlt: z
    .string()
    .max(300)
    .nullable()
    .describe("What the cover image shows, for screen readers and link previews. Empty or null when it's decorative"),
  tags: z
    .array(tagSchema)
    .max(10)
    .transform((tags) => [...new Set(tags)])
    .describe("Up to 10. Stored lower-case with hyphens: \"Getting Started\" becomes getting-started"),
  status: postStatusSchema,
  listed: z
    .boolean()
    .describe("Shown on /blog, tag pages and the landing page. false keeps a published post live at its URL, in the sitemap and feeds, but off the lists"),
  authorName: z.string().max(80).nullable(),
  seoTitle: z.string().max(70).nullable(),
  seoDescription: z.string().max(170).nullable(),
  publishedAt: isoDate.nullable(),
};

export const postCreateSchema = z.object({
  kind: postKindSchema.default("post"),
  slug: postFields.slug.optional(),
  title: postFields.title,
  description: postFields.description.default(""),
  body: postFields.body.default(""),
  coverImage: postFields.coverImage.default(null),
  coverAlt: postFields.coverAlt.default(null),
  tags: postFields.tags.default([]),
  status: postFields.status.default("draft"),
  listed: postFields.listed.default(true),
  authorName: postFields.authorName.default(null),
  seoTitle: postFields.seoTitle.default(null),
  seoDescription: postFields.seoDescription.default(null),
  publishedAt: postFields.publishedAt.default(null),
});

/**
 * A partial update: only the fields present change. Deliberately built from
 * the default-free fields — `postCreateSchema.partial()` would keep the
 * defaults, so `{ status: "published" }` would blank the body and tags.
 */
export const postUpdateSchema = z.object(postFields).partial();


/** A usage metric's name: lower-case words joined by underscores. */
export const METRIC_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const priceSchema = z.object({
  interval: z.enum(["month", "year", "one_time"]),
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().length(3).toLowerCase().default("usd"),
  polarProductId: z.string().max(100).nullable().default(null).describe("The Polar product this price checks out"),
  stripePriceId: z.string().max(100).nullable().optional().describe("The Stripe price this price checks out (price_…)"),
  // Letters, digits and underscores, as Razorpay's ids are: never the "<plan>:one_time" id the app makes
  // up for a one-time Razorpay price (priceIdFor), so a stored id can't collide with one.
  razorpayPlanId: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9_]+$/, "A Razorpay plan id, like plan_ABC123")
    .nullable()
    .optional()
    .describe("The Razorpay plan a recurring price subscribes to (plan_…). Not for a one-time price"),
  perSeat: z.boolean().optional().describe("Charged per seat (teams): the provider's product or price is seat- or unit-based. Recurring prices only"),
}).superRefine((price, ctx) => {
  // A one-time Razorpay price is a payment link for the plan's own amount (priceIdFor): a stored plan id
  // there would never be used, and storedPriceIds would disagree with what checkout sells.
  if (price.interval === "one_time" && price.razorpayPlanId) {
    ctx.addIssue({ code: "custom", path: ["razorpayPlanId"], message: "A one-time price needs no Razorpay plan: leave it empty." });
  }
});

export const planSchema = z.object({
  key: slugSchema.describe("Stable id: starter, pro, enterprise"),
  name: z.string().min(1).max(60),
  description: z.string().max(300).default(""),
  features: z.array(z.string().min(1).max(120)).max(20).default([]),
  prices: z.array(priceSchema).max(3).default([]).describe("Empty = free plan. At most one price per interval."),
  highlighted: z.boolean().default(false),
  contactSales: z.boolean().default(false),
  ctaLabel: z.string().min(1).max(40).default("Get started"),
  trialDays: z.number().int().min(1).max(365).nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  limits: z
    .record(z.string().regex(METRIC_RE, "Use lower-case words joined by underscores: api_calls").max(40), z.number().int().min(0).max(1_000_000_000))
    .default({})
    .describe("What the plan allows, by metric: { projects: 3, api_calls: 10000, seats: 5 }. A metric that isn't listed is unlimited."),
});
export const feedbackCreateSchema = z.object({
  kind: z.enum(["bug", "feature", "general", "contact"]),
  title: z.string().max(140).nullable().default(null),
  message: z.string().min(3).max(5000),
  email: z.email().nullable().default(null),
  name: z.string().max(80).nullable().default(null),
});

export const feedbackUpdateSchema = z.object({
  status: z.enum(["new", "planned", "in_progress", "done", "closed"]).optional(),
  adminNote: z.string().max(5000).nullable().optional(),
});

export const emailSchema = z.email().max(254).transform((e) => e.trim().toLowerCase());

export const agentScopeSchema = z.enum(["read", "write", "admin"]);
