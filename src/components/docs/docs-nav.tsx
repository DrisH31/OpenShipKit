//
// The docs sidebar: nav.json's groups, the current page marked (aria-current
// and a tonal pill, as the site header marks its page). Plain links, so it
// works with JavaScript off. Two shapes of the same list, as the TOC has
// (src/components/blog/toc.tsx): the open, sticky column from lg, and a closed
// native <details> card above the page below it, so a phone opens on the
// page's words, not a screen of links. Server components.
//
// No filter box: about twenty pages in a handful of named groups are scanned
// faster than typed, and a filter would be the page's only client island.
//

import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import type { DocsNavGroup } from "@/server/docs";
import { docsPath } from "@/server/docs";
import { cn } from "@/lib/utils";

function NavList({ groups, current, idPrefix }: { groups: DocsNavGroup[]; current: string; idPrefix: string }) {
  return (
    <div className="flex flex-col gap-7">
      <Link
        href="/docs"
        aria-current={current === "" ? "page" : undefined}
        className={cn(
          "-mx-3 rounded-md px-3 py-1.5 text-small font-semibold transition-colors duration-(--dur-hover) pointer-coarse:py-3",
          current === "" ? "bg-tonal text-ink" : "text-ink-2 hover:bg-tonal hover:text-ink",
        )}
      >
        Overview
      </Link>
      {groups.map((group, i) => {
        const id = `${idPrefix}-group-${i}`;
        return (
          <div key={group.group}>
            <p id={id} className="mb-2 text-eyebrow font-semibold text-ink-3 uppercase">
              {group.group}
            </p>
            <ul aria-labelledby={id} className="flex flex-col">
              {group.items.map((item) => {
                const here = item.slug === current;
                return (
                  <li key={item.slug}>
                    <Link
                      href={docsPath(item.slug)}
                      aria-current={here ? "page" : undefined}
                      className={cn(
                        "-mx-3 block rounded-md px-3 py-1.5 text-small transition-colors duration-(--dur-hover) pointer-coarse:py-3",
                        here ? "bg-tonal font-semibold text-ink" : "text-ink-2 hover:bg-tonal hover:text-ink",
                      )}
                    >
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** The open sidebar, for wide screens: sticky under the header, scrolling on its own when taller than the window. */
export function DocsSidebar({ groups, current, className }: { groups: DocsNavGroup[]; current: string; className?: string }) {
  return (
    <nav
      aria-label="Docs"
      className={cn(
        "sticky top-[calc(var(--sticky-header)+2rem)] max-h-[calc(100dvh-var(--sticky-header)-3rem)] overflow-y-auto overscroll-contain pr-2 pb-8",
        className,
      )}
    >
      <NavList groups={groups} current={current} idPrefix="docs-side" />
    </nav>
  );
}

/** The closed card, for narrow screens: "Docs · Deployment". */
export function DocsMenu({
  groups,
  current,
  currentTitle,
  className,
}: {
  groups: DocsNavGroup[];
  current: string;
  currentTitle: string;
  className?: string;
}) {
  return (
    // On the page tone, not a white card: it is chrome, and on a phone it sits above the H1,
    // which must stay the heaviest thing on the screen (the squint test).
    <details className={cn("group rounded-xl border border-line-strong open:bg-surface", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-3 text-small [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">
          <span className="text-eyebrow font-semibold text-ink-3 uppercase">Docs</span>
          <span className="text-ink-2">
            {" · "}
            {currentTitle}
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-ink-faint transition-[rotate,color] duration-(--dur-ui) ease-out-quart group-open:rotate-90 group-hover:text-ink"
        />
      </summary>
      <div className="disclosure-panel">
        <div>
          <nav aria-label="Docs" className="px-5 pt-1 pb-5">
            <NavList groups={groups} current={current} idPrefix="docs-menu" />
          </nav>
        </div>
      </div>
    </details>
  );
}
