import "server-only";

//
// Typed readers for the modules' environment variables, over the app's own
// optionalEnv() (src/server/env.ts). Every module reads its settings through
// these, lazily, inside a function — never at module scope — so `next build`
// needs none of them (SPEC §3.2), and a bad value fails the first request that
// needs it with a message naming the variable, not a NaN three calls later.
//
// A variable that is set but blank counts as unset (readEnv in
// src/server/env-rules.ts already trims), so `.env.example` can list a key
// with an empty value to document its default without changing it.
//
// Call sites pass the variable NAME as a string literal: tests/env-example.test.ts
// finds reads by that pattern once a module's code is in the app.
//

import { optionalEnv } from "@/server/env";

/** A whole number in [min, max], or `fallback` when unset. Throws on anything else. */
export function intEnv(name: string, fallback: number, { min = 1, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}): number {
  const raw = optionalEnv(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max} (got "${raw}"). See the module’s README.`);
  }
  return value;
}

/** true/false (also 1/0, yes/no), or `fallback` when unset. */
export function boolEnv(name: string, fallback: boolean): boolean {
  const raw = optionalEnv(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  throw new Error(`${name} must be true or false (got "${raw}").`);
}

/** A comma-separated list, trimmed, empties dropped. `fallback` when unset. */
export function listEnv(name: string, fallback: readonly string[] = []): string[] {
  const raw = optionalEnv(name);
  if (raw === undefined) return [...fallback];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * An absolute http(s) URL without a trailing slash (so `${base}/path` never
 * doubles one), or `fallback` when unset.
 */
export function urlEnv(name: string, fallback?: string): string | undefined {
  const raw = optionalEnv(name) ?? fallback;
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL like https://example.com/v1 (got "${raw}").`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must use http or https.`);
  return url.toString().replace(/\/+$/, "");
}
