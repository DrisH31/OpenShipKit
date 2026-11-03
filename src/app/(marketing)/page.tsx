//
// The landing page. Sections in the order of the visitor's questions
// (DESIGN.md, layer 2): is this about me → is the foundation sound → will it
// lock me in → what do I get → is the agent real → what does it ask of me →
// where can it run → can my agent do all that for me → (proof, when there is
// some) → is it worth it → last fears → is anyone home (the newest posts) →
// what now.
//
// When the database is down this page fails as a whole (SPEC invariant 3):
// every section's content read throws, so the visitor gets the error page
// (500, noindex), never the default copy with a 200 — on a renamed site that
// copy is OpenShipKit's, not yours. Defaults show only for a section nothing
// was ever saved to. The one part that degrades instead is the latest-posts
// band: if just its posts read fails, it hides itself (logged) and the rest
// renders (src/components/sections/latest-posts.tsx says why that is safe).
//
// Every section reads its own content key and hides itself when disabled. The
// four OpenShipKit showcase sections (what runs where, the agent, deploy, AI
// setup) and the hero's clone command tell
// OpenShipKit's own story, so they render only while the site is still named
// OpenShipKit; rename the site and they step aside for your product's sections.
//
// Structured data follows the same switch: the showcase describes OpenShipKit
// itself (a free, MIT-licensed developer tool and its source code); a renamed
// site describes its own product, with Offers from its plans.
//
// Under OPENSHIPKIT_PROFILE=site (a landing page + blog, no SaaS) there is no
// pricing section and no Offer in either form of the structured data: the page
// offers nothing for sale, so its markup says nothing about prices.
//

import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { SoftwareJsonLd } from "@/components/seo/site-json-ld";
import { Agent } from "@/components/sections/agent";
import { AiSetup } from "@/components/sections/ai-setup";
import { CloneCommand } from "@/components/sections/clone-command";
import { Cta } from "@/components/sections/cta";
import { Deploy } from "@/components/sections/deploy";
import { Faq } from "@/components/sections/faq";
import { Features } from "@/components/sections/features";
import { Hero } from "@/components/sections/hero";
import { LatestPosts } from "@/components/sections/latest-posts";
import { Logos } from "@/components/sections/logos";
import { OwnStack } from "@/components/sections/own-stack";
import { Pricing } from "@/components/sections/pricing";
import { Stats } from "@/components/sections/stats";
import { Steps } from "@/components/sections/steps";
import { Testimonials } from "@/components/sections/testimonials";
import { siteProfile } from "@/server/env";
import { getContent } from "@/server/services/content";
import { getSiteSeo } from "@/components/seo/site-seo";
import { jsonLdIds, type JsonLdObject } from "@/shared/jsonld";
import { OPENSHIPKIT_REPO } from "@/shared/project";
import { absoluteUrl, isShowcase, pageMetadata } from "@/shared/seo";

const MIT = "https://opensource.org/licenses/MIT";

/** OpenShipKit itself, while this is its showcase: what the page says — free, MIT licensed, runs anywhere, source on GitHub. */
async function ShowcaseJsonLd({ offers }: { offers: boolean }) {
  const { base, site, name } = await getSiteSeo();
  const software: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": jsonLdIds.software(base),
    name,
    description: site.description,
    url: absoluteUrl(base, "/"),
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    isAccessibleForFree: true,
    license: MIT,
    ...(offers ? { offers: { "@type": "Offer", price: 0, priceCurrency: "USD" } } : {}),
    publisher: { "@id": jsonLdIds.organization(base) },
  };
  const code: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    "@id": `${absoluteUrl(base, "/")}#source`,
    name: `${name} source code`,
    codeRepository: OPENSHIPKIT_REPO,
    programmingLanguage: "TypeScript",
    runtimePlatform: "Node.js",
    license: MIT,
    targetProduct: { "@id": jsonLdIds.software(base) },
  };
  return <JsonLd data={[software, code]} />;
}

export async function generateMetadata(): Promise<Metadata> {
  const { site, name, locale, twitterSite, ogImage, cardAlt } = await getSiteSeo();
  return pageMetadata({
    title: site.tagline ? `${name} — ${site.tagline}` : name,
    absoluteTitle: true,
    description: site.description,
    path: "/",
    // The admin's site image (a safe URL only), else the generated card, described by cardAlt.
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
    siteName: name,
    locale,
    twitterSite,
  });
}

export default async function HomePage() {
  const site = await getContent("site");
  // The template's own landing page, until the site is renamed (see the header comment).
  const showcase = isShowcase(site);
  const saas = siteProfile() === "saas";

  return (
    <>
      {/* Plans are offered as the product's own once the site is renamed; until then they're samples. */}
      {showcase ? <ShowcaseJsonLd offers={saas} /> : <SoftwareJsonLd />}
      <Hero note={showcase ? <CloneCommand /> : undefined} />
      <Logos />
      {showcase && <OwnStack />}
      <Features />
      {showcase && <Agent />}
      <Steps />
      {showcase && <Deploy />}
      {showcase && <AiSetup />}
      <Stats />
      <Testimonials />
      {saas && <Pricing />}
      <Faq
        aside={
          showcase ? (
            <p>
              Not answered here? <Link href="/docs">The docs</Link> cover setup, every variable and each host, or{" "}
              <a href={`${OPENSHIPKIT_REPO}/issues`} target="_blank" rel="noopener noreferrer">
                ask on GitHub
              </a>
              .
            </p>
          ) : undefined
        }
      />
      <LatestPosts />
      <Cta note={showcase ? <CloneCommand /> : undefined} />
    </>
  );
}
