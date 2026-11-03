/* Standards (web-design): UI-18 A code arrives whole */

/* Numbers as people really bring them: typed on a keyboard in another script, or pasted from a
   message with words, spaces and dashes round them. Any field that takes digits (a code, an
   amount, a phone number, an order number) reads them through here. */

/** Arabic-Indic (U+0660–0669) and Eastern Arabic-Indic (U+06F0–06F9) digits as Western ones.
    Both blocks start on a multiple of 16, so a digit's code point mod 16 is its value. */
export function westernDigits(text: string) {
  return text.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) % 16))
}

/** The runs of digits in a text, each with its separators removed: spaces, hyphens, the
    non-breaking hyphen and the en dash, as codes and phone numbers are written in messages.
    NFKC first, so full-width digits count. */
export function digitRuns(text: string) {
  return (westernDigits(text.normalize("NFKC")).match(/\d(?:[\s‐‑–-]?\d)*/g) ?? []).map((r) => r.replace(/\D/g, ""))
}

/** The code of `length` digits inside whatever was pasted: "Your code is 482-913." gives
    "482913". A run of exactly that length wins (so "valid for 10 minutes" is never taken);
    otherwise every run, joined. */
export function codeIn(text: string, length: number) {
  const runs = digitRuns(text)
  return runs.find((r) => r.length === length) ?? runs.join("")
}
