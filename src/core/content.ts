//
// The editable site, as schemas. Each CONTENT_KEYS entry is one JSON document
// in the DataStore's `content` repo, validated by its zod schema on every read
// and write. The same schema drives:
//   - the landing page (src/server/services/content.ts → getContent(key)),
//   - the admin editor (/admin/content/<key>),
//   - the MCP tools (content_get / content_update — JSON Schema via z.toJSONSchema).
//
// To make a new section editable: add a schema here, a default in
// src/content/defaults.ts, and render it. Nothing else changes — admin and MCP
// pick it up from this registry.
//

import { z } from "zod";

const href = z
  .string()
  .min(1)
  .max(500)
  .refine((v) => v.startsWith("/") || v.startsWith("#") || /^https?:\/\//.test(v) || v.startsWith("mailto:"), {
    message: "Use a path (/pricing), an anchor (#faq), mailto: or an http(s) URL",
  });

export const linkSchema = z.object({
  label: z.string().min(1).max(60),
  href,
});

/** A lucide-react icon name in kebab-case ("shield-check"). Unknown names fall back to a dot. */
const iconName = z.string().max(40).regex(/^[a-z0-9-]+$/, "kebab-case lucide icon name");

/** A BCP 47 language tag ("en", "en-GB", "pt-BR"), the form <html lang> and Intl need. */
function isLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/** The site locale as <html lang> wants it: canonical BCP 47 ("en-GB"); "en" if it isn't a tag. */
export function htmlLang(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? "en";
  } catch {
    return "en";
  }
}

/** The site locale as og:locale wants it: language_TERRITORY ("en" → "en_US", "pt-BR" → "pt_BR"). */
export function openGraphLocale(locale: string): string {
  try {
    const full = new Intl.Locale(htmlLang(locale)).maximize();
    return full.region ? `${full.language}_${full.region}` : full.language;
  } catch {
    return "en_US";
  }
}

/** The social networks Site settings has a field for. */
export type SocialNetwork = "x" | "github" | "linkedin" | "youtube" | "discord";

/**
 * The X username in what the admin typed ("acme"), or null: "https://x.com/acme",
 * "x.com/acme/status/1", "twitter.com/acme", "@acme" and "acme" all name
 * "acme"; another site's address names none. src/shared/seo.ts xHandle (the
 * footer's X link and twitter:site) reads the same rule.
 */
export function xUsername(value: string): string | null {
  const name = value
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0];
  return /^\w{1,15}$/.test(name) ? name : null;
}

/** Where a bare handle lives, per network; absent where a handle alone isn't an address. */
const SOCIAL_PROFILE: Partial<Record<SocialNetwork, (handle: string) => string>> = {
  github: (h) => `https://github.com/${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
};

/** A host with at least one dot, then optionally a path: "github.com/acme", "discord.gg/abc". */
const BARE_ADDRESS = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;
/** A handle: letters, digits, _ . - (an optional leading @). */
const HANDLE = /^@?([\w.-]+)$/;

/**
 * The link for a social setting, or null when the value can't be made into
 * one — the ONE rule: the footer links with it and Site settings validates
 * with it (isSocialProfile), so they can't disagree.
 *   - X: the profile of the username in it (xUsername);
 *   - GitHub, YouTube: an http(s) URL, a bare address with a dot
 *     ("github.com/acme"), or a handle, "@acme" or "acme";
 *   - LinkedIn, Discord: an address only. A name alone could be /in/ or
 *     /company/, and a Discord server is an invite.
 */
export function socialHref(network: SocialNetwork, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (network === "x") {
    const name = xUsername(value);
    return name ? `https://x.com/${name}` : null;
  }
  if (/^https?:\/\//i.test(value)) return isWebAddress(value) ? value : null;
  // A handle first: "@acme" or "acme". A dotted name without @ ("acme.dev") reads as an address.
  const handle = value.match(HANDLE);
  if (handle && (value.startsWith("@") || !value.includes("."))) {
    const profile = SOCIAL_PROFILE[network];
    return profile ? profile(handle[1]) : null;
  }
  if (BARE_ADDRESS.test(value)) {
    const url = `https://${value}`;
    return isWebAddress(url) ? url : null;
  }
  return null;
}

/** Empty, or a value socialHref() can link. */
export function isSocialProfile(network: SocialNetwork, raw: string): boolean {
  return raw.trim() === "" || socialHref(network, raw) !== null;
}

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

const SOCIAL_MESSAGES: Record<SocialNetwork, string> = {
  x: "Paste your X profile address (https://x.com/yourname) or @handle",
  github: "Paste the full https:// profile address, or @handle",
  youtube: "Paste the full https:// profile address, or @handle",
  linkedin: "Paste the full https:// address, like https://www.linkedin.com/company/yourco. A name alone can’t be linked here.",
  discord: "Paste the full https:// invite address, like https://discord.gg/invite. A name alone can’t be linked here.",
};

/** One social field: what the footer can link, or a sentence saying what to paste instead. */
function socialField(network: SocialNetwork) {
  return z
    .string()
    .max(200)
    .refine((v) => isSocialProfile(network, v), { message: SOCIAL_MESSAGES[network] })
    .default("");
}

export const siteSchema = z.object({
  name: z.string().min(1).max(60).describe("Product name, shown in the header, titles and emails"),
  tagline: z.string().max(120).describe("Short line used in the default <title>: \"Name — tagline\""),
  description: z.string().max(300).describe("Default meta description and Open Graph description"),
  keywords: z.array(z.string().max(40)).max(20).default([]),
  contactEmail: z.string().email().or(z.literal("")).default(""),
  /** Organisation name for JSON-LD and the footer's copyright line. */
  legalName: z.string().max(120).default(""),
  locale: z
    .string()
    .max(35)
    .refine(isLanguageTag, { message: 'Use a BCP 47 language tag with a hyphen: "en", "en-GB", "pt-BR" (not "en_US")' })
    .default("en")
    .describe("Language of the site as a BCP 47 tag; sets <html lang>, og:locale and date formats"),
  social: z
    .object({
      x: socialField("x"),
      github: socialField("github"),
      linkedin: socialField("linkedin"),
      youtube: socialField("youtube"),
      discord: socialField("discord"),
    })
    .default({ x: "", github: "", linkedin: "", youtube: "", discord: "" }),
  /** Absolute or root-relative image for social cards; empty → the generated /opengraph-image. */
  ogImage: z.string().max(500).default(""),
});

export const navigationSchema = z.object({
  header: z.array(linkSchema).max(8),
  headerCta: linkSchema.nullable(),
  footer: z
    .array(
      z.object({
        title: z.string().min(1).max(40),
        links: z.array(linkSchema).max(10),
      }),
    )
    .max(5),
});

export const announcementSchema = z.object({
  enabled: z.boolean(),
  text: z.string().max(140),
  link: linkSchema.nullable(),
});

export const heroSchema = z.object({
  eyebrow: z.string().max(60),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(300),
  primaryCta: linkSchema,
  secondaryCta: linkSchema.nullable(),
  /**
   * Up to three short points under the lead, each with a check ("No vendor
   * lock-in"): the reader's worries answered at a glance. Optional with a
   * default, so a hero stored before they existed still passes; empty shows none.
   */
  highlights: z.array(z.string().trim().min(1).max(48)).max(3).default([]),
  /** A real product screenshot (root-relative or absolute URL); empty shows the built-in product preview. */
  image: z.string().max(500).default(""),
  imageAlt: z.string().max(200).default(""),
});

/**
 * The "built on" strip. Items may name a `group` ("Built on", "Deploys with"):
 * items sharing one are shown together under it, in the order the groups first
 * appear; with no groups the strip is one row under `title`. Optional with a
 * default, so values stored before groups existed still pass.
 */
export const logosSchema = z.object({
  enabled: z.boolean(),
  title: z.string().max(80).describe("The strip's heading; with groups it is read by screen readers and the group names show instead"),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        href: z.string().max(500).default(""),
        group: z.string().max(40).default("").describe("Optional: items with the same group show together under it"),
      }),
    )
    .max(16),
});

export const featuresSchema = z.object({
  eyebrow: z.string().max(60),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(300),
  items: z
    .array(
      z.object({
        icon: iconName,
        title: z.string().min(1).max(80),
        description: z.string().max(300),
      }),
    )
    .max(12),
});

export const stepsSchema = z.object({
  enabled: z.boolean(),
  eyebrow: z.string().max(60),
  title: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        description: z.string().max(300),
        code: z.string().max(400).default(""),
      }),
    )
    .max(6),
});

export const statsSchema = z.object({
  enabled: z.boolean(),
  items: z
    .array(
      z.object({
        value: z.string().min(1).max(20),
        label: z.string().min(1).max(80),
        /** Where the number comes from. A figure with no source is not shown in production. */
        source: z.string().max(200).default(""),
      }),
    )
    .max(6),
});

export const testimonialsSchema = z.object({
  enabled: z.boolean(),
  title: z.string().max(120),
  items: z
    .array(
      z.object({
        quote: z.string().min(1).max(500),
        name: z.string().min(1).max(80),
        role: z.string().max(120),
        avatar: z.string().max(500).default(""),
        href: z.string().max(500).default(""),
      }),
    )
    .max(12),
});

export const pricingSchema = z.object({
  eyebrow: z.string().max(60),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(300),
  /** Small print under the cards: "Prices in USD. Cancel anytime." */
  note: z.string().max(300),
});

export const faqSchema = z.object({
  title: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        question: z.string().min(1).max(200),
        answer: z.string().min(1).max(2000),
      }),
    )
    .max(30),
});

export const ctaSchema = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(300),
  primaryCta: linkSchema,
  secondaryCta: linkSchema.nullable(),
});

/**
 * The landing page's "latest posts" band: the newest published, LISTED blog
 * posts (unlisted ones are never promoted here). Hidden when off or when
 * there are none. The posts themselves are edited under Posts.
 */
export const latestPostsSchema = z.object({
  enabled: z.boolean(),
  eyebrow: z.string().max(60),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(300),
  /** How many posts to show. */
  count: z.number().int().min(1).max(6),
  /** The link to /blog under the list; empty hides it. */
  linkLabel: z.string().max(40),
});

export const CONTENT_KEYS = {
  site: { schema: siteSchema, label: "Site settings", description: "Name, tagline, SEO defaults, contact and social links." },
  navigation: { schema: navigationSchema, label: "Navigation", description: "Header links, header call-to-action and footer columns." },
  announcement: { schema: announcementSchema, label: "Announcement bar", description: "The thin bar above the header." },
  hero: { schema: heroSchema, label: "Hero", description: "The first screen of the landing page." },
  logos: { schema: logosSchema, label: "Logo strip", description: "The open-source tools it’s built on and deploys with (or real customers), as marks and names under the hero, optionally in groups." },
  features: { schema: featuresSchema, label: "Features", description: "The feature grid." },
  steps: { schema: stepsSchema, label: "How it works", description: "A short numbered sequence." },
  stats: { schema: statsSchema, label: "Stats", description: "Figures with their sources." },
  testimonials: { schema: testimonialsSchema, label: "Testimonials", description: "Quotes from real customers." },
  pricing: { schema: pricingSchema, label: "Pricing section", description: "Copy around the plan cards. Plans themselves are edited under Plans." },
  latestPosts: { schema: latestPostsSchema, label: "Latest posts", description: "The newest blog posts on the landing page (listed posts only)." },
  faq: { schema: faqSchema, label: "FAQ", description: "Questions and answers (also emitted as FAQPage JSON-LD)." },
  cta: { schema: ctaSchema, label: "Closing call-to-action", description: "The last band before the footer." },
} as const;

export type ContentKey = keyof typeof CONTENT_KEYS;
export type ContentValue<K extends ContentKey> = z.infer<(typeof CONTENT_KEYS)[K]["schema"]>;

export const CONTENT_KEY_LIST = Object.keys(CONTENT_KEYS) as ContentKey[];

export function isContentKey(key: unknown): key is ContentKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(CONTENT_KEYS, key);
}

export type SiteContent = ContentValue<"site">;
