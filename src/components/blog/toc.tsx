//
// "On this page" — the table of contents from renderMarkdown's toc. Plain
// anchor links (no scroll-spy JS), so it works with JavaScript off. Shown
// only when a post has at least two sections (tocItems). Server components.
//
// Two shapes of the same links, because a phone and a wide screen want
// different things: <TocDisclosure> is a closed native <details> card for
// narrow screens, so the first paragraph isn't a full screen of links away;
// <Toc> is the open list that sits sticky beside the text from lg. The page
// renders both and shows one per breakpoint (the hidden one is display:none,
// out of the accessibility tree).
//

import { ChevronRightIcon } from "lucide-react";
import type { TocItem } from "@/server/markdown";
import { cn } from "@/lib/utils";

/** The headings the TOC lists (h2 and h3); [] when there are fewer than two, so no TOC is shown. */
export function tocItems(items: TocItem[]): TocItem[] {
  const shown = items.filter((i) => i.depth <= 3);
  return shown.length >= 2 ? shown : [];
}

function TocList({ items }: { items: TocItem[] }) {
  return (
    <ol className="flex flex-col border-l border-line">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className={cn(
              "-ml-px block border-l border-transparent py-1.5 text-ink-2 transition-colors hover:border-ink hover:text-ink pointer-coarse:py-3",
              item.depth === 2 ? "pl-4" : "pl-8 text-ink-3",
            )}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** The open list, for wide screens. */
export function Toc({ items, className }: { items: TocItem[]; className?: string }) {
  const shown = tocItems(items);
  if (shown.length === 0) return null;
  return (
    <nav aria-labelledby="toc-heading" className={cn("text-small", className)}>
      <p id="toc-heading" className="mb-3 text-eyebrow font-semibold text-ink-3 uppercase">
        On this page
      </p>
      <TocList items={shown} />
    </nav>
  );
}

/** The closed-by-default card, for narrow screens: "On this page · 13 sections". */
export function TocDisclosure({ items, className }: { items: TocItem[]; className?: string }) {
  const shown = tocItems(items);
  if (shown.length === 0) return null;
  const sections = shown.filter((i) => i.depth === 2).length || shown.length;
  return (
    <details className={cn("group rounded-xl border border-line bg-surface text-small", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-eyebrow font-semibold text-ink-3 uppercase">On this page</span>
          <span className="text-ink-3">
            {" · "}
            {sections} {sections === 1 ? "section" : "sections"}
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-ink-faint transition-[rotate,color] duration-(--dur-ui) ease-out-quart group-open:rotate-90 group-hover:text-ink"
        />
      </summary>
      <div className="disclosure-panel">
        <div>
          <nav aria-label="On this page" className="px-5 pb-5">
            <TocList items={shown} />
          </nav>
        </div>
      </div>
    </details>
  );
}

/**
 * The TOC column of a long-form page (posts, legal pages): first in the DOM,
 * as it is first on a phone, where it's the closed card; from lg it moves to
 * the right column (lg:order-last) as the open, sticky list. Nothing when the
 * page has fewer than two sections.
 */
export function ArticleToc({ items }: { items: TocItem[] }) {
  if (tocItems(items).length === 0) return null;
  return (
    <aside className="lg:order-last">
      <TocDisclosure items={items} className="lg:hidden" />
      <Toc items={items} className="hidden lg:sticky lg:top-[calc(var(--sticky-header)+2rem)] lg:block" />
    </aside>
  );
}
