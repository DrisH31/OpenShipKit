"use client";

//
// <LinkPending> — a small spinner inside a <Link> while the navigation that
// link started is in flight (useLinkStatus). For links into pages that can't
// have a loading.tsx above them: a loading boundary would stream a 200 before
// the page can call notFound() (src/app/admin/layout.tsx), so without this the
// old page would sit frozen with no sign the click landed.
//
// It fades in after a short delay, so a fast navigation shows nothing. Under
// reduced motion it appears without spinning. Decorative (aria-hidden): the
// link keeps its accessible name.
//

import { useLinkStatus } from "next/link";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2Icon
      aria-hidden
      data-slot="link-pending"
      className={cn(
        "inline size-3.5 shrink-0 animate-spin text-ink-3 transition-opacity delay-150 duration-200 starting:opacity-0 motion-reduce:animate-none",
        className,
      )}
    />
  );
}
