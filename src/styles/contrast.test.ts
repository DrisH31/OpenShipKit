//
// The colour contract, measured: every text, control and label pair the
// components use passes WCAG 2.2 AA in both schemes (Invariant 10). Reads the
// real token files (tokens.css, then brand.css on top, as globals.css imports
// them) and computes WCAG 2 contrast ratios — no browser, no private tooling.
// `npm test` runs it, so changing a colour that breaks a floor fails the check.
//
//   text   ≥ 4.5:1 on every surface   (COL-1)
//   ui     ≥ 3:1 on every surface     (COL-2: field edges, focus, icons, the accent as a control)
//   pairs  ≥ 4.5:1                    (a label on its own fill: button text, badge text)
//   state  ≥ 3:1                      (the ring that marks a highlighted menu item or a selected
//                                      segment, against its wash on every surface — WCAG 1.4.11)
//   muted  shadcn's bg-muted fills (progress track, skeleton, kbd) differ from every surface
//   tonal  text on a tonal fill (a pill, a secondary button, a tab list, bg-muted) is measured
//          on the composite the eye sees — the wash over each surface, bg+tonal and
//          bg+tonal-hover included. ink and ink-2 must pass 4.5:1 there; any ink token that
//          doesn't (ink-3: about 4.0:1 and 3.7:1 on the light page) is banned on a tonal fill,
//          and a scan of src/components and src/app fails on a class list that pairs them.
//
// A failure prints the scheme, the pair and the ratio. Run just this file with
// `npx vitest run src/styles/contrast.test.ts`.
//

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");

type Scheme = Record<string, string>;

/** The `--name: #hex` declarations in the first block whose selector starts with `selector`. */
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
  const body = clean.slice(start, end - 1);
  for (const d of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[d[1]] = d[2];
  // An alias (`--ink-faint: var(--ink-3)`) takes the value of the role it names, in the same scheme.
  for (const d of body.matchAll(/--([\w-]+)\s*:\s*var\(--([\w-]+)\)\s*;/g)) if (out[d[2]]) out[d[1]] = out[d[2]];
  return out;
}

const LIGHT = /:root,\s*\.light\s*\{/;
const DARK = /\.dark,\s*:root:not\(\.dark\) \.invert-scheme\s*\{/;
const tokens = read("tokens.css");
const brand = read("brand.css");
const light: Scheme = { ...block(tokens, LIGHT), ...block(brand, LIGHT) };
const dark: Scheme = { ...light, ...block(tokens, DARK), ...block(brand, DARK) };

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio of two hex colours, 1–21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The `--name: rgb(r g b / a)` washes (tonal, tonal-hover) in the first block whose selector starts with `selector`. */
function washes(css: string, selector: RegExp): Record<string, [number, number, number, number]> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = selector.exec(clean);
  if (!m) return {};
  const body = clean.slice(clean.indexOf("{", m.index) + 1, clean.indexOf("}", m.index));
  const out: Record<string, [number, number, number, number]> = {};
  for (const d of body.matchAll(/--([\w-]+)\s*:\s*rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)\s*;/g)) {
    out[d[1]] = [Number(d[2]), Number(d[3]), Number(d[4]), Number(d[5])];
  }
  return out;
}

/** A translucent wash painted over an opaque hex, as the hex the eye sees. */
function over(wash: [number, number, number, number], hex: string): string {
  const base = [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16));
  const [r, g, b, a] = wash;
  return `#${[r, g, b].map((c, i) => Math.round(c * a + base[i] * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
}

const lightWash = washes(tokens, LIGHT);
const darkWash = { ...lightWash, ...washes(tokens, DARK) };

const SURFACES = ["bg", "surface", "card", "raised"];
const TEXT = ["ink", "ink-2", "ink-3", "ink-positive", "ink-warning", "ink-danger", "ink-info", "accent-text"];
const UI = ["field", "focus", "ink-faint", "accent"];
const PAIRS: [fg: string, bg: string][] = [
  ["accent-ink", "accent"],
  ["accent-ink", "accent-hover"],
  ["badge-positive-ink", "positive-soft"],
  ["badge-warning-ink", "warning-soft"],
  ["badge-danger-ink", "danger-soft"],
  ["badge-info-ink", "info-soft"],
];

function failures(scheme: Scheme): string[] {
  const out: string[] = [];
  const check = (fg: string, bg: string, floor: number) => {
    const a = scheme[fg];
    const b = scheme[bg];
    if (!a || !b) return out.push(`${fg} on ${bg}: missing token`);
    const ratio = contrast(a, b);
    if (ratio < floor) out.push(`${fg} ${a} on ${bg} ${b}: ${ratio.toFixed(2)} < ${floor}`);
  };
  for (const s of SURFACES) {
    for (const t of TEXT) check(t, s, 4.5);
    for (const u of UI) check(u, s, 3);
  }
  for (const [fg, bg] of PAIRS) check(fg, bg, 4.5);
  return out;
}

/** The tonal composites: each wash over each surface ("bg+tonal", "card+tonal-hover"), as opaque hexes. */
const WASHES = ["tonal", "tonal-hover"] as const;
const TONAL_SURFACES = SURFACES.flatMap((s) => WASHES.map((w) => `${s}+${w}`));
function withTonal(scheme: Scheme, wash: Record<string, [number, number, number, number]>): Scheme {
  const out: Scheme = { ...scheme };
  for (const s of SURFACES) for (const w of WASHES) if (wash[w] && scheme[s]) out[`${s}+${w}`] = over(wash[w], scheme[s]);
  return out;
}
const lightTonal = withTonal(light, lightWash);
const darkTonal = withTonal(dark, darkWash);

/** The text that may sit on a tonal fill: it passes 4.5:1 on every composite, in both schemes. */
const TONAL_TEXT = ["ink", "ink-2"];

/** `fg` on every tonal composite below `floor`, as failure lines. */
function tonalFailures(scheme: Scheme, fg: string[], floor: number): string[] {
  const out: string[] = [];
  for (const s of TONAL_SURFACES) {
    for (const t of fg) {
      const ratio = contrast(scheme[t], scheme[s]);
      if (ratio < floor) out.push(`${t} ${scheme[t]} on ${s} ${scheme[s]}: ${ratio.toFixed(2)} < ${floor}`);
    }
  }
  return out;
}

/** Every .ts/.tsx file under `dir` (relative to this folder), tests excluded. */
function sources(dir: string): { path: string; text: string }[] {
  const root = fileURLToPath(new URL(dir, import.meta.url));
  const out: { path: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push({ path: p, text: readFileSync(p, "utf8") });
    }
  };
  walk(root);
  return out;
}

describe("colour tokens", () => {
  it("parse from tokens.css and brand.css in both schemes", () => {
    for (const scheme of [light, dark]) for (const t of [...SURFACES, ...TEXT, ...UI]) expect(scheme[t], t).toMatch(/^#/);
    expect(light.accent).not.toBe(dark.accent);
  });

  it("measure the WCAG 2 ratio correctly", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("pass AA in the light scheme", () => {
    expect(failures(light)).toEqual([]);
  });

  it("pass AA in the dark scheme", () => {
    expect(failures(dark)).toEqual([]);
  });

  // A highlighted menu, select or command item is the tonal-hover wash with its label at full ink,
  // and no ring: the design system dropped its 1 px ring (shadow-highlight) in v2.2.1, because the
  // owner read it as a glow round everything highlighted. The label carries the state, so it must
  // read at 4.5:1 on that wash over every surface.
  it("keep the highlighted item's label at 4.5:1 on its wash in both schemes", () => {
    for (const [scheme, wash] of [[light, lightWash], [dark, darkWash]] as const) {
      expect(wash["tonal-hover"], "tonal-hover").toBeDefined();
      for (const s of SURFACES) {
        const fill = over(wash["tonal-hover"], scheme[s]);
        expect(contrast(scheme["ink"], fill), `ink on tonal-hover over ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Text on a tonal fill sits on the wash over the surface, a step darker (light) or lighter (dark)
  // than the surface itself: ink-3 that passes on the page fails on a pill on the page.
  it("keep text on tonal fills at 4.5:1 in both schemes", () => {
    for (const scheme of [lightTonal, darkTonal]) for (const s of TONAL_SURFACES) expect(scheme[s], s).toMatch(/^#/);
    expect(tonalFailures(lightTonal, TONAL_TEXT, 4.5)).toEqual([]);
    expect(tonalFailures(darkTonal, TONAL_TEXT, 4.5)).toEqual([]);
    expect(tonalFailures(lightTonal, ["focus"], 3)).toEqual([]);
    expect(tonalFailures(darkTonal, ["focus"], 3)).toEqual([]);
  });

  // The ink tokens that fail on a tonal composite (computed, so a palette change moves the line)
  // may not be a tonal fill's text: not in one class list with bg-tonal/bg-tonal-hover/bg-muted,
  // nor with hover:bg-tonal unless hover also changes the text. ink-faint is never text.
  it("never put a dim ink on a tonal fill", () => {
    const dim = [
      ...["ink", "ink-2", "ink-3"].filter((t) => tonalFailures(lightTonal, [t], 4.5).length || tonalFailures(darkTonal, [t], 4.5).length),
      "ink-faint",
    ];
    expect(dim, "ink-3 is too dim for a tonal fill").toContain("ink-3");
    const offenders: string[] = [];
    for (const { path, text } of [...sources("../components"), ...sources("../app")]) {
      for (const m of text.matchAll(/(["'`])((?:(?!\1)[^\n])*?)\1/g)) {
        const cls = m[2].split(/\s+/);
        const fill = cls.some((c) => /^(dark:)?bg-(tonal|tonal-hover|muted)$/.test(c));
        const hoverFill = cls.some((c) => /^hover:bg-(tonal|tonal-hover|muted)$/.test(c));
        const dimText = cls.some((c) => dim.some((t) => c === `text-${t}`));
        const hoverText = cls.some((c) => c.startsWith("hover:text-"));
        if (dimText && (fill || (hoverFill && !hoverText))) offenders.push(`${path}: ${m[2].slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // shadcn's bg-muted is a fill that must show where it sits: on white cards and popovers in
  // light mode (surface, card and raised are one #FFF), so it maps to the tonal wash, never a surface.
  it("keep bg-muted visible on every surface", () => {
    const theme = read("theme.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(theme).toMatch(/--muted:\s*var\(--tonal(-hover)?\)/);
    for (const [scheme, wash] of [[light, lightWash], [dark, darkWash]] as const) {
      for (const s of SURFACES) expect(over(wash.tonal, scheme[s]), `muted over ${s}`).not.toBe(scheme[s].toLowerCase());
    }
  });
});
