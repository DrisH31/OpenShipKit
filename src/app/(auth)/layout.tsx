//
// The calm frame around every auth screen: the site's logo (linking home), in
// the same 88rem frame and row height as the marketing header so it doesn't
// jump between pages, and one centred card. Auth pages are never indexed.
//
// On the OpenShipKit showcase (isShowcase) a short note is spoken by the mark,
// as a speech bubble: beside the card from 1280 px — where there is room on the
// right — (its tail pointing at the speaker; the card stays centred), above it
// on narrower screens (tail pointing
// down). It says this site runs the template itself — the sign-in is real and
// works, an account here is only for looking around — and that the template a
// visitor clones has the same flow fully working. With the read-only demo admin
// on (DEMO_ADMIN_EMAIL, docs/auth.md) it ends with a small "Try the demo" button —
// the only way in to the demo — which opens the admin without an account. A
// renamed site never shows it.
//

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Logo, LogoMark } from "@/components/site/logo";
import { OPENSHIPKIT_REPO } from "@/shared/project";
import { isShowcase } from "@/shared/seo";
import { TryDemoButton } from "@/components/site/try-demo-button";
import { demoEnabled } from "@/server/demo";
import { getContent } from "@/server/services/content";
import { SkipLink } from "@/components/ui/skip-link";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const site = await getContent("site");
  const showcase = isShowcase(site);
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <SkipLink />
      <header>
        <div className="mx-auto flex h-16 w-full max-w-[88rem] items-center px-gutter md:h-[4.5rem] md:pointer-coarse:h-20">
          <Link
            href="/"
            aria-label={`${site.name} home`}
            className="-mx-1.5 inline-flex min-h-11 items-center rounded-full px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Logo name={site.name} />
          </Link>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-4">
        {/* The card stays centred; on wide screens the showcase note hangs beside it, out of the flow. */}
        <div className="relative flex w-full max-w-[26rem] flex-col gap-5">
          {showcase && <DemoNote demo={demoEnabled()} />}
          <div className="w-full rounded-xl border border-line bg-surface p-6 sm:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

/**
 * The showcase's note, as a speech bubble from the OpenShipKit mark. Server-rendered; no JavaScript.
 * With the read-only demo admin on (`demo`), it offers "Try the demo" (POST /api/demo): one press
 * opens the admin, with no credentials on the page — the demo's password never leaves the server.
 */
function DemoNote({ demo }: { demo: boolean }) {
  return (
    <aside
      aria-label="About this sign-in"
      className="flex items-end gap-3 xl:absolute xl:top-6 xl:left-full xl:ml-8 xl:w-[19rem] xl:items-start"
    >
      <span className="order-last inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface xl:order-first xl:mt-1">
        <LogoMark className="size-5" />
      </span>
      <div
        className={[
          "relative flex-1 rounded-2xl rounded-br-md border border-line-strong bg-surface px-4 py-3.5 text-small text-ink-2 shadow-sm",
          "xl:rounded-br-2xl xl:rounded-tl-md",
          // The tail: a small rotated square on the side facing the speaker.
          "before:absolute before:size-3 before:rotate-45 before:border-line-strong before:bg-surface",
          "before:-right-[7px] before:bottom-3 before:border-t before:border-r",
          "xl:before:top-4 xl:before:right-auto xl:before:bottom-auto xl:before:-left-[7px] xl:before:border-t-0 xl:before:border-r-0 xl:before:border-b xl:before:border-l",
        ].join(" ")}
      >
        <p className="font-semibold text-ink">Psst, this is OpenShipKit’s own demo.</p>
        <p className="mt-1.5 text-pretty">
          The sign-in here is real and works. An account just lets you look around the dashboard: nothing to buy, no
          admin.
        </p>
        <p className="mt-1.5 text-pretty">
          Clone the template and this exact flow is yours, with email verification, password reset, magic links and
          two-factor.
        </p>
        <a
          href={OPENSHIPKIT_REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-2.5 inline-flex min-h-9 items-center gap-1 font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink pointer-coarse:min-h-11"
        >
          Get the code
          <ArrowUpRightIcon aria-hidden className="size-3.5 text-ink-3 transition-colors group-hover:text-ink" />
        </a>
        {/* The one way into the read-only demo admin: a plain POST form, no credentials on the page. */}
        {demo ? <TryDemoButton size="sm" icon formClassName="mt-1.5" className="pointer-coarse:min-h-11" /> : null}
      </div>
    </aside>
  );
}
