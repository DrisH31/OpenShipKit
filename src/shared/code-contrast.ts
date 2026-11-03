//
// Syntax colours that stay readable on the panel they sit on. The highlighter's
// themes (github-light / github-dark-dimmed, src/server/highlight.ts) were drawn
// for their own backgrounds, not ours. highlightTokens applies readableOn to
// every token it returns, so every highlighted block on the site — the landing
// page's CodePanel and CodeSnippet, and the docs' Markdown code — gets the same
// guarantee from one place. Measured on our cards (7 Oct 2026), the
// colours bash, ini, json and yaml use all pass, some narrowly (github-light's
// red #D73A49 4.57:1 on white, github-dark-dimmed's comment grey #768390
// 4.58:1 on #181818), and github-light's orange #E36209 (variables in some
// grammars) is 3.5:1, under the 4.5:1 text floor (COL-1). So rather than trust
// a theme, every token colour is checked against the panel's background and, when
// it falls short, stepped towards the ink (darker on light, lighter on dark)
// until it passes — the hue stays, so a string still reads as a string.
//
// The panel backgrounds are the card tokens (src/styles/tokens.css --card in
// each scheme; the docs' code sits on --surface, the same two values);
// sections.test.ts reads tokens.css and fails if they drift.
// Pure: no I/O, safe anywhere.
//

/** The code panel's background in each scheme: `--card` in tokens.css. */
export const PANEL_BG = { light: "#FFFFFF", dark: "#1D1D1D" } as const;

/** WCAG text floor. */
export const TEXT_MIN = 4.5;

type RGB = [number, number, number];

function parse(hex: string): RGB | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio between two hex colours (1 when either can't be read). */
export function contrast(a: string, b: string): number {
  const ca = parse(a);
  const cb = parse(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `color`, or the nearest step of it towards black (on a light background) or
 * white (on a dark one) that reaches `min` against `bg`. A colour that can't be
 * parsed (a CSS keyword, `inherit`) is returned as it is.
 */
export function readableOn(color: string, bg: string, min = TEXT_MIN): string {
  const c = parse(color);
  const b = parse(bg);
  if (!c || !b) return color;
  if (contrast(color, bg) >= min) return toHex(c);
  const target: RGB = luminance(b) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.04; t <= 1; t += 0.04) {
    const mixed = toHex(c.map((v, i) => v + (target[i] - v) * t) as RGB);
    if (contrast(mixed, bg) >= min) return mixed;
  }
  return toHex(target);
}
