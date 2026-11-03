import "server-only";

//
// CacheAdapter over Redis or Valkey, through the small RESP client in ./resp.ts.
//
// EVERY METHOD FAILS SOFT: a read that can't reach the server is a miss (the
// caller reads Postgres), a write that can't is dropped, and increment()
// returns null so ./rate-limit.ts can apply REDIS_FAIL_OPEN. A Redis outage
// must never become a new way for the site to go down.
//
// Keys get REDIS_KEY_PREFIX. Values are JSON. Errors are logged with their
// message only, and connection failures once (by the client), not per call.
//

import type { CacheAdapter } from "./cache";
import type { RedisConfig } from "./config";
import { RespClient, RespError, type RespReply } from "./resp";

/**
 * INCR, and set the TTL only when the key is new — atomically, in one round
 * trip. (INCR then EXPIRE as two commands can leave a counter with no TTL if
 * the connection drops between them: a limit that never resets.)
 */
export const INCREMENT_SCRIPT =
  "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n";

/** Escape SCAN MATCH's glob characters, so a prefix is matched literally. */
export function escapeGlob(value: string): string {
  return value.replace(/[*?[\]\\]/g, (c) => `\\${c}`);
}

/**
 * Log a failed command — unless it is the connection itself, which the client
 * already reported (once, until it recovers). An outage must not write a log
 * line per request; a WRONGTYPE reply or a value that isn't our JSON should.
 */
function report(what: string, error: unknown): void {
  if (error instanceof RespError || error instanceof SyntaxError) {
    console.error(`[cache] ${what} failed: ${error.message}`);
  }
}

export function createRedisCache(config: RedisConfig, client?: RespClient): CacheAdapter {
  if (!config.url) throw new Error("createRedisCache needs REDIS_URL");
  const redis = client ?? new RespClient(config.url, { commandTimeoutMs: config.commandTimeoutMs });
  const k = (key: string) => `${config.keyPrefix}${key}`;
  const ttl = (seconds: number) => Math.max(1, Math.ceil(seconds));

  return {
    kind: "redis",
    async get<T>(key: string) {
      try {
        const raw = await redis.command(["GET", k(key)]);
        return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
      } catch (error) {
        // Includes a value that isn't our JSON: another app writing the same
        // keys — give the deployments different REDIS_KEY_PREFIX values.
        report("get", error);
        return null;
      }
    },
    async set<T>(key: string, value: T, ttlSeconds: number) {
      try {
        await redis.command(["SET", k(key), JSON.stringify(value), "EX", ttl(ttlSeconds)]);
      } catch (error) {
        report("set", error);
      }
    },
    async delete(key: string) {
      try {
        await redis.command(["DEL", k(key)]);
      } catch (error) {
        report("delete", error);
      }
    },
    async deleteByPrefix(prefix: string) {
      // SCAN, never KEYS: KEYS blocks the whole (single-threaded) server for
      // the entire traversal — seconds on a big instance, for every app on it.
      try {
        let cursor = "0";
        do {
          const reply = (await redis.command(["SCAN", cursor, "MATCH", `${escapeGlob(k(prefix))}*`, "COUNT", 200])) as RespReply[];
          cursor = String(reply[0]);
          const keys = (reply[1] as string[] | null) ?? [];
          if (keys.length > 0) await redis.command(["DEL", ...keys]);
        } while (cursor !== "0");
      } catch (error) {
        report("deleteByPrefix", error);
      }
    },
    async increment(key: string, ttlSeconds: number) {
      try {
        const n = await redis.command(["EVAL", INCREMENT_SCRIPT, 1, k(key), ttl(ttlSeconds)]);
        return typeof n === "number" ? n : Number(n);
      } catch (error) {
        report("increment", error);
        return null; // unknown, NOT zero — ./rate-limit.ts decides
      }
    },
    async ping() {
      try {
        return (await redis.command(["PING"])) === "PONG";
      } catch {
        return false;
      }
    },
  };
}
