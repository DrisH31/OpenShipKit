import "server-only";

//
// The site's own faces for generated images (Open Graph cards): Space Grotesk
// 700 for the title, as every H1 uses, and Inter 400/600 for the rest. Satori
// reads TTF/WOFF, not the woff2 next/font serves, so the latin static
// instances live beside this file (fonts/, SIL Open Font License — see the
// OFL-*.txt files there).
//
// The files are referenced with `new URL(…, import.meta.url)`, which the
// bundler follows and copies into the server output (the standalone build
// excludes src/** from tracing, so a process.cwd() path would not survive).
//
// The subset is latin. A card whose text needs other scripts gets next/og's
// bundled default face instead (passing `fonts` replaces it), and so does
// every card if the files can't be read — a plainer card, never a 500.
//

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ImageResponse } from "next/og";

type OgFont = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]>[number];

/** The family names OgCard sets. */
export const OG_FONT = { display: "Space Grotesk", text: "Inter" } as const;

/** What the latin subset covers (fontsource's "latin" range), so a card knows it can use these faces. */
const LATIN = /^[\u0000-ÿıŒœʻʼˆ˚˜̩̄̈ -⁯€™←-↓−∕﻿�]*$/;

/** True when every character of the card's text is in the bundled latin subset. */
export function fitsLatinFonts(...texts: (string | null | undefined)[]): boolean {
  return texts.every((t) => !t || LATIN.test(t));
}

let loading: Promise<OgFont[]> | null = null;

async function load(): Promise<OgFont[]> {
  const read = (url: URL) => readFile(fileURLToPath(url));
  const [display, text, textSemibold] = await Promise.all([
    read(new URL("./fonts/space-grotesk-latin-700.ttf", import.meta.url)),
    read(new URL("./fonts/inter-latin-400.ttf", import.meta.url)),
    read(new URL("./fonts/inter-latin-600.ttf", import.meta.url)),
  ]);
  return [
    { name: OG_FONT.display, data: display, weight: 700, style: "normal" },
    { name: OG_FONT.text, data: text, weight: 400, style: "normal" },
    { name: OG_FONT.text, data: textSemibold, weight: 600, style: "normal" },
  ];
}

/** The faces, read once per process. [] when they can't be read (logged once). */
export async function ogFonts(): Promise<OgFont[]> {
  loading ??= load().catch((error: unknown) => {
    console.warn("[og] couldn't read the card fonts; using the default face", error);
    return [];
  });
  return loading;
}

/**
 * The `fonts` option for an ImageResponse showing these texts: the site's
 * faces when they cover the text, otherwise undefined (next/og's default).
 */
export async function ogFontsFor(...texts: (string | null | undefined)[]): Promise<OgFont[] | undefined> {
  if (!fitsLatinFonts(...texts)) return undefined;
  const fonts = await ogFonts();
  return fonts.length ? fonts : undefined;
}
