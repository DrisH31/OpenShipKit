//
// The frame of every /docs page, in three columns on wide screens: the
// sidebar (nav.json's groups, the page marked), the article, and "On this
// page" from its h2/h3. The frame is as wide as the site header (88rem), so the
// sidebar lines up under the logo and the TOC under the header's actions.
//   ≥ 1280 px  sidebar · article · TOC
//   ≥ 1024 px  sidebar · article, the TOC a closed card above the body
//   < 1024 px  the nav and the TOC are closed cards above the page
// Server component: every link works with JavaScript off. The reader's
// question here is "how do I do this, exactly?", so nothing moves (DESIGN.md:
// high-intent pages get no motion).
//

import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, SquarePenIcon } from "lucide-react";
import { Breadcrumbs } from "@/components/blog/breadcrumbs";
import { Toc, TocDisclosure } from "@/components/blog/toc";
import type { DocEntry, DocsNavGroup } from "@/server/docs";
import { docsPath } from "@/server/docs";
import type { TocItem } from "@/server/markdown";
import type { Crumb } from "@/shared/jsonld";
import { DocsMenu, DocsSidebar } from "./docs-nav";

export function DocsShell({
  nav,
  current,
  title,
  lead,
  crumbs,
  toc = [],
  prev,
  next,
  editHref,
  children,
}: {
  nav: DocsNavGroup[];
  /** The page's slug ("" for the index), marked in the nav. */
  current: string;
  title: string;
  lead?: string;
  crumbs: Crumb[];
  toc?: TocItem[];
  prev?: DocEntry | null;
  next?: DocEntry | null;
  editHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[88rem] px-gutter pt-8 pb-section md:pt-12">
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-x-12 xl:grid-cols-[15rem_minmax(0,1fr)_13rem] xl:gap-x-16">
        <aside className="hidden lg:block">
          <DocsSidebar groups={nav} current={current} />
        </aside>

        <div className="min-w-0">
          <DocsMenu groups={nav} current={current} currentTitle={current ? title : "Overview"} className="mb-8 lg:hidden" />
          <Breadcrumbs crumbs={crumbs} className="mb-8" />

          <article>
            <header className="flex max-w-3xl flex-col gap-5">
              <h1 data-rank="1" className="font-display text-h2 font-bold text-ink">
                {title}
              </h1>
              {lead && <p className="max-w-measure text-lead text-pretty text-ink-2">{lead}</p>}
            </header>

            <TocDisclosure items={toc} className="mt-8 xl:hidden" />

            <div className="mt-10">{children}</div>

            {editHref && (
              <p className="mt-14 border-t border-line pt-6 text-small">
                <a
                  href={editHref}
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-sm text-ink-2 underline decoration-ink-faint underline-offset-4 hover:text-ink hover:decoration-ink pointer-coarse:min-h-11"
                >
                  <SquarePenIcon aria-hidden className="size-4" />
                  Edit this page on GitHub
                </a>
              </p>
            )}
          </article>

          {(prev || next) && (
            <nav aria-label="Previous and next page" className="mt-10 grid gap-4 sm:grid-cols-2">
              {prev ? <PagerLink entry={prev} direction="prev" /> : <span aria-hidden className="hidden sm:block" />}
              {next && <PagerLink entry={next} direction="next" />}
            </nav>
          )}
        </div>

        <aside className="hidden xl:block">
          {/* A long page's TOC scrolls inside itself rather than running past the window. */}
          <Toc
            items={toc}
            className="sticky top-[calc(var(--sticky-header)+2rem)] max-h-[calc(100dvh-var(--sticky-header)-3rem)] overflow-y-auto overscroll-contain pb-8"
          />
        </aside>
      </div>
    </div>
  );
}

function PagerLink({ entry, direction }: { entry: DocEntry; direction: "prev" | "next" }) {
  const isNext = direction === "next";
  return (
    <Link
      href={docsPath(entry.slug)}
      rel={direction}
      className={`group flex flex-col gap-1 rounded-xl border border-line bg-surface px-5 py-4 transition-colors duration-(--dur-hover) hover:border-line-strong ${isNext ? "items-end text-right sm:col-start-2" : ""}`}
    >
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-ink-3">
        {!isNext && <ArrowLeftIcon aria-hidden className="size-3.5" />}
        {isNext ? "Next" : "Previous"}
        {isNext && <ArrowRightIcon aria-hidden className="size-3.5" />}
      </span>
      <span className="font-semibold text-ink group-hover:underline group-hover:decoration-ink-faint group-hover:underline-offset-4">{entry.title}</span>
    </Link>
  );
}
