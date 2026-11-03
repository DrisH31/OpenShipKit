//
// Newer / Older links for cursor-paginated lists. Real <a rel="prev|next">
// links in the HTML, so crawlers can walk every page with JS off. Server
// component; the caller builds the hrefs and the newer label (see paginate in
// ./data). A "Newest" link jumps to the first page, so it isn't rel="prev".
//

import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export interface PagerProps {
  newerHref: string | null;
  olderHref: string | null;
  /** "Newer" (the page just before) or "Newest" (the first page). */
  newerLabel?: "Newer" | "Newest";
  label?: string;
}

export function Pager({ newerHref, olderHref, newerLabel = "Newer", label = "Pages" }: PagerProps) {
  if (!newerHref && !olderHref) return null;
  return (
    <nav aria-label={label} className="mt-12 flex items-center justify-between gap-4">
      {newerHref ? (
        <Link href={newerHref} rel={newerLabel === "Newer" ? "prev" : undefined} className={buttonVariants({ variant: "outline" })}>
          <ArrowLeftIcon aria-hidden data-icon="inline-start" />
          {newerLabel}
        </Link>
      ) : (
        <span />
      )}
      {olderHref ? (
        <Link href={olderHref} rel="next" className={buttonVariants({ variant: "outline" })}>
          Older
          <ArrowRightIcon aria-hidden data-icon="inline-end" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
