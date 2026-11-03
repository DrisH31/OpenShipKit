//
// Reading a submitted <form>. Server actions receive FormData whose values may
// be missing, a File, or a string with stray whitespace; these helpers return
// clean primitives and leave validation to the service's zod schema (so a bad
// value still gets the schema's message, not a silent default).
//

/** A trimmed string, or "" when missing. */
export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** A trimmed string, or null when empty — for nullable columns. */
export function nullableText(form: FormData, name: string): string | null {
  const v = text(form, name);
  return v === "" ? null : v;
}

/** Comma- or newline-separated values, trimmed, empties dropped, de-duplicated in order. */
export function list(form: FormData, name: string): string[] {
  const seen = new Set<string>();
  for (const part of text(form, name).split(/[\n,]/)) {
    const v = part.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

/** One value per line (keeps commas inside a line). */
export function lines(form: FormData, name: string): string[] {
  return text(form, name)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * <input type="datetime-local"> (read as UTC, as the editor shows it) → ISO, or
 * null when empty. An unparseable value is returned as-is for the schema to reject.
 */
export function dateTimeLocal(form: FormData, name: string): string | null {
  const v = text(form, name);
  if (!v) return null;
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/**
 * A datetime-local field on an EDIT form, as a patch value: `undefined` (leave
 * the stored date alone) when the person didn't change what they were shown —
 * the form carries that in a hidden `<name>Was` input — so a save never
 * truncates the stored seconds to the minute the input can show; also
 * `undefined` when they emptied it and `keepWhenEmpty` says empty means "keep"
 * (a published post's date). Otherwise what dateTimeLocal() reads.
 */
export function changedDateTimeLocal(form: FormData, name: string, opts: { keepWhenEmpty?: boolean } = {}): string | null | undefined {
  const now = text(form, name);
  if (form.has(`${name}Was`) && now === text(form, `${name}Was`)) return undefined;
  if (!now && opts.keepWhenEmpty) return undefined;
  return dateTimeLocal(form, name);
}

/**
 * A JSON field (the content and plan editors serialise their value into one
 * hidden input). Returns { ok: false } with a readable reason instead of throwing.
 */
export function json(form: FormData, name: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const raw = form.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "Nothing was submitted" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    return { ok: false, reason: `That isn’t valid JSON (${detail})` };
  }
}
