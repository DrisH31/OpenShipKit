import "server-only";

//
// Site-wide structured data, from the editable `site` content (which falls
// back to defaults, so these never throw for content):
//  - <SiteJsonLd />: Organization + WebSite. Render it ONCE per page, from the
//    marketing layout, so every public page carries the same @id nodes that
//    BlogPosting, CollectionPage and WebPage reference.
//  - <SoftwareJsonLd />: a WebApplication whose Offers mirror the active plans.
//    The home page only. Plan reads throw on a backend failure, like /pricing.
//    Under OPENSHIPKIT_PROFILE=site it has no Offers and reads no plans: nothing is for sale.
// The `software` prop on SiteJsonLd is the older all-in-one form; prefer the
// two components so the layout and the home page don't both emit an Organization.
//

import { siteProfile } from "@/server/env";
import { listPlans } from "@/server/services/plans";
import { organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd, type JsonLdObject } from "@/shared/jsonld";
import { JsonLd } from "./json-ld";
import { getSiteSeo } from "./site-seo";

/** Organization + WebSite for every public page (and, with `software`, the WebApplication too). */
export async function SiteJsonLd({
  software = false,
  applicationCategory = "BusinessApplication",
}: {
  software?: boolean;
  /** One of Google's supported values; set it to what your product is. */
  applicationCategory?: string;
}) {
  const { base, site, name, locale, sameAs } = await getSiteSeo();
  const data: JsonLdObject[] = [
    organizationJsonLd({
      base,
      name,
      legalName: site.legalName || undefined,
      description: site.description,
      // The generated 180×180 mark (src/app/apple-icon.tsx): crawlable, ≥ 112 px, legible on white.
      logo: "/apple-icon",
      email: site.contactEmail || undefined,
      sameAs,
    }),
    websiteJsonLd({ base, name, description: site.description, inLanguage: locale }),
  ];
  if (software) data.push(await softwareData(applicationCategory));
  return <JsonLd data={data} />;
}

async function softwareData(applicationCategory: string): Promise<JsonLdObject> {
  const [{ base, site, name }, plans] = await Promise.all([getSiteSeo(), siteProfile() === "site" ? [] : listPlans({ activeOnly: true })]);
  return softwareApplicationJsonLd({ base, name, description: site.description, plans, applicationCategory });
}

/** WebApplication + Offers for the home page (the product itself). No rating: none is collected here. */
export async function SoftwareJsonLd({
  applicationCategory = "BusinessApplication",
}: {
  /** One of Google's supported values; set it to what your product is. */
  applicationCategory?: string;
}) {
  return <JsonLd data={await softwareData(applicationCategory)} />;
}
