//
// The site's icons, generated: /icon/32 (the browser tab), /icon/192 and
// /icon/512 (the web app manifest). Static — no data — so they are built once
// and cached. The mark (the header logo's ring and dot, on a dark tile that
// reads on light and dark tab bars) lives in src/components/seo/brand-mark.tsx;
// /favicon.ico packs the same mark for clients that ask for it by name.
//

import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/seo/brand-mark";

const SIZES = [32, 192, 512] as const;

export function generateImageMetadata() {
  return SIZES.map((px) => ({ id: String(px), size: { width: px, height: px }, contentType: "image/png", alt: "OpenShipKit" }));
}

/** One icon per size; an unknown id falls back to 32 px. */
export default async function Icon({ id }: { id: Promise<string | number> }) {
  const requested = Number(await id);
  const px = (SIZES as readonly number[]).includes(requested) ? requested : 32;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent" }}>
        <BrandMark size={px} />
      </div>
    ),
    { width: px, height: px },
  );
}
