import "server-only";

//
// The site footer: the mark and one line, the email signup, the link columns
// from content ("navigation".footer), social links (only those that are set and
// make a working link: social-links.ts), the copyright line (legalName, else the
// product name), and the product's name set large as the page's last word.
//
// The same 88rem frame as the header, so the mark sits under the header's mark
// and the link columns reach the right edge the header's action does: the page
// is bracketed by one frame top and bottom.
//
// On the OpenShipKit showcase (isShowcase) the brand block adds the repository
// (a "Star on GitHub" button with the GitHub mark — no live star count: a fetch
// would put a third party in every page view) and, beside it on the same line,
// "Support the project" when OPENSHIPKIT_SUPPORT_URL is set (the header's Polar
// checkout), the line adds "MIT licensed", and
// the bottom row's right end carries the maker's credit — "A project by" and the
// DRISH LABS signature (drish-labs-signature.tsx), the same wordmark-in-a-pill as
// the top-left of drishlabs.com. A renamed site gets "Built with OpenShipKit"
// instead, and never the maker's name.
//
// Social profiles show as their marks (tool-marks.ts) with the network's name as
// the accessible name; a network with no mark (LinkedIn) shows as a text link.
//
// The closing wordmark is decorative (aria-hidden, not selectable): the site's
// own name, sized to the frame's width by its length (container query units), so
// any name fits on one line; faint ink, cut by the page's bottom edge.
//
// It sits outside <main>, so it is the page's contentinfo landmark. The edge
// against the page is line-strong (a hairline on the bare page, COL-10).
// Under OPENSHIPKIT_PROFILE=site the columns leave out SaaS-only links
// (navigationForProfile), as the header does.
//

import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRightIcon, HeartIcon } from "lucide-react";
import { navigationForProfile } from "@/core/profile";
import { buttonVariants } from "@/components/ui/button";
import { ToolMarkIcon } from "@/components/sections/tool-mark-icon";
import { toolMark } from "@/components/sections/tool-marks";
import { cn } from "@/lib/utils";
import { DRISH_LABS_URL, GETSHIPKIT_REPO, OPENSHIPKIT_REPO } from "@/shared/project";
import { isShowcase } from "@/shared/seo";
import { SUPPORT_LABEL } from "@/shared/support";
import { publicDocs, siteProfile, supportUrl } from "@/server/env";
import { docsOn } from "@/server/docs";
import { getContent } from "@/server/services/content";
import { withoutDocsLinks } from "./docs-links";
import { DrishLabsSignature } from "./drish-labs-signature";
import { Logo } from "./logo";
import { NewsletterForm } from "./newsletter-form";
import { SOCIAL_LABELS, type SocialKey, socialHref } from "./social-links";

const inlineLink =
  "underline decoration-ink-faint underline-offset-4 transition-colors duration-(--dur-hover) hover:text-ink-2 hover:decoration-ink-2";

function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

/** The tagline as a sentence: a full stop only when it doesn't already end in one (or ! ? …). */
function asSentence(text: string): string {
  const t = text.trim();
  return /[.!?…]["”’)]?$/.test(t) ? t : `${t}.`;
}

/**
 * The wordmark's size: the frame's width divided by the name's width in ems.
 * Space Grotesk bold at -0.04em tracking averages ~0.5em per character
 * (measured on "OpenShipKit": 1120 px of text at 1344/6.6 px), so
 * `100cqi / (chars × 0.52)` sets any name close to edge to edge on one line,
 * with a little room for wide letters (M, W); the footer clips any excess.
 */
function wordmarkSize(name: string): string {
  const chars = Math.max(name.trim().length, 4);
  return `calc(100cqi / ${(chars * 0.52).toFixed(2)})`;
}

export async function SiteFooter() {
  const [site, navigation] = await Promise.all([getContent("site"), getContent("navigation").then((nav) => navigationForProfile(siteProfile(), nav))]);
  // The OpenShipKit showcase (the site not yet renamed) links its own repository; a renamed site shows only its own profiles.
  const isOpenShipKit = isShowcase(site);
  const support = isOpenShipKit ? supportUrl() : null;
  // Links into /docs only where the docs are published (docs-links.ts); a column left empty is dropped.
  const docs = docsOn(isOpenShipKit, publicDocs());
  const columns = navigation.footer
    .map((col) => ({ ...col, links: withoutDocsLinks(col.links, docs) }))
    .filter((col) => col.links.length > 0);
  // What can't be made into an absolute link (a bare LinkedIn name, a relative path) is left out.
  const socials = (Object.keys(SOCIAL_LABELS) as SocialKey[]).flatMap((key) => {
    // The showcase's repository already has its "Star on GitHub" button above; no second link to the same place.
    const href = socialHref(key, site.social[key]?.trim() ?? "");
    if (isOpenShipKit && href === OPENSHIPKIT_REPO) return [];
    return href ? [{ key, href, label: SOCIAL_LABELS[key], hasMark: toolMark(SOCIAL_LABELS[key]) !== null }] : [];
  });
  const year = new Date().getFullYear();
  const owner = site.legalName || site.name;

  return (
    <footer className="overflow-hidden border-t border-line-strong bg-bg">
      <div className="mx-auto w-full max-w-[88rem] px-gutter pt-14 sm:pt-16">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between lg:gap-16">
          <div className="flex w-full max-w-md flex-col gap-8">
            {/* Who: the mark, one line, and (on the showcase) the repository — one tight group. */}
            <div className="flex flex-col items-start gap-4">
              <Link href="/" aria-label={`${site.name} home`} className="-mx-1.5 inline-flex min-h-11 w-fit items-center rounded-full px-1.5">
                <Logo name={site.name} />
              </Link>
              {site.tagline.trim() && <p className="max-w-[36ch] text-small text-pretty text-ink-2">{asSentence(site.tagline)}</p>}
              {isOpenShipKit && (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={OPENSHIPKIT_REPO}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-coarse:h-11")}
                  >
                    <ToolMarkIcon name="GitHub" className="size-4" />
                    Star on GitHub
                  </a>
                  {/* The other way to help, beside it: the Polar checkout, when one is set (src/shared/support.ts). */}
                  {support && (
                    <a
                      href={support}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-coarse:h-11")}
                    >
                      <HeartIcon aria-hidden className="size-4 text-action-text" />
                      {SUPPORT_LABEL}
                    </a>
                  )}
                </div>
              )}
            </div>
            {/* What you can do here: the signup, as one card. */}
            <Suspense fallback={null}>
              <NewsletterForm />
            </Suspense>
          </div>

          {columns.length > 0 && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:flex lg:gap-x-16 xl:gap-x-24">
              {columns.map((col) => (
                <nav key={col.title} aria-label={col.title} className="min-w-[8.5rem]">
                  <h2 className="font-sans text-eyebrow font-semibold tracking-[0.08em] text-ink-3 uppercase">{col.title}</h2>
                  <ul className="mt-4 flex flex-col gap-1">
                    {col.links.map((l) => (
                      <li key={`${l.href}-${l.label}`}>
                        <Link
                          href={l.href}
                          {...(isExternal(l.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          className="inline-flex min-h-9 items-center text-small text-ink-2 transition-colors duration-(--dur-hover) hover:text-ink pointer-coarse:min-h-11"
                        >
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          )}
        </div>

        {/* The sibling, on the showcase only: for anyone who'd rather not run a server (GetShipKit's footer
            points back here). A renamed site never shows it. */}
        {isOpenShipKit && (
          <a
            href={GETSHIPKIT_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-14 flex flex-col gap-1 rounded-2xl border border-line bg-surface p-5 transition-colors duration-(--dur-hover) hover:border-line-strong sm:flex-row sm:items-center sm:justify-between sm:gap-6"
          >
            <span className="text-small text-ink-2">
              <span className="font-semibold text-ink">Rather not run a server?</span> GetShipKit is the sibling on hosted
              services: Clerk for sign-in, Supabase for data, Polar for payments.
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-small font-semibold text-ink">
              See GetShipKit
              <ArrowUpRightIcon aria-hidden className="size-4 transition-transform duration-(--dur-hover) ease-out-quart group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </a>
        )}
        <div className={cn("flex flex-col gap-4 border-t border-line pt-6 text-small text-ink-3 sm:flex-row sm:items-center sm:justify-between", isOpenShipKit ? "mt-10" : "mt-14")}>
          <p>
            © {year} {owner}
            {!isOpenShipKit && (
              <>
                {" · "}
                <a href={OPENSHIPKIT_REPO} target="_blank" rel="noopener noreferrer" className={cn(inlineLink, "whitespace-nowrap")}>
                  Built with OpenShipKit
                </a>
              </>
            )}
            {isOpenShipKit && " · MIT licensed"}
          </p>
          {/* The maker's credit, on the showcase only: the studio's own signature, as on drishlabs.com. */}
          {isOpenShipKit && (
            <a
              href={DRISH_LABS_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="A DRISH LABS project (drishlabs.com)"
              className="group inline-flex w-fit items-center gap-3 sm:order-last"
            >
              <span className="text-small text-ink-3 transition-colors duration-(--dur-hover) group-hover:text-ink-2">A project by</span>
              <span className="inline-flex h-10 items-center rounded-full px-4 text-ink ring-1 ring-line-strong ring-inset transition-colors duration-(--dur-hover) group-hover:bg-tonal pointer-coarse:h-11">
                <DrishLabsSignature className="h-[1.125rem] w-auto" />
              </span>
            </a>
          )}
          {socials.length > 0 && (
            <ul className="-mx-2 flex flex-wrap items-center gap-1" aria-label="Elsewhere">
              {socials.map((s) => (
                <li key={s.key}>
                  {s.hasMark ? (
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer me"
                      aria-label={s.label}
                      title={s.label}
                      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "text-ink-2 hover:text-ink")}
                    >
                      <ToolMarkIcon name={s.label} className="size-[1.125rem]" />
                    </a>
                  ) : (
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer me"
                      className="group inline-flex min-h-9 items-center gap-1 px-2 text-ink-2 transition-colors duration-(--dur-hover) hover:text-ink pointer-coarse:min-h-11"
                    >
                      {s.label}
                      <ArrowUpRightIcon aria-hidden className="size-3.5 text-ink-faint transition-colors group-hover:text-ink-2" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* The last word: the product's name, edge to edge, cut by the page's bottom. Decorative. */}
      <div aria-hidden className="pointer-events-none mx-auto mt-10 w-full max-w-[88rem] px-gutter select-none [container-type:inline-size]">
        <p
          className="translate-y-[6%] text-center font-display leading-[0.8] font-bold tracking-[-0.04em] whitespace-nowrap text-line-strong"
          style={{ fontSize: wordmarkSize(site.name) }}
        >
          {site.name}
        </p>
      </div>
    </footer>
  );
}
