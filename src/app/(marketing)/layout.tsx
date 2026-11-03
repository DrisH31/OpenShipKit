//
// The public site's frame: site JSON-LD → skip link → announcement → header →
// <main> → footer.
// Every marketing route (/, /pricing, /contact, /blog, /changelog, /legal/…)
// renders inside it. <main id="main"> is the skip link's target and takes focus
// without showing a ring (tabIndex -1).
//

import { SiteJsonLd } from "@/components/seo/site-json-ld";
import { AnnouncementBar } from "@/components/site/announcement-bar";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SkipLink } from "@/components/ui/skip-link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Organization + WebSite, once per page: every BlogPosting/WebPage node references these @ids. */}
      <SiteJsonLd />
      <SkipLink />
      <AnnouncementBar />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
