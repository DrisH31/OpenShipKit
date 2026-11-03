//
// /icon-maskable/192 and /icon-maskable/512 — the web app manifest's maskable
// icons (src/app/manifest.ts). Full-bleed dark ground with square corners, and
// the mark inside the central 80 % circle Android crops an adaptive launcher
// icon to (MASKABLE_FILL), so no mask clips the dot.
//
// A route handler, not more ids on src/app/icon.tsx: every icon.tsx image is
// also emitted as a <link rel="icon"> in <head>, and a square full-bleed tile
// must not be picked as the browser-tab icon. The proxy's matcher already skips
// "/icon…" paths. Static — no data — so each size is built once and cached.
//

import { ImageResponse } from "next/og";
import { BrandMark, MASKABLE_FILL } from "@/components/seo/brand-mark";

const SIZES = ["192", "512"] as const;

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return SIZES.map((size) => ({ size }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  if (!(SIZES as readonly string[]).includes(size)) return new Response("Not found", { status: 404 });
  const px = Number(size);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <BrandMark size={px} radius={0} fill={MASKABLE_FILL} />
      </div>
    ),
    { width: px, height: px },
  );
}
