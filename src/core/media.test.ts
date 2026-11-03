//
// The media allow-list: files are recognised by their bytes, SVG is told
// apart so it can be refused by name, and only our own stored paths
// (yyyy/mm/<32 hex>.<ext>) are accepted anywhere a path comes in.
//

import { describe, expect, it } from "vitest";
import { MEDIA_ACCEPT, formatBytes, isMediaPath, looksLikeSvg, mediaPathFrom, mediaTypeOf, normaliseClaimedType, sniffImage } from "./media";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

/** A minimal ftyp box: size, "ftyp", major brand, minor version, compatible brands. */
const ftyp = (major: string, ...compatible: string[]) => bytes([0, 0, 0, 16 + 4 * compatible.length], "ftyp", major, [0, 0, 0, 0], ...compatible);

const HEX = "0123456789abcdef0123456789abcdef";

describe("sniffImage", () => {
  it("recognises each allowed format by its full signature", () => {
    expect(sniffImage(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("image/png");
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe("image/jpeg");
    expect(sniffImage(bytes("GIF89a", [1, 0]))).toBe("image/gif");
    expect(sniffImage(bytes("GIF87a"))).toBe("image/gif");
    expect(sniffImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(ftyp("avif"))).toBe("image/avif");
    // mif1 major brand with avif among the compatible brands is still AVIF.
    expect(sniffImage(ftyp("mif1", "miaf", "avif"))).toBe("image/avif");
  });

  it("refuses look-alikes and other formats", () => {
    expect(sniffImage(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // a truncated PNG signature
    expect(sniffImage(bytes([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))).toBeNull(); // a WAV file
    expect(sniffImage(ftyp("heic", "mif1", "heic"))).toBeNull(); // HEIC: same container, not displayable
    expect(sniffImage(bytes("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});

describe("looksLikeSvg", () => {
  it("spots SVG and XML, past a BOM and whitespace", () => {
    expect(looksLikeSvg(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
    expect(looksLikeSvg(bytes([0xef, 0xbb, 0xbf], "\n  <?xml version=\"1.0\"?><svg/>"))).toBe(true);
    expect(looksLikeSvg(bytes("<!-- made with a tool --><svg/>"))).toBe(true);
    expect(looksLikeSvg(bytes([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe("stored paths", () => {
  it("accepts only yyyy/mm/<32 hex>.<allowed ext>", () => {
    expect(isMediaPath(`2026/10/${HEX}.png`)).toBe(true);
    expect(isMediaPath(`2026/12/${HEX}.avif`)).toBe(true);
    for (const bad of [
      `2026/13/${HEX}.png`,
      `2026/10/${HEX}.svg`,
      `2026/10/${HEX}.PNG`,
      `2026/10/${HEX.slice(1)}.png`,
      `2026/10/../${HEX}.png`,
      `../2026/10/${HEX}.png`,
      `/2026/10/${HEX}.png`,
      `2026/10/.tmp-${HEX}`,
      `2026\\10\\${HEX}.png`,
      `2026/10/${HEX}.png/`,
      `2026/10/${HEX}.png\0.txt`,
    ]) {
      expect(isMediaPath(bad), bad).toBe(false);
    }
  });

  it("reads a path from a public URL or path", () => {
    expect(mediaPathFrom(`/uploads/2026/10/${HEX}.jpg`)).toBe(`2026/10/${HEX}.jpg`);
    expect(mediaPathFrom(`https://example.com/uploads/2026/10/${HEX}.jpg`)).toBe(`2026/10/${HEX}.jpg`);
    expect(mediaPathFrom(`2026/10/${HEX}.jpg`)).toBe(`2026/10/${HEX}.jpg`);
    expect(mediaPathFrom(`/uploads/2026/10/../../etc/passwd`)).toBeNull();
    expect(mediaPathFrom("/blog/hello")).toBeNull();
  });

  it("maps extensions back to the allow-listed types only", () => {
    expect(mediaTypeOf(`2026/10/${HEX}.jpg`)).toBe("image/jpeg");
    expect(mediaTypeOf("x.html")).toBeNull();
    expect(MEDIA_ACCEPT).not.toContain("svg");
  });
});

describe("helpers", () => {
  it("normalises claimed types and formats sizes", () => {
    expect(normaliseClaimedType("image/jpg")).toBe("image/jpeg");
    expect(normaliseClaimedType("IMAGE/PNG; charset=binary")).toBe("image/png");
    expect(normaliseClaimedType(undefined)).toBe("");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1)).toBe("1 byte");
  });
});
