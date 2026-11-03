//
// The Apple touch icon (180×180), generated. Square corners and a full-bleed
// background: iOS applies its own mask, and transparency turns black there.
// Also the Organization logo in the site's JSON-LD (≥ 112 px, legible on white).
//

import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/seo/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <BrandMark size={180} radius={0} />
      </div>
    ),
    size,
  );
}
