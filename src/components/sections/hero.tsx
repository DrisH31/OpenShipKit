import "server-only";

//
// The landing page's first screen (content key "hero"), centred, on the stage (the
// design system's fine grid under a pool of light, fading out at the edges — theme.css):
// the eyebrow (bare caps after the brand's dot, no pill: the grid is the frame now), the claim (the page's one H1, rank 1),
// the lead, up to three highlights with checks, one solid primary action
// (rank 2) and an outline second, the proof note — then the product, full width
// beneath. Centred because the page has one message and one action at this
// point: the eye runs straight down claim → action → product. When `hero.image` is set, that screenshot is the
// product (a static image, as before); otherwise the built-in admin preview is: the real admin's screens with
// sample data, working (tabs, the hero editor, Undo), and "Watch an agent edit" played only on a press
// (hero-preview.tsx). Its overview is server-rendered, so the first frame and its words are in the HTML.
//
// One GitHub action, one look: when the primary links to github.com it carries the GitHub mark before
// its label, as the header's action does, and drops the arrow (isGitHubUrl, src/lib/github.ts).
//
// The screenshot's box is reserved before it loads (a 16:10 frame, the image
// covering it from the top), so the largest element never shifts the page.
// The preview's address bar shows this site's host (NEXT_PUBLIC_SITE_URL), or
// "your-domain.com" on a production build that hasn't set it.
//
// The words are never hidden or delayed: `.arrive` settles them from 85 %
// opacity, readable from the first frame (motion.css).
//
// A claim with a comma breaks after it ("Your SaaS, / on your
// server"): the two halves are the two ideas, and balance alone splits them
// mid-phrase. Short halves (under 8 characters) aren't split. The first half is
// set a step quieter (ink-3, still 4.5:1 and more at this size), so the eye
// lands on the second, which is the promise ("on your server").
//
// The highlights are the reader's worries answered in three words each ("No
// vendor lock-in"): pulled out of the lead so it reads in two lines and the
// answers can be scanned. Neutral checks, not green: status colour means a
// state, and these are claims.
//

import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/marketing/layout";
import { Display, Lead } from "@/components/marketing/type";
import { isGitHubUrl } from "@/lib/github";
import { isLocalUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";
import { isDocsHref } from "@/components/site/docs-links";
import { docsOn } from "@/server/docs";
import { publicDocs, siteUrl } from "@/server/env";
import { isShowcase } from "@/shared/seo";
import { getContent } from "@/server/services/content";
import { HeroPreview } from "./hero-preview";
import { ToolMarkIcon } from "./tool-mark-icon";

/** The claim, with a line break after its first comma when both halves are long enough to stand. */
function Claim({ text }: { text: string }) {
  const at = text.indexOf(", ");
  if (at < 8 || text.length - at - 2 < 8) return <>{text}</>;
  return (
    <>
      <span className="block text-ink-3">{text.slice(0, at + 1)}</span> {text.slice(at + 2)}
    </>
  );
}

/** "example.com/admin" for the preview's address bar; never a dev address on a deployed site. */
function adminAddress(): string {
  const url = siteUrl();
  // isLocalUrl is the one host list (src/lib/site-url.ts), shared with the setup checklist and the boot check.
  if (isLocalUrl(url) && process.env.NODE_ENV === "production") return "your-domain.com/admin";
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = "your-domain.com";
  }
  return `${host}/admin`;
}

export async function Hero({ note }: { note?: React.ReactNode }) {
  const [hero, site] = await Promise.all([getContent("hero"), getContent("site")]);
  // The default second action is "Read the docs": dropped where /docs isn't published (a renamed site).
  const secondary = hero.secondaryCta && isDocsHref(hero.secondaryCta.href) && !docsOn(isShowcase(site), publicDocs()) ? null : hero.secondaryCta;
  const primaryIsGitHub = isGitHubUrl(hero.primaryCta.href);

  return (
    <section aria-labelledby="hero-title" className="stage pt-12 pb-16 sm:pt-16 sm:pb-20 lg:pt-20">
      <Container>
        <div className="mx-auto flex max-w-[56rem] flex-col items-center text-center">
          {hero.eyebrow && (
            <p className="arrive mb-7 inline-flex items-center gap-2.5 font-sans text-eyebrow font-semibold text-ink-2 uppercase">
              {/* The mark's gradient, as a dot: the one touch of brand colour above the claim. */}
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-[linear-gradient(135deg,var(--brand-mark-from),var(--brand-mark-to))]" />
              {hero.eyebrow}
            </p>
          )}
          <Display id="hero-title" data-rank="1" className="arrive max-w-[18ch] text-balance">
            <Claim text={hero.title} />
          </Display>
          {hero.subtitle && <Lead className="arrive mt-7 max-w-[52ch] text-pretty">{hero.subtitle}</Lead>}
          {hero.highlights.length > 0 && (
            <ul className="arrive mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-body text-ink-2">
              {hero.highlights.map((point) => (
                <li key={point} className="inline-flex items-center gap-2">
                  <CheckIcon aria-hidden strokeWidth={2.5} className="size-4 shrink-0 text-ink-3" />
                  {point}
                </li>
              ))}
            </ul>
          )}
          {/* auto-width on a phone too: a full-width solid bar would outweigh the claim (squint test) */}
          <div className="arrive mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={hero.primaryCta.href}
              data-rank="2"
              className={cn(buttonVariants({ size: "lg" }), "group")}
            >
              {/* one GitHub action, one look: a GitHub link carries the mark first (as the header's), no arrow */}
              {primaryIsGitHub && <ToolMarkIcon name="GitHub" data-icon="inline-start" className="size-[1.125rem]" />}
              {hero.primaryCta.label}
              {!primaryIsGitHub && (
                <ArrowRightIcon
                  aria-hidden
                  data-icon="inline-end"
                  className="transition-transform duration-(--dur-hover) ease-out-quart group-hover:translate-x-0.5"
                />
              )}
            </Link>
            {secondary && (
              <Link href={secondary.href} className={buttonVariants({ variant: "outline", size: "lg" })}>
                {secondary.label}
              </Link>
            )}
          </div>
          {/* A div: the showcase's note holds the copyable clone command as well as a sentence. */}
          {note && <div className="arrive mt-6 flex max-w-full flex-col items-center gap-3 text-small text-balance text-ink-3">{note}</div>}
        </div>

        {/* The product sits on a faint warm glow in the mark's colours (the "ignition" of the brand), drawn
            behind it, so the frame reads as lit rather than pasted on. Graphics only, no motion. */}
        <div
          className="arrive relative isolate mt-12 before:absolute before:inset-x-[8%] before:-top-10 before:-z-10 before:h-[70%] before:rounded-[50%] before:bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-mark-to)_16%,transparent),transparent)] before:blur-2xl before:content-[''] sm:mt-14"
          style={{ animationDelay: "280ms" }}
        >
          {hero.image ? (
            <div data-mockup className="aspect-[16/10] overflow-hidden rounded-xl border border-line-strong bg-raised shadow-mockup">
              {/* An admin-supplied URL, possibly on a host next/image isn't configured for, so a plain img:
                  eager and high priority because it is the page's largest element. Its 16:10 box is
                  reserved before it loads (no layout shift); a screenshot of another shape is cropped from the top. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hero.image}
                alt={hero.imageAlt || `${site.name}, in use`}
                width={1600}
                height={1000}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="block size-full object-cover object-top"
              />
            </div>
          ) : (
            <HeroPreview siteName={site.name} url={adminAddress()} title={hero.title} eyebrow={hero.eyebrow} />
          )}
        </div>
      </Container>
    </section>
  );
}
