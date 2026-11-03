import "server-only";

//
// The editable site. A section with nothing stored renders its default from
// src/content/defaults.ts, so a fresh install shows a complete site. A stored
// value that no longer passes its schema (after
// a schema change tightened a field) falls back field by field: each failing
// field reads as its default and the rest is kept, so a social link the new
// rule refuses doesn't take the site's name with it. If that still doesn't
// pass, the whole section falls back. Either way it is logged.
//
// A FAILED read is never softened into defaults. On a renamed site the
// defaults are another product's copy (OpenShipKit's name, tagline and
// Organization JSON-LD): serving them with a 200 during a database outage would
// get that indexed under this domain — a coherent false page is worse than an
// error. So the read throws, the page shows the error boundary (not indexed),
// and /api/health answers 503 for monitors. Same policy as posts.
//

import { cache } from "react";
import type { z } from "zod";
import { CONTENT_KEYS, CONTENT_KEY_LIST, type ContentKey, type ContentValue, isContentKey } from "@/core/content";
import type { Actor } from "@/core/types";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { recordAudit } from "./audit";
import { ServiceError, parseInput } from "./errors";
import { log } from "@/server/log";

export interface ContentState<K extends ContentKey> {
  key: K;
  value: ContentValue<K>;
  /** false = showing the default (nothing stored yet, or the stored value is invalid). */
  stored: boolean;
  updatedAt: string | null;
}

async function readAll(): Promise<Map<string, { value: unknown; updatedAt: string }>> {
  const rows = await (await getData()).content.all();
  return new Map(rows.map((r) => [r.key, { value: r.value, updatedAt: r.updatedAt }]));
}

/** All content, one read per request. */
const loadAll = cache(readAll);

/** The value at `path` inside `root`, or undefined. */
function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let at: unknown = root;
  for (const step of path) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<PropertyKey, unknown>)[step];
  }
  return at;
}

/** A copy of `root` with the value at `path` replaced (only through existing objects and arrays). */
function withValueAt(root: unknown, path: readonly PropertyKey[], value: unknown): unknown {
  if (path.length === 0) return value;
  if (typeof root !== "object" || root === null) return root;
  const [step, ...rest] = path;
  const copy = (Array.isArray(root) ? [...root] : { ...root }) as Record<PropertyKey, unknown>;
  copy[step] = withValueAt(copy[step], rest, value);
  return copy;
}

/**
 * A stored value through its schema. One that fails gets each failing field
 * replaced by the default's value at that path (where the default has one) and
 * is tried once more. `value` is null when it still fails; `issues` are the
 * first parse's, for the log ([] when it passed as stored).
 */
function parseStored<K extends ContentKey>(key: K, stored: unknown): { value: ContentValue<K> | null; issues: readonly z.core.$ZodIssue[] } {
  const schema = CONTENT_KEYS[key].schema;
  const first = schema.safeParse(stored);
  if (first.success) return { value: first.data as ContentValue<K>, issues: [] };
  const issues = first.error.issues;
  let candidate = stored;
  for (const issue of issues) {
    const fallback = valueAt(DEFAULT_CONTENT[key], issue.path);
    if (fallback === undefined) return { value: null, issues };
    candidate = withValueAt(candidate, issue.path, fallback);
  }
  const second = schema.safeParse(candidate);
  return { value: second.success ? (second.data as ContentValue<K>) : null, issues };
}

export async function getContentState<K extends ContentKey>(key: K): Promise<ContentState<K>> {
  const row = (await loadAll()).get(key);
  if (row) {
    const { value, issues } = parseStored(key, row.value);
    if (value && issues.length) {
      log.warn("content", `stored "${key}" has fields that fail its schema; rendering their defaults (save /admin/content/${key} to fix)`, issues);
    }
    if (value) return { key, value, stored: true, updatedAt: row.updatedAt };
    log.warn("content", `stored "${key}" fails its schema; rendering the default`, issues);
  }
  return { key, value: DEFAULT_CONTENT[key], stored: false, updatedAt: null };
}

/** What a page renders for one section. */
export async function getContent<K extends ContentKey>(key: K): Promise<ContentValue<K>> {
  return (await getContentState(key)).value;
}

export async function getAllContentStates(): Promise<ContentState<ContentKey>[]> {
  return Promise.all(CONTENT_KEY_LIST.map((k) => getContentState(k)));
}

/** Uncached read for writes, so a write never merges over a stale per-request value. */
async function readFresh<K extends ContentKey>(key: K): Promise<ContentState<K>> {
  const row = await (await getData()).content.get(key);
  if (row) {
    const { value } = parseStored(key, row.value);
    if (value) return { key, value, stored: true, updatedAt: row.updatedAt };
  }
  return { key, value: DEFAULT_CONTENT[key], stored: false, updatedAt: null };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Objects merge key by key; arrays and scalars replace. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

/**
 * Write a section. mode "replace" stores `value` as given; "merge" deep-merges
 * it over the current value (objects merge, arrays replace) — handy for an
 * agent changing one field. Either way the result must pass the schema.
 */
export async function updateContent(
  key: string,
  value: unknown,
  actor: Actor,
  mode: "replace" | "merge" = "replace",
): Promise<ContentState<ContentKey>> {
  assertNotDemo(actor);
  if (!isContentKey(key)) throw new ServiceError("not_found", `Unknown content key "${key}". Keys: ${CONTENT_KEY_LIST.join(", ")}`);
  const before = await readFresh(key);
  const candidate = mode === "merge" ? deepMerge(before.value, value) : value;
  const next = parseInput(CONTENT_KEYS[key].schema, candidate);
  const saved = await (await getData()).content.set(key, next);
  await recordAudit(actor, "content.update", "content", key, before.stored ? before.value : null, next);
  return { key, value: next as ContentValue<ContentKey>, stored: true, updatedAt: saved.updatedAt };
}

/** Forget the stored value; the section renders its default again. */
export async function resetContent(key: string, actor: Actor): Promise<ContentState<ContentKey>> {
  assertNotDemo(actor);
  if (!isContentKey(key)) throw new ServiceError("not_found", `Unknown content key "${key}"`);
  const before = await readFresh(key);
  await (await getData()).content.delete(key);
  await recordAudit(actor, "content.reset", "content", key, before.stored ? before.value : null, null);
  return { key, value: DEFAULT_CONTENT[key], stored: false, updatedAt: null };
}
