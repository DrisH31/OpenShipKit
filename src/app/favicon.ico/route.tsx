//
// /favicon.ico — the mark at 16, 32 and 48 px in one .ico, for the clients
// that ask for the root favicon directly instead of reading <link rel="icon">
// (RSS readers, some crawlers, older browsers). The same mark as /icon/* and
// the header logo (src/components/seo/brand-mark.tsx). No data, so it's built
// once and cached; 48 px is the size search engines ask a favicon to be a
// multiple of.
//

import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/seo/brand-mark";
import { buildIco } from "@/components/seo/ico";

export const dynamic = "force-static";

const SIZES = [16, 32, 48] as const;

async function png(px: number): Promise<Uint8Array> {
  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "transparent" }}>
        <BrandMark size={px} />
      </div>
    ),
    { width: px, height: px },
  );
  return new Uint8Array(await image.arrayBuffer());
}

export async function GET() {
  const images = await Promise.all(SIZES.map(async (size) => ({ size, png: await png(size) })));
  const ico = buildIco(images);
  return new Response(ico.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "image/x-icon",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
