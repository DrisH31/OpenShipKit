//
// The OpenShipKit mark for generated images (icons, Open Graph cards). It draws
// MARK_GEOMETRY from src/components/site/logo.tsx — the open ring and the dot
// leaving through its opening — so the browser tab, the home-screen icon, the
// social card and the header logo are one mark. The ring takes the ink of its
// ground; the dot takes the mark gradient (amber → vermilion, the
// --brand-mark-from/to values in src/styles/brand.css).
//
// Satori (next/og) renders this, so: inline styles only, flexbox only, and
// literal colours (CSS variables don't exist there). Keep the values in step
// with brand.css and tokens.css.
//

import { MARK_GEOMETRY } from "@/components/site/logo";

/** Literal copies of the tokens the generated images use (Satori can't read CSS variables). */
export const BRAND = {
  markFrom: "#F59E0B",
  markTo: "#E5431A",
  accent: "#C2410C",
  ink: "#191919",
  ink2: "#414141",
  ink3: "#6D6D6D",
  bg: "#F2F2F2",
  surface: "#FFFFFF",
  darkBg: "#171717",
  darkInk: "#E5E5E5",
  darkInk2: "#B3B3B3",
  line: "#DFDFDF",
} as const;

/**
 * The mark's ink box on its 32-unit grid: the ring's outer edge (centre 14,18,
 * radius 9.5 + half the stroke) and the dot's (25.3, 6.7, r 3.5). It's square,
 * so one scale fits it to any tile.
 */
const INK_BOX = { x: 2.5, y: 3.2, size: 26.3 } as const;

/** The tile behind the mark: dark (icons; reads on light and dark tab bars), light, or none (a card's own surface). */
export type MarkTile = "dark" | "light" | "none";

/** How much of a maskable icon the mark's ink box may fill: its far corner (the dot) stays inside the central 80 % circle Android masks to. */
export const MASKABLE_FILL = 0.56;

/**
 * The mark at `size` px. `radius` is the tile's corner as a share of the size;
 * app icons on iOS are masked by the system, so apple-icon passes 0. On a tile
 * the mark fills two thirds of it, the margin an icon grid expects; `fill`
 * overrides that share (a maskable icon passes MASKABLE_FILL).
 */
export function BrandMark({ size, radius = 0.22, tile = "dark", fill: fillOverride }: { size: number; radius?: number; tile?: MarkTile; fill?: number }) {
  const fill = fillOverride ?? (tile === "none" ? 1 : 0.66);
  const scale = (64 * fill) / INK_BOX.size;
  const tx = 32 - (INK_BOX.x + INK_BOX.size / 2) * scale;
  const ty = 32 - (INK_BOX.y + INK_BOX.size / 2) * scale;
  const ring = tile === "dark" ? BRAND.darkInk : BRAND.ink;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* bottom-left → top-right across the dot, as LogoMark draws it */}
        <linearGradient id="ol-mark-dot" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={BRAND.markFrom} />
          <stop offset="1" stopColor={BRAND.markTo} />
        </linearGradient>
      </defs>
      {tile !== "none" && (
        <rect x="0" y="0" width="64" height="64" rx={64 * radius} fill={tile === "dark" ? BRAND.darkBg : BRAND.surface} />
      )}
      <g transform={`translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(4)})`}>
        <path d={MARK_GEOMETRY.ring} fill="none" stroke={ring} strokeWidth={MARK_GEOMETRY.ringStroke} strokeLinecap="round" />
        <circle cx={MARK_GEOMETRY.dot.cx} cy={MARK_GEOMETRY.dot.cy} r={MARK_GEOMETRY.dot.r} fill="url(#ol-mark-dot)" />
      </g>
    </svg>
  );
}
