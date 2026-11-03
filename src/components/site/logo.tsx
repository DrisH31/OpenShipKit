//
// The OpenShipKit mark and wordmark. The mark is an open ring with a dot leaving
// through its opening: "open" (source, and a door left open) and "launch". Two
// shapes, so it still reads at 16 px. The ring takes the current text colour;
// the dot takes the mark gradient (--brand-mark-from/to in brand.css), never the
// UI accent.
//
// Server-safe (no hooks). The favicon, apple icon and OG image reuse MARK_GEOMETRY
// so every surface draws the same mark.
//

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The mark on a 32 × 32 grid: a 280° ring (centre 14,18, radius 9.5, stroke 4,
 * round caps) open towards the top right, and the dot leaving along the gap's
 * bisector (−45°), clear of both ends so it never reads as a letter.
 */
export const MARK_GEOMETRY = {
  viewBox: "0 0 32 32",
  ring: "M23.46 17.17 A9.5 9.5 0 1 1 14.83 8.54",
  ringStroke: 4,
  dot: { cx: 25.3, cy: 6.7, r: 3.5 },
} as const;

/** The mark alone. Decorative by default; pass `title` when it stands without a wordmark. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const id = useId();
  const gradient = `ol-mark-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox={MARK_GEOMETRY.viewBox}
      className={cn("size-7 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--brand-mark-from)" />
          <stop offset="1" stopColor="var(--brand-mark-to)" />
        </linearGradient>
      </defs>
      <path
        d={MARK_GEOMETRY.ring}
        fill="none"
        stroke="currentColor"
        strokeWidth={MARK_GEOMETRY.ringStroke}
        strokeLinecap="round"
      />
      <circle {...MARK_GEOMETRY.dot} fill={`url(#${gradient})`} />
    </svg>
  );
}

/** Mark + wordmark, set in the display face. The visible name is the accessible name. */
export function Logo({ name = "OpenShipKit", className }: { name?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <LogoMark />
      <span className="font-display text-[1.1875rem] leading-none font-bold tracking-[-0.02em]">{name}</span>
    </span>
  );
}
