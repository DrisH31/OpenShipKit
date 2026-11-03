//
// A small structural diff for the audit log: before → after as a flat list of
// changed paths. Objects are compared key by key; arrays index by index (an
// insert in the middle shows as several changes — fine for reading, and it
// keeps the output honest about what actually moved).
//
// Pure and dependency-free, so it runs in a server component and in tests.
//

export type DiffKind = "added" | "removed" | "changed";

export interface DiffEntry {
  /** "hero.title", "items.2.answer"; "" for the value as a whole. */
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function join(base: string, key: string | number): string {
  return base ? `${base}.${key}` : String(key);
}

/** Deep equality for JSON values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Every leaf that differs. `null`/`undefined` before means "created"; after
 * means "deleted" — both come back as one entry at path "". `limit` caps the
 * list (a whole post body counts as one leaf, so this is rarely hit).
 */
export function diffJson(before: unknown, after: unknown, limit = 200): DiffEntry[] {
  const out: DiffEntry[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (out.length >= limit || jsonEqual(a, b)) return;
    if (a === undefined) return void out.push({ path, kind: "added", after: b });
    if (b === undefined) return void out.push({ path, kind: "removed", before: a });
    if (isObject(a) && isObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
      for (const k of keys) walk(a[k], b[k], join(path, k));
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) walk(i < a.length ? a[i] : undefined, i < b.length ? b[i] : undefined, join(path, i));
      return;
    }
    out.push({ path, kind: "changed", before: a, after: b });
  };
  if (before === null || before === undefined) {
    if (after !== null && after !== undefined) out.push({ path: "", kind: "added", after });
    return out;
  }
  if (after === null || after === undefined) {
    out.push({ path: "", kind: "removed", before });
    return out;
  }
  walk(before, after, "");
  return out;
}

/** A value for display: strings as-is, everything else as compact JSON, cut at `max` characters. */
export function previewValue(v: unknown, max = 400): string {
  if (v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
