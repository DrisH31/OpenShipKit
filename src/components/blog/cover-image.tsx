//
// A post's cover image through next/image. It's usually the LCP element, so
// it loads eagerly with high fetch priority (Next 16: `preload`/`priority` are
// not needed for that). Root-relative images are optimised; an absolute URL
// is served as-is (`unoptimized`), because the optimiser only fetches hosts
// listed in next.config.ts → images.remotePatterns — add yours there to have
// them optimised too. Server component.
//

import Image from "next/image";
import { cn } from "@/lib/utils";
import { safeImageUrl } from "./format";

export function CoverImage({ src: raw, alt, className }: { src: string; alt: string; className?: string }) {
  // Anything that isn't a path or an http(s) URL (javascript:, data:, junk) renders nothing.
  const src = safeImageUrl(raw);
  if (!src) return null;
  const local = src.startsWith("/");
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-line bg-surface", className)}>
      <Image
        src={src}
        alt={alt}
        width={1600}
        height={900}
        sizes="(min-width: 72rem) 72rem, 100vw"
        loading="eager"
        fetchPriority="high"
        unoptimized={!local}
        className="aspect-[16/9] h-auto w-full object-cover"
      />
    </figure>
  );
}
