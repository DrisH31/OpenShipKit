//
// Text splitting. Pure, no dependencies, no env (the service passes the sizes).
//
// What decides retrieval quality at this scale is (a) not splitting
// mid-sentence and (b) overlapping enough that a fact straddling a boundary
// survives whole in at least one chunk. Reach for a cleverer chunker only after
// measuring.
//
// The overlap is the part people delete. Without it a sentence across a
// boundary is embedded as two half-thoughts that match no query well — "the
// answer is definitely in the document but search can't find it", hard to
// diagnose because each half looks fine.
//

/**
 * Split on paragraphs, then sentences, then a hard cut as a last resort, and
 * pack the pieces into chunks of at most `size` characters. Each chunk after
 * the first starts with up to `overlap` characters from the end of the one
 * before, when that still fits. Never drops text: a "sentence" longer than a
 * chunk (a code block, a table, minified text) is cut, not skipped — a dropped
 * piece is a silent hole in the index.
 */
export function chunkText(text: string, size: number, overlap: number): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  if (normalized.length <= size) return [normalized];

  const units: string[] = [];
  for (const paragraph of normalized.split(/\n\s*\n/)) {
    if (paragraph.length <= size) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of paragraph.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [paragraph]) {
      if (sentence.length <= size) {
        units.push(sentence);
        continue;
      }
      for (let i = 0; i < sentence.length; i += size) units.push(sentence.slice(i, i + size));
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    const joined = current ? `${current}\n\n${unit}` : unit;
    if (joined.length <= size) {
      current = joined;
      continue;
    }
    if (current.trim()) chunks.push(current.trim());
    // Carry the tail of the chunk just closed, if the result still fits.
    const tail = overlap > 0 ? current.slice(-overlap).trimStart() : "";
    current = tail && tail.length + 2 + unit.length <= size ? `${tail}\n\n${unit}` : unit;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
