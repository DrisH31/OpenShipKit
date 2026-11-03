//
// The meta description budget. Search results show about 155 characters of a
// description and cut the rest mid-word, so a summary written for a list (up
// to 300 characters) would lose its ending — and if the claim came last, the
// claim. Write descriptions claim-first and inside the budget; this is the
// safety net for the ones that aren't: it ends at a word boundary, with an
// ellipsis, so the snippet reads as a sentence that continues rather than a
// fault. Pure.
//
// Only the <meta name="description"> and the og/twitter descriptions are cut;
// the page, the feed and JSON-LD keep the full text.
//

/** Google's typical desktop snippet length, in characters. */
export const META_DESCRIPTION_MAX = 155;

/** `text` as a meta description: whitespace collapsed, and cut at a word boundary to at most `max` characters (ellipsis included). */
export function metaDescription(text: string, max = META_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, max - 1);
  const cut = room.lastIndexOf(" ");
  // A single word longer than the budget is cut where it stands.
  const head = (cut > max * 0.6 ? room.slice(0, cut) : room).replace(/[\s,;:.\-–—]+$/, "");
  return `${head}…`;
}
