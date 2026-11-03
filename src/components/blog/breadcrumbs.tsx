//
// The visible breadcrumb trail that the BreadcrumbList JSON-LD describes —
// the markup must match what people see. The last crumb is the current page
// (aria-current, not a link). One line at every width: the trail never wraps
// (a wrapped line would start with a lone chevron); the current page's name
// truncates instead — the H1 below says it in full. Server component.
//

import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import type { Crumb } from "@/shared/jsonld";
import { cn } from "@/lib/utils";

export function Breadcrumbs({ crumbs, className }: { crumbs: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-small text-ink-3", className)}>
      <ol className="flex flex-nowrap items-center gap-1.5">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={crumb.path} className={cn("flex items-center gap-1.5", last ? "min-w-0 flex-1" : "shrink-0")}>
              {i > 0 && <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-ink-faint" />}
              {last ? (
                <span aria-current="page" className="min-w-0 truncate text-ink-2">
                  {crumb.name}
                </span>
              ) : (
                <Link href={crumb.path} className="rounded-sm hover:text-ink pointer-coarse:py-3">
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
