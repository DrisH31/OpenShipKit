//
// A Windows .ico container around PNG images — the format /favicon.ico is
// expected in. Every browser since IE 11/Vista reads PNG-compressed entries,
// so the generated PNGs go in as they are; no bitmap conversion. Pure.
//
// Layout: ICONDIR (6 bytes) · one ICONDIRENTRY (16 bytes) per image · the
// PNG bytes, in entry order. All integers little-endian.
//

export interface IcoImage {
  /** Edge in px, 1–256 (an icon is square). */
  size: number;
  png: Uint8Array;
}

const HEADER = 6;
const ENTRY = 16;

/** Pack square PNGs into one .ico file. */
export function buildIco(images: IcoImage[]): Uint8Array {
  if (images.length === 0 || images.length > 255) throw new RangeError("an .ico holds 1–255 images");
  const total = HEADER + ENTRY * images.length + images.reduce((n, i) => n + i.png.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = HEADER + ENTRY * images.length;
  images.forEach((image, i) => {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) throw new RangeError(`icon size ${image.size} is outside 1–256`);
    const at = HEADER + ENTRY * i;
    const edge = image.size === 256 ? 0 : image.size; // 0 means 256
    view.setUint8(at, edge); // width
    view.setUint8(at + 1, edge); // height
    view.setUint8(at + 2, 0); // palette colours: none
    view.setUint8(at + 3, 0); // reserved
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, image.png.byteLength, true);
    view.setUint32(at + 12, offset, true);
    out.set(image.png, offset);
    offset += image.png.byteLength;
  });
  return out;
}
