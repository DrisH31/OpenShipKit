//
// Tags as plain links to /blog/tag/<tag>. Pills that grow to 44 px on touch.
// `current` marks the active filter with aria-current (not colour alone) and
// the same raised white segment the admin's FilterTabs use for a selected
// option (surface + shadow-control), so a selected filter never reads as a
// primary button; the accent fill stays with the signature controls (the price
// interval, the deploy picker). The pill shows a readable label ("Getting
// started"); the slug stays in the URL. The count is ink-2, not ink-3: ink-3
// on the tonal pill is under 4.5:1 (4.0:1 light, 3.7:1 on hover). Server component.
//

import Link from "next/link";
import { cn } from "@/lib/utils";
import { tagHref, tagLabel } from "./format";

const pill =
  "inline-flex h-7 items-center rounded-full px-3 text-caption font-semibold transition-colors pointer-coarse:h-11 pointer-coarse:px-4";

export function TagLinks({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag}>
          <Link href={tagHref(tag)} className={cn(pill, "bg-tonal text-ink-2 hover:bg-tonal-hover hover:text-ink")}>
            {tagLabel(tag)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The filter row on /blog and tag pages: "All" plus every tag with its count. */
export function TagFilter({ tags, current }: { tags: { tag: string; count: number }[]; current: string | null }) {
  if (tags.length === 0) return null;
  const items = [{ label: "All", href: "/blog", active: current === null, count: null as number | null }].concat(
    tags.map((t) => ({ label: tagLabel(t.tag), href: tagHref(t.tag), active: current === t.tag, count: t.count })),
  );
  return (
    <nav aria-label="Filter by tag">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                pill,
                item.active ? "bg-surface text-ink shadow-control" : "bg-tonal text-ink-2 hover:bg-tonal-hover hover:text-ink",
              )}
            >
              {item.label}
              {item.count !== null && (
                <span className="ml-1.5 font-normal text-ink-2 tabular">
                  <span className="sr-only">(</span>
                  {item.count}
                  <span className="sr-only"> posts)</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
