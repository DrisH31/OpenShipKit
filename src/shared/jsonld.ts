//
// schema.org JSON-LD builders. Pure (no env, no I/O): callers pass the site
// origin and the values, and render the result with <JsonLd> from
// src/components/seo/json-ld.tsx — a plain <script> in the server HTML.
//
// Rules: mark up only what the page visibly shows; every URL absolute; never
// add a rating that wasn't collected on this site; empty fields are omitted,
// never shipped as placeholders. FAQPage no longer earns a Google rich result
// (May 2026) but still describes the page for other readers.
//

import type { Plan } from "@/core/types";
import { offerPrice } from "./money";
import { absoluteUrl } from "./seo";
import { slugify } from "./slug";

export type JsonLdObject = { "@context"?: string; "@type": string | string[]; [key: string]: unknown };

const CONTEXT = "https://schema.org";

/** Drop undefined, null, "" and [] so the output never carries empty placeholders. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

/** Stable @id values, so the graph's nodes reference each other instead of repeating. */
export const jsonLdIds = {
  organization: (base: string) => `${absoluteUrl(base, "/")}#organization`,
  website: (base: string) => `${absoluteUrl(base, "/")}#website`,
  software: (base: string) => `${absoluteUrl(base, "/")}#software`,
  /**
   * A named author, the same on every article: "https://example.com/#person-ada-lovelace".
   * Without it each article mints its own Person and the author never becomes one
   * entity. Null when the name has no letters or digits to slug (the Person is then
   * written without an @id rather than sharing "#person-" with every such name).
   */
  person: (base: string, name: string): string | null => {
    const slug = slugify(name);
    return slug ? `${absoluteUrl(base, "/")}#person-${slug}` : null;
  },
};

export interface OrganizationInput {
  base: string;
  name: string;
  legalName?: string;
  description?: string;
  /** Absolute or root-relative; at least 112×112 and legible on white. */
  logo?: string;
  email?: string;
  /** Profiles of the same entity: GitHub, X, LinkedIn … (empty strings are dropped). */
  sameAs?: string[];
}

export function organizationJsonLd(input: OrganizationInput): JsonLdObject {
  return compact({
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": jsonLdIds.organization(input.base),
    name: input.name,
    legalName: input.legalName,
    url: absoluteUrl(input.base, "/"),
    description: input.description,
    logo: input.logo ? absoluteUrl(input.base, input.logo) : undefined,
    contactPoint: input.email ? { "@type": "ContactPoint", email: input.email, contactType: "customer support" } : undefined,
    sameAs: (input.sameAs ?? []).filter((u) => /^https?:\/\//.test(u)),
  });
}

export interface WebsiteInput {
  base: string;
  name: string;
  description?: string;
  /** BCP 47, e.g. "en". */
  inLanguage?: string;
  alternateName?: string;
}

export function websiteJsonLd(input: WebsiteInput): JsonLdObject {
  return compact({
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": jsonLdIds.website(input.base),
    name: input.name,
    alternateName: input.alternateName,
    url: absoluteUrl(input.base, "/"),
    description: input.description,
    inLanguage: input.inLanguage,
    publisher: { "@id": jsonLdIds.organization(input.base) },
  });
}

export interface SoftwareApplicationInput {
  base: string;
  name: string;
  description?: string;
  /** One of Google's supported values: "BusinessApplication", "DeveloperApplication" … */
  applicationCategory?: string;
  operatingSystem?: string;
  /** Active plans as shown on /pricing. Each price becomes an Offer; a plan with no price is a free Offer. */
  plans?: Plan[];
  /** Absolute or root-relative screenshot. */
  screenshot?: string;
}

/**
 * WebApplication (a SoftwareApplication subtype) with Offers that mirror the
 * pricing page. No rating. No plans (OPENSHIPKIT_PROFILE=site passes none) → no
 * `offers` at all, never an empty list.
 */
export function softwareApplicationJsonLd(input: SoftwareApplicationInput): JsonLdObject {
  const plans = input.plans ?? [];
  // A free plan has no price row, so it borrows the currency the paid plans use.
  const currency = (plans.flatMap((p) => p.prices)[0]?.currency ?? "usd").toUpperCase();
  const offers: Record<string, unknown>[] = plans
    .filter((p) => p.active && !p.contactSales)
    .flatMap((plan): Record<string, unknown>[] =>
      plan.prices.length === 0
        ? [{ "@type": "Offer", name: plan.name, price: 0, priceCurrency: currency, url: absoluteUrl(input.base, "/pricing") }]
        : plan.prices.map((price) =>
            compact({
              "@type": "Offer",
              name: price.interval === "one_time" ? plan.name : `${plan.name} (${price.interval === "month" ? "monthly" : "yearly"})`,
              price: offerPrice(price.amountCents, price.currency),
              priceCurrency: price.currency.toUpperCase(),
              url: absoluteUrl(input.base, "/pricing"),
              priceSpecification:
                price.interval === "one_time"
                  ? undefined
                  : {
                      "@type": "UnitPriceSpecification",
                      price: offerPrice(price.amountCents, price.currency),
                      priceCurrency: price.currency.toUpperCase(),
                      billingDuration: 1,
                      billingIncrement: 1,
                      unitCode: price.interval === "month" ? "MON" : "ANN",
                    },
            }),
          ),
    );
  return compact({
    "@context": CONTEXT,
    "@type": "WebApplication",
    "@id": jsonLdIds.software(input.base),
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.base, "/"),
    applicationCategory: input.applicationCategory ?? "BusinessApplication",
    operatingSystem: input.operatingSystem ?? "Any (web browser)",
    screenshot: input.screenshot ? absoluteUrl(input.base, input.screenshot) : undefined,
    offers: offers.length === 1 ? offers[0] : offers,
    publisher: { "@id": jsonLdIds.organization(input.base) },
  });
}

export interface ArticleInput {
  base: string;
  path: string;
  headline: string;
  description?: string;
  /** Absolute or root-relative; several aspect ratios are best. */
  images?: string[];
  datePublished?: string | null;
  dateModified?: string | null;
  /** A real person's name. Without one the Organization is the author — never invent a persona. */
  authorName?: string | null;
  authorUrl?: string;
  tags?: string[];
  wordCount?: number;
  publisherName: string;
  publisherLogo?: string;
  /** BlogPosting for posts; Article for changelog entries and pages. */
  type?: "BlogPosting" | "Article" | "TechArticle";
}

export function articleJsonLd(input: ArticleInput): JsonLdObject {
  const url = absoluteUrl(input.base, input.path);
  const author = input.authorName
    ? compact({
        "@type": "Person",
        "@id": jsonLdIds.person(input.base, input.authorName),
        name: input.authorName,
        url: input.authorUrl ? absoluteUrl(input.base, input.authorUrl) : undefined,
      })
    : { "@type": "Organization", "@id": jsonLdIds.organization(input.base), name: input.publisherName, url: absoluteUrl(input.base, "/") };
  return compact({
    "@context": CONTEXT,
    "@type": input.type ?? "BlogPosting",
    headline: input.headline.slice(0, 110),
    description: input.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: (input.images ?? []).map((i) => absoluteUrl(input.base, i)),
    datePublished: input.datePublished ?? undefined,
    dateModified: input.dateModified ?? input.datePublished ?? undefined,
    author,
    publisher: compact({
      "@type": "Organization",
      "@id": jsonLdIds.organization(input.base),
      name: input.publisherName,
      logo: input.publisherLogo ? { "@type": "ImageObject", url: absoluteUrl(input.base, input.publisherLogo) } : undefined,
    }),
    keywords: input.tags?.length ? input.tags.join(", ") : undefined,
    wordCount: input.wordCount,
    isPartOf: { "@id": jsonLdIds.website(input.base) },
  });
}

export interface Crumb {
  name: string;
  /** Root-relative or absolute. */
  path: string;
}

export function breadcrumbJsonLd(base: string, crumbs: Crumb[]): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(base, c.path),
    })),
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

/** FAQPage for questions and answers shown on the page. No Google rich result since May 2026; harmless and descriptive. */
export function faqPageJsonLd(items: FaqItem[]): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export interface CollectionPageInput {
  base: string;
  path: string;
  name: string;
  description?: string;
  /** The items listed on this page, in order. */
  items: { name: string; path: string; datePublished?: string | null }[];
}

/** CollectionPage with an ItemList of what the page lists (the blog index, a tag page, the changelog). */
export function collectionPageJsonLd(input: CollectionPageInput): JsonLdObject {
  const url = absoluteUrl(input.base, input.path);
  return compact({
    "@context": CONTEXT,
    "@type": "CollectionPage",
    "@id": url,
    url,
    name: input.name,
    description: input.description,
    isPartOf: { "@id": jsonLdIds.website(input.base) },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: input.items.length,
      itemListElement: input.items.map((item, i) =>
        compact({
          "@type": "ListItem",
          position: i + 1,
          url: absoluteUrl(input.base, item.path),
          name: item.name,
        }),
      ),
    },
  });
}

/**
 * Serialise for a <script type="application/ld+json">. Escapes `<` (so no
 * "</script>" can close the tag), `>` and `&`, and the JS line separators.
 */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
