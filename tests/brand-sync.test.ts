//
// The generated images keep the brand. Satori (next/og) can't read CSS
// variables, so src/components/seo/brand-mark.tsx carries literal copies of
// the tokens the favicon, Apple icon and Open Graph cards draw with (BRAND).
// This test reads those literals and the real token files (tokens.css, then
// brand.css on top, as globals.css imports them) and fails when they differ —
// so changing the brand colour in brand.css without updating brand-mark.tsx
// fails `npm test` instead of shipping an icon in the old colours.
//
// Reads the source as text rather than importing it: brand-mark.tsx pulls in
// the header logo's React module, and only the literal values matter here.
//

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

type Scheme = Record<string, string>;

/** The `--name: #hex` declarations in the first block whose selector matches `selector`. */
function block(css: string, selector: RegExp): Scheme {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = selector.exec(clean);
  if (!m) return {};
  const start = clean.indexOf("{", m.index) + 1;
  let depth = 1;
  let end = start;
  while (depth > 0 && end < clean.length) {
    if (clean[end] === "{") depth++;
    else if (clean[end] === "}") depth--;
    end++;
  }
  const out: Scheme = {};
  for (const d of clean.slice(start, end - 1).matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[d[1]] = d[2];
  return out;
}

const LIGHT = /:root,\s*\.light\s*\{/;
const DARK = /\.dark,\s*:root:not\(\.dark\) \.invert-scheme\s*\{/;
const tokens = read("src/styles/tokens.css");
const brand = read("src/styles/brand.css");
const light: Scheme = { ...block(tokens, LIGHT), ...block(brand, LIGHT) };
const dark: Scheme = { ...light, ...block(tokens, DARK), ...block(brand, DARK) };

/** The `key: "#hex"` entries of `export const BRAND = { … }` in brand-mark.tsx. */
function brandLiterals(): Record<string, string> {
  const source = read("src/components/seo/brand-mark.tsx");
  const body = /export const BRAND\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(source)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*"(#[0-9a-fA-F]{3,8})"/g)) out[m[1]] = m[2];
  return out;
}

/** Each BRAND key → the scheme and token it copies. A new key must be added here. */
const SOURCES: Record<string, [scheme: "light" | "dark", token: string]> = {
  markFrom: ["light", "brand-mark-from"],
  markTo: ["light", "brand-mark-to"],
  accent: ["light", "accent"],
  ink: ["light", "ink"],
  ink2: ["light", "ink-2"],
  ink3: ["light", "ink-3"],
  bg: ["light", "bg"],
  surface: ["light", "surface"],
  line: ["light", "line"],
  darkBg: ["dark", "bg"],
  darkInk: ["dark", "ink"],
  darkInk2: ["dark", "ink-2"],
};

describe("generated-image colours match the tokens", () => {
  const literals = brandLiterals();

  it("finds the BRAND literals in brand-mark.tsx", () => {
    expect(Object.keys(literals).length).toBeGreaterThan(0);
  });

  it("maps every BRAND key to a token", () => {
    expect(Object.keys(literals).filter((key) => !(key in SOURCES))).toEqual([]);
  });

  for (const [key, [scheme, token]] of Object.entries(SOURCES)) {
    it(`BRAND.${key} = --${token} (${scheme})`, () => {
      const expected = (scheme === "light" ? light : dark)[token];
      expect(expected, `--${token} not found in the ${scheme} tokens`).toBeDefined();
      expect(literals[key]?.toUpperCase(), `src/components/seo/brand-mark.tsx BRAND.${key}`).toBe(expected?.toUpperCase());
    });
  }
});
