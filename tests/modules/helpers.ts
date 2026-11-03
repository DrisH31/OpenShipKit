//
// Shared by the opt-in module tests (tests/modules/*.test.ts): users, JSON
// requests to a route handler, a PGlite database with the app's migrations
// plus a module's SQL, and a deterministic fake embedding.
//
// No network: providers are stubbed with vi.stubGlobal("fetch", …); the redis
// tests talk to a fake server on 127.0.0.1.
//

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import type { User } from "@/core/types";

let seq = 0;

/** An app user (the shape getCurrentUser() returns) with a fresh UUID. */
export function user(overrides: Partial<User> = {}): User {
  seq += 1;
  return {
    id: crypto.randomUUID(),
    email: `person${seq}@example.com`,
    name: null,
    image: null,
    role: "user",
    banned: false,
    authProvider: "better-auth",
    authProviderUserId: `auth-${seq}`,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

export const ORIGIN = "http://localhost:3000";

/** A same-origin JSON request, as this site's own pages send it. */
export function jsonRequest(path: string, body: unknown, init: { method?: string; origin?: string | null } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function getRequest(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "GET" });
}

/** A module's migration.sql, split the way Drizzle's migrator splits it. */
export function moduleSql(module: "ai" | "rag"): string[] {
  const path = fileURLToPath(new URL(`../../modules/${module}/migration.sql`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function applyModuleSql(client: PGlite, module: "ai" | "rag"): Promise<void> {
  for (const statement of moduleSql(module)) await client.exec(statement);
}

/** FNV-1a, for spreading tokens over vector slots. */
function hash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A bag-of-words "embedding": texts that share words point the same way, so
 * cosine similarity behaves like a (crude) semantic search. Deterministic.
 */
export function fakeEmbedding(text: string, width: number): number[] {
  const v: number[] = new Array<number>(width).fill(0);
  for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) v[hash(token) % width] += 1;
  if (!v.some((n) => n !== 0)) v[0] = 1; // (not every(): its inferred type predicate would narrow v to 0[])
  return v;
}
