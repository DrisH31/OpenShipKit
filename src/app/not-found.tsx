//
// The 404 page, for every route (and for notFound() calls, e.g. /admin for
// non-admins). It renders inside the root layout only, so it draws the site's
// own header and footer itself. Answers "where was I going?" with the main
// ways back. Never indexed. Under OPENSHIPKIT_PROFILE=site the ways leave out
// Pricing (itself a 404 there): forProfile, src/core/profile.ts.
//

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/marketing/layout";
import { Display, Eyebrow, Lead } from "@/components/marketing/type";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { forProfile } from "@/core/profile";
import { cn } from "@/lib/utils";
import { siteProfile } from "@/server/env";
import { SkipLink } from "@/components/ui/skip-link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

const WAYS = [
  { href: "/pricing", label: "Pricing", text: "Plans and what’s in each" },
  { href: "/blog", label: "Blog", text: "Guides and announcements" },
  { href: "/changelog", label: "Changelog", text: "What changed, and when" },
  { href: "/contact", label: "Contact", text: "Ask a person" },
];

export default function NotFound() {
  const ways = forProfile(siteProfile(), WAYS);
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="pt-12 outline-none pb-section sm:pt-16 lg:pt-24">
        <Container>
          <div className="flex max-w-3xl flex-col">
            <Eyebrow className="mb-6">404</Eyebrow>
            <Display data-rank="1">This page isn’t here</Display>
            <Lead className="mt-8">
              The link may be old, or the page may have moved. Everything else is where you left it.
            </Lead>
            <div className="mt-10">
              <Link href="/" data-rank="2" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
                Back to the home page
              </Link>
            </div>
          </div>
          <ul className={cn("mt-16 grid gap-x-8 gap-y-2 border-t border-line-strong pt-6 sm:grid-cols-2", ways.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
            {ways.map((w) => (
              <li key={w.href}>
                <Link
                  href={w.href}
                  className="group flex min-h-16 flex-col justify-center rounded-md py-2 focus-visible:outline-offset-4"
                >
                  <span className="inline-flex items-center gap-1.5 text-small font-semibold text-ink">
                    {w.label}
                    <ArrowRightIcon aria-hidden className="size-3.5 text-ink-faint transition-[translate,color] duration-(--dur-hover) group-hover:translate-x-0.5 group-hover:text-ink" />
                  </span>
                  <span className="text-small text-ink-3">{w.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
