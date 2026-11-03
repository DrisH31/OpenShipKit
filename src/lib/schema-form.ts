//
// JSON Schema → a form model, for the generic admin editors (/admin/content/<key>
// and the plan editor). The server converts a zod schema with z.toJSONSchema()
// and normalises it here into a small tree of FieldNodes — plain data, so it
// crosses into the client editor as a prop.
//
// What the editor renders for each node:
//   string            → input, or textarea when maxLength > 140 — except a
//                       link, address, image or alt text (by format or key),
//                       which is always one line
//   number / integer  → number input
//   boolean           → switch
//   enum / const      → select
//   X | null          → a toggle, then X's fields when on
//   array             → repeatable rows: add, remove, move up / down; a list
//                       of small records (a link: label + href) is one grid
//                       row per item (compactFields)
//   object            → its fields, in schema order
//   anything else     → a raw-JSON box for that subtree (never silently dropped)
//
// Validation stays on the server: the service parses with the real zod schema
// and returns issues by dot path ("items.2.title"), which the editor shows next
// to the field with that path. Nothing here decides what is valid.
//

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  title?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  pattern?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
};

interface Meta {
  description?: string;
  /** The schema's default, used for new rows and when a stored value lacks the field. */
  default?: unknown;
}

export type FieldNode =
  | (Meta & { kind: "string"; minLength?: number; maxLength?: number; format?: string; pattern?: string; multiline: boolean })
  | (Meta & { kind: "number"; integer: boolean; minimum?: number; maximum?: number })
  | (Meta & { kind: "boolean" })
  | (Meta & { kind: "enum"; options: (string | number | boolean)[] })
  | (Meta & { kind: "object"; fields: { key: string; required: boolean; node: FieldNode }[] })
  | (Meta & { kind: "nullable"; inner: FieldNode })
  | (Meta & { kind: "array"; item: FieldNode; minItems?: number; maxItems?: number })
  | (Meta & { kind: "json" });

/** Longer than this and a string gets a textarea. */
export const MULTILINE_OVER = 140;

/** Keys that hold one-line values however long they may be: links, addresses, images, alt text. */
const SINGLE_LINE_KEY = /(href|url|link|image|src|avatar|logo|icon|email|alt|github|linkedin|youtube|discord|twitter|^x)$/i;

/** A string field under `key` stays one line when it holds a link, an address or an image. */
function singleLine(node: FieldNode, key: string): FieldNode {
  if (!SINGLE_LINE_KEY.test(key)) return node;
  if (node.kind === "string") return { ...node, multiline: false };
  if (node.kind === "nullable" && node.inner.kind === "string") return { ...node, inner: { ...node.inner, multiline: false } };
  return node;
}

function meta(s: JsonSchema): Meta {
  const m: Meta = {};
  if (s.description) m.description = s.description;
  if (s.default !== undefined) m.default = s.default;
  return m;
}

function resolveRef(s: JsonSchema, root: JsonSchema): JsonSchema {
  let cur = s;
  for (let hops = 0; cur.$ref && hops < 20; hops++) {
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(cur.$ref);
    const target = m ? (m[1] === "$defs" ? root.$defs : root.definitions)?.[decodeURIComponent(m[2])] : undefined;
    if (!target) return { ...cur, $ref: undefined, type: "__unresolved" };
    // Keep the referring node's description/default over the target's.
    cur = { ...target, description: cur.description ?? target.description, default: cur.default ?? target.default };
  }
  return cur;
}

const isPrimitive = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function isNullSchema(s: JsonSchema): boolean {
  return s.type === "null" || s.const === null || (Array.isArray(s.enum) && s.enum.length === 1 && s.enum[0] === null);
}

/** Normalise one JSON Schema node (z.toJSONSchema output, draft 2020-12) into a FieldNode. */
export function toFieldNode(schema: JsonSchema, root: JsonSchema = schema, depth = 0): FieldNode {
  if (depth > 32) return { kind: "json", ...meta(schema) };
  const s = resolveRef(schema, root);
  const m = meta(s);

  // Unions: "X | null" → nullable; "string | ''" (an optional email) → string; consts → enum.
  const union = s.anyOf ?? s.oneOf;
  if (union && union.length) {
    const branches = union.map((b) => resolveRef(b, root));
    const nonNull = branches.filter((b) => !isNullSchema(b));
    const hasNull = nonNull.length < branches.length;
    let inner: FieldNode;
    if (nonNull.length === 1) {
      inner = toFieldNode(nonNull[0], root, depth + 1);
    } else if (nonNull.length > 1 && nonNull.every((b) => b.const !== undefined && isPrimitive(b.const))) {
      inner = { kind: "enum", options: nonNull.map((b) => b.const as string | number | boolean) };
    } else if (nonNull.length > 1 && nonNull.every((b) => b.type === "string")) {
      // e.g. z.email().or(z.literal("")): edit as one string, keep the constrained branch's limits.
      const main = nonNull.find((b) => b.const === undefined) ?? nonNull[0];
      inner = toFieldNode({ ...main, const: undefined }, root, depth + 1);
    } else {
      inner = { kind: "json" };
    }
    // The union's own description/default belong to the whole field.
    if (hasNull) return { kind: "nullable", inner: stripMeta(inner), ...m, description: m.description ?? inner.description };
    return { ...inner, ...m, description: m.description ?? inner.description };
  }

  // type: ["string", "null"]
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== "null");
    const base = toFieldNode({ ...s, type: types.length === 1 ? types[0] : undefined }, root, depth + 1);
    return types.length < s.type.length ? { kind: "nullable", inner: stripMeta(base), ...m } : base;
  }

  if (Array.isArray(s.enum) && s.enum.length && s.enum.every(isPrimitive)) {
    return { kind: "enum", options: s.enum as (string | number | boolean)[], ...m };
  }
  if (s.const !== undefined && isPrimitive(s.const)) return { kind: "enum", options: [s.const], ...m };

  switch (s.type) {
    case "string":
      return {
        kind: "string",
        minLength: s.minLength,
        maxLength: s.maxLength,
        format: s.format,
        pattern: s.pattern,
        multiline: (s.maxLength ?? 0) > MULTILINE_OVER && s.format !== "uri" && s.format !== "email",
        ...m,
      };
    case "number":
    case "integer":
      return {
        kind: "number",
        integer: s.type === "integer",
        minimum: s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum : undefined),
        maximum: s.maximum ?? (s.exclusiveMaximum !== undefined ? s.exclusiveMaximum : undefined),
        ...m,
      };
    case "boolean":
      return { kind: "boolean", ...m };
    case "array": {
      const item = Array.isArray(s.items) ? undefined : s.items;
      if (!item) return { kind: "json", ...m };
      return { kind: "array", item: toFieldNode(item, root, depth + 1), minItems: s.minItems, maxItems: s.maxItems, ...m };
    }
    case "object": {
      if (!s.properties) return { kind: "json", ...m };
      const required = new Set(s.required ?? []);
      return {
        kind: "object",
        fields: Object.entries(s.properties).map(([key, child]) => ({ key, required: required.has(key), node: singleLine(toFieldNode(child, root, depth + 1), key) })),
        ...m,
      };
    }
    default:
      return { kind: "json", ...m };
  }
}

function stripMeta(n: FieldNode): FieldNode {
  const { description: _d, default: _f, ...rest } = n;
  void _d;
  void _f;
  return rest as FieldNode;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** A fresh value for a node: its schema default, else an empty value of the right shape. */
export function defaultFor(node: FieldNode): unknown {
  if (node.default !== undefined) return clone(node.default);
  switch (node.kind) {
    case "string":
      return "";
    case "number":
      return node.minimum !== undefined && node.minimum > 0 ? node.minimum : 0;
    case "boolean":
      return false;
    case "enum":
      return node.options[0];
    case "object":
      return Object.fromEntries(node.fields.map((f) => [f.key, defaultFor(f.node)]));
    case "nullable":
      return null;
    case "array":
      return Array.from({ length: node.minItems ?? 0 }, () => defaultFor(node.item));
    case "json":
      return null;
  }
}

/** The value the editor starts with for an "on" nullable: the inner node's fresh value. */
export function enabledValueFor(node: Extract<FieldNode, { kind: "nullable" }>): unknown {
  return defaultFor(node.inner);
}

// ---------------------------------------------------------------- paths

export type Path = (string | number)[];

export const pathKey = (path: Path): string => path.join(".");

/** The same path with array indexes as "*", for hints that apply to every row: "prices.*.amountCents". */
export const pathPattern = (path: Path): string => path.map((p) => (typeof p === "number" ? "*" : p)).join(".");

export function getAt(value: unknown, path: Path): unknown {
  let cur: unknown = value;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

/** Immutable set: returns a new root with `next` at `path` (creating objects/arrays on the way). */
export function setAt(value: unknown, path: Path, next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const arr = Array.isArray(value) ? [...value] : [];
    arr[head] = setAt(arr[head], rest, next);
    return arr;
  }
  const obj = value !== null && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  obj[head] = setAt(obj[head], rest, next);
  return obj;
}

/** Move an array element; out-of-range moves return the array unchanged. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return [...arr];
  const out = [...arr];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

// ---------------------------------------------------------------- labels

const WORDS: Record<string, string> = {
  cta: "CTA",
  og: "OG",
  id: "ID",
  url: "URL",
  seo: "SEO",
  faq: "FAQ",
  href: "link",
  x: "X",
  api: "API",
  mcp: "MCP",
  github: "GitHub",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

/** "primaryCta" → "Primary CTA", "ogImage" → "OG image", "href" → "Link". */
/** One line of text: a single-line string, or a nullable one (empty = null). */
function isShortText(node: FieldNode): boolean {
  if (node.kind === "string") return !node.multiline;
  return node.kind === "nullable" && node.inner.kind === "string" && !node.inner.multiline;
}

/**
 * The fields of an array item that can sit side by side in one row — an
 * object of two or three one-line text fields, like a link (label, href) or a
 * logo (name, href) — or null when the item needs a card of its own.
 */
export function compactFields(item: FieldNode): { key: string; node: FieldNode }[] | null {
  if (item.kind !== "object") return null;
  const n = item.fields.length;
  return n >= 2 && n <= 3 && item.fields.every((f) => isShortText(f.node)) ? item.fields : null;
}

export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      return WORDS[lower] ?? lower;
    });
  if (!words.length) return key;
  const first = words[0];
  words[0] = first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

const SUMMARY_KEYS = ["label", "title", "name", "question", "quote", "value"];

/** A short name for an array row: its first non-empty label-like field, cut to 48 characters. */
export function itemSummary(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? truncate(value.trim()) : null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  for (const k of SUMMARY_KEYS) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return truncate(v.trim());
  }
  return null;
}

function truncate(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Fill in what a stored value is missing (a field added to the schema later),
 * so every input has something to show. Never removes anything.
 */
export function withDefaults(node: FieldNode, value: unknown): unknown {
  if (value === undefined) return defaultFor(node);
  switch (node.kind) {
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const rec = { ...(value as Record<string, unknown>) };
      for (const f of node.fields) rec[f.key] = withDefaults(f.node, rec[f.key]);
      return rec;
    }
    case "array":
      return Array.isArray(value) ? value.map((v) => withDefaults(node.item, v)) : value;
    case "nullable":
      return value === null ? null : withDefaults(node.inner, value);
    default:
      return value;
  }
}

