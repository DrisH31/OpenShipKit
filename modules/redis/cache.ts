import "server-only";

//
// The cache seam: one interface, an in-memory default, and a Redis/Valkey
// implementation (./redis-cache.ts) behind the same shape.
//
//   const cache = getCache();
//   const hit = await cache.get<Report>(`report:${id}`);
//   if (hit) return hit;
//   const report = await buildReport(id);          // the source of truth: Postgres
//   await cache.set(`report:${id}`, report, 60);
//
//   await cache.delete(`report:${id}`);            // on write
//   await cache.deleteByPrefix("report:");         // SCAN on Redis, never KEYS
//
// getCache() picks the adapter from REDIS_URL, per process, the first time it
// is called: every route bundle and the instrumentation hook share it through
// globalThis, so no request can see the memory cache while another sees Redis.
//
// Rules for anything you put here:
//  - It is a CACHE. Nothing in it is the only copy; everything has a TTL; losing
//    the Redis instance must be survivable by definition. Something you can't
//    rebuild from Postgres belongs in a table.
//  - get() never throws and returns null on a miss OR an outage: the right
//    response to both is "read the database". Writes fail silently for the
//    same reason. A cache that can fail a request is worse than no cache.
//  - Values are JSON: a Date comes back as a string.
//  - Single-flight (one query for a burst of misses) is per process and stays
//    yours: N replicas with a cold key still issue N queries.
//

import { redisConfig } from "./config";
import { createRedisCache } from "./redis-cache";

export interface CacheAdapter {
  readonly kind: "memory" | "redis";
  get<T>(key: string): Promise<T | null>;
  /** A TTL is mandatory: an unbounded key is a second, worse database nobody migrates or backs up. */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Everything under a prefix. Prefer deleting the keys you know; this is for when you don't. */
  deleteByPrefix(prefix: string): Promise<void>;
  /**
   * Add one to a counter and return the new value; the TTL is set on the
   * first increment only (a FIXED window — extending it on every hit turns a
   * limit into a ban for a caller who never stops). Null when the backend
   * can't answer: the caller decides what that means (./rate-limit.ts).
   */
  increment(key: string, ttlSeconds: number): Promise<number | null>;
  /** Can the backend be reached? For a health check or a boot log. */
  ping(): Promise<boolean>;
}

type Entry = { value: unknown; expiresAt: number };

/** The most keys the memory cache holds; past it, expired keys go first, then the oldest tenth. */
export const MEMORY_CACHE_MAX_KEYS = 10_000;

/**
 * The default: correct for one server, faster than any network hop, nothing
 * to run. Expiry is lazy (checked on read) with a size cap, so a workload
 * that writes many keys and never reads them can't grow it without bound.
 * JSON round-trip on set, like Redis: callers can't mutate a cached object in
 * place, and what works here works there.
 */
export function createMemoryCache(maxKeys = MEMORY_CACHE_MAX_KEYS): CacheAdapter {
  const store = new Map<string, Entry>();

  function makeRoom(now: number): void {
    if (store.size < maxKeys) return;
    for (const [k, e] of store) if (e.expiresAt <= now) store.delete(k);
    if (store.size < maxKeys) return;
    let drop = Math.ceil(maxKeys * 0.1);
    for (const k of store.keys()) {
      if (drop-- <= 0) break;
      store.delete(k);
    }
  }

  function live(key: string, now: number): Entry | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      store.delete(key);
      return null;
    }
    return entry;
  }

  return {
    kind: "memory",
    async get<T>(key: string) {
      const entry = live(key, Date.now());
      return entry ? (JSON.parse(entry.value as string) as T) : null;
    },
    async set<T>(key: string, value: T, ttlSeconds: number) {
      const now = Date.now();
      store.delete(key); // re-insert, so Map order stays oldest-first for makeRoom()
      makeRoom(now);
      store.set(key, { value: JSON.stringify(value), expiresAt: now + Math.max(1, ttlSeconds) * 1000 });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async deleteByPrefix(prefix: string) {
      for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
    },
    async increment(key: string, ttlSeconds: number) {
      const now = Date.now();
      const entry = live(key, now);
      if (!entry) {
        makeRoom(now);
        store.set(key, { value: "1", expiresAt: now + Math.max(1, ttlSeconds) * 1000 });
        return 1;
      }
      const next = Number(entry.value) + 1;
      entry.value = String(next);
      return next;
    },
    async ping() {
      return true;
    },
  };
}

const g = globalThis as unknown as { __openshipkitCache?: { url: string | null; adapter: CacheAdapter } };

/** The cache for this process: Redis/Valkey when REDIS_URL is set, memory otherwise. */
export function getCache(): CacheAdapter {
  const config = redisConfig();
  if (g.__openshipkitCache && g.__openshipkitCache.url === config.url) return g.__openshipkitCache.adapter;
  // Nothing connects here: the Redis client dials on its first command.
  const adapter = config.url ? createRedisCache(config) : createMemoryCache();
  g.__openshipkitCache = { url: config.url, adapter };
  return adapter;
}
