import "server-only";

//
// The site header: the mark, the navigation from content ("navigation"), the
// scheme switch and the one header action. Auth-aware: a signed-in visitor sees
// "Dashboard" instead of "Sign in" and the CTA.
//
// Three columns, wider than the content column (88rem against 72rem): the mark
// pinned left, the links centred on the page, the actions pinned right. The two
// outer columns are equal (1fr each), so the links stay centred whatever the
// logo's or the actions' width.
//
// Neutral chrome (COL-6): the page tone, and a hairline only once content
// scrolls under it (.header-edge, motion.css). Sticky from 768 px; on a phone it scrolls
// away, so it never covers a focused field (PAGE-5). The links show inline
// from 1024 px; below that they live in the menu, so the row never overflows
// (logo + five links, the scheme switch and both actions need ~900 px).
//
// Under OPENSHIPKIT_PROFILE=site, links to SaaS-only pages (Pricing) are left
// out as it renders (navigationForProfile); the stored navigation is untouched.
//
// When the header action links to GitHub ("Get the code" → the repository),
// it carries the GitHub mark: one button says both "this is the code" and
// "it's on GitHub", instead of a separate icon button going to the same place.
// No star count: a live fetch would put a third party in every page view.
//
// On the OpenShipKit showcase with OPENSHIPKIT_SUPPORT_URL set, that action is
// "Support the project" (a heart) instead: a Polar pay-what-you-want checkout,
// opened in a new tab so the site stays where the visitor left it. The
// repository stays one click away in the hero, the closing CTA and the footer.
// A renamed site never shows it (src/shared/support.ts).
//

import Link from "next/link";
import { HeartIcon } from "lucide-react";
import { navigationForProfile } from "@/core/profile";
import type { User } from "@/core/types";
import { buttonVariants } from "@/components/ui/button";
import { SchemeSwitch } from "@/components/theme/scheme-switch";
import { ToolMarkIcon } from "@/components/sections/tool-mark-icon";
import { isGitHubUrl } from "@/lib/github";
import { cn } from "@/lib/utils";
import { isShowcase } from "@/shared/seo";
import { SUPPORT_LABEL } from "@/shared/support";
import { getAuth } from "@/server/auth";
import { publicDocs, siteProfile, supportUrl } from "@/server/env";
import { docsOn } from "@/server/docs";
import { getCurrentUser } from "@/server/session";
import { getContent } from "@/server/services/content";
import { withoutDocsLinks } from "./docs-links";
import { Logo } from "./logo";
import { MobileMenu, NavLinks } from "./site-nav";

/** Who is signed in, or null. A failing auth provider must not take the marketing site down with it. */
async function viewer(): Promise<{ user: User | null; signInHref: string }> {
  try {
    const [user, auth] = await Promise.all([getCurrentUser(), getAuth()]);
    return { user, signInHref: auth.urls.signIn };
  } catch (error) {
    console.error("[site-header] auth unavailable; rendering the signed-out header", error);
    return { user: null, signInHref: "/sign-in" };
  }
}

export async function SiteHeader() {
  const [navigation, site, { user, signInHref }] = await Promise.all([
    getContent("navigation").then((nav) => navigationForProfile(siteProfile(), nav)),
    getContent("site"),
    viewer(),
  ]);
  const showcase = isShowcase(site);
  const support = showcase ? supportUrl() : null;
  const cta = user ? { label: "Dashboard", href: "/dashboard" } : support ? { label: SUPPORT_LABEL, href: support } : navigation.headerCta;
  const ctaIsSupport = !user && support !== null;
  const ctaIsGitHub = cta && !ctaIsSupport ? isGitHubUrl(cta.href) : false;
  // The support checkout lives on Polar: a new tab, so the site stays open behind it.
  const ctaTarget = ctaIsSupport ? ({ target: "_blank", rel: "noopener noreferrer" } as const) : {};
  // "Docs" only where /docs is published (a renamed site keeping the default links would 404 there).
  const links = withoutDocsLinks(navigation.header, docsOn(showcase, publicDocs()));

  return (
    <header className="header-edge relative z-(--z-header) bg-bg md:sticky md:top-0">
      <div className="mx-auto grid h-16 w-full max-w-[88rem] grid-cols-[1fr_auto] items-center gap-4 px-gutter md:h-[4.5rem] md:pointer-coarse:h-20 lg:grid-cols-[1fr_auto_1fr]">
        <Link
          href="/"
          aria-label={`${site.name} home`}
          className="-mx-1.5 inline-flex min-h-11 items-center justify-self-start rounded-full px-1.5"
        >
          <Logo name={site.name} />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <NavLinks links={links} />
        </nav>

        <div className="flex items-center justify-self-end gap-1.5 sm:gap-2">
          <SchemeSwitch />
          {!user && (
            <Link
              href={signInHref}
              className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}
            >
              Sign in
            </Link>
          )}
          {/* Rank 2 (DESIGN.md): the site's one action, on every page — on a docs page it is the
              only solid button, and beside a page's own primary (the hero's) it repeats it. */}
          {cta && (
            <Link
              href={cta.href}
              {...ctaTarget}
              data-rank="2"
              className={cn(buttonVariants({ variant: "default" }), "hidden sm:inline-flex")}
            >
              {ctaIsGitHub && <ToolMarkIcon name="GitHub" data-icon="inline-start" className="size-4" />}
              {ctaIsSupport ? (
                <>
                  <HeartIcon aria-hidden data-icon="inline-start" className="size-4" />
                  {/* Short below 1280 px, where the row also holds the links and "Sign in". */}
                  <span className="xl:hidden">Support</span>
                  <span className="hidden xl:inline">{cta.label}</span>
                </>
              ) : (
                cta.label
              )}
            </Link>
          )}
          <MobileMenu links={links}>
            {cta && (
              <Link href={cta.href} {...ctaTarget} className={cn(buttonVariants({ variant: "default", size: "lg" }), "w-full")}>
                {ctaIsGitHub && <ToolMarkIcon name="GitHub" data-icon="inline-start" className="size-4" />}
                {ctaIsSupport && <HeartIcon aria-hidden data-icon="inline-start" className="size-4" />}
                {cta.label}
              </Link>
            )}
            {!user && (
              <Link href={signInHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
                Sign in
              </Link>
            )}
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}
