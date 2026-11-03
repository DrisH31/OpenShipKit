import "server-only";

//
// The 1200×630 social card layout shared by every generated Open Graph image
// (the site's, each post's), and ogCardResponse() that renders it. Satori
// rules: inline styles, flexbox, literal colours. Type is the site's own: the
// title in Space Grotesk 700 like every H1, the rest in Inter (og-fonts.ts).
// The name is said once, beside the mark; the footer carries the post's facts
// or the site's host, so a card read out of context still says where it's from.
//

import { ImageResponse } from "next/og";
import { BRAND, BrandMark } from "./brand-mark";
import { OG_FONT, ogFontsFor } from "./og-fonts";

export const OG_SIZE = { width: 1200, height: 630 };

/** Trim to a length a 1200 px card can show at its type size, on a word boundary. */
export function clampText(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).trimEnd()}…`;
}

/** "https://example.com/" → "example.com"; "" for an unparsable origin. */
export function siteHost(base: string): string {
  try {
    return new URL(base).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export interface OgCardProps {
  siteName: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** The bottom line: a post's date and reading time. Defaults to `host`. */
  footer?: string;
  /** The site's host ("example.com"), shown when there's no footer. */
  host?: string;
}

export function OgCard({ siteName, eyebrow, title, subtitle, footer, host }: OgCardProps) {
  const heading = clampText(title, 90);
  // Space Grotesk sets wide: these sizes keep any title to three lines, most to two.
  const size = heading.length > 60 ? 54 : heading.length > 36 ? 64 : 80;
  const bottom = footer || host;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: 40,
        background: BRAND.bg,
        fontFamily: OG_FONT.text,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          background: BRAND.surface,
          borderRadius: 32,
          border: `1px solid ${BRAND.line}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <BrandMark size={60} tile="none" />
          <div
            style={{
              display: "flex",
              fontFamily: OG_FONT.display,
              fontSize: 34,
              fontWeight: 700,
              color: BRAND.ink,
              letterSpacing: -0.7,
            }}
          >
            {siteName}
          </div>
          {eyebrow && (
            <div
              style={{
                display: "flex",
                marginLeft: 12,
                padding: "6px 16px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.06)",
                fontSize: 20,
                fontWeight: 600,
                color: BRAND.ink2,
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              {eyebrow}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontFamily: OG_FONT.display,
              fontSize: size,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: size * -0.025,
              color: BRAND.ink,
            }}
          >
            {heading}
          </div>
          {subtitle && (
            <div style={{ display: "flex", fontSize: 28, fontWeight: 400, lineHeight: 1.4, color: BRAND.ink2, maxWidth: 960 }}>
              {clampText(subtitle, 140)}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: BRAND.ink3 }}>
          <div style={{ display: "flex", width: 48, height: 6, borderRadius: 3, background: BRAND.accent }} />
          {bottom && <div style={{ display: "flex" }}>{bottom}</div>}
        </div>
      </div>
    </div>
  );
}

/** The card as a PNG response, in the site's faces when they cover its text. */
export async function ogCardResponse(props: OgCardProps, headers?: Record<string, string>): Promise<ImageResponse> {
  const fonts = await ogFontsFor(props.siteName, props.eyebrow, props.title, props.subtitle, props.footer, props.host);
  return new ImageResponse(<OgCard {...props} />, { ...OG_SIZE, ...(fonts ? { fonts } : {}), ...(headers ? { headers } : {}) });
}
