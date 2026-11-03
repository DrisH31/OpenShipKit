import "server-only";

//
// A fixed-window rate limiter that is correct across replicas.
//
//   const { ok, retryAfterSeconds } = await sharedRateLimit(`export:${user.id}`, 10, 60_000);
//
// Same arguments and the same answer as the app's rateLimit()
// (src/server/rate-limit.ts), plus `degraded`. Without REDIS_URL it counts in
// this process (the memory cache) — exactly what rateLimit() does. With it,
// every replica shares one counter: two replicas with a limit of 5 allow 5,
// not 10. (In-process counters multiply by the replica count, silently: the
// config still says 5 and the logs still say "rate limited".)
//
// The window number is part of the KEY, so expiry and reset are the same
// event. A fixed window lets a caller spend one window's allowance at its last
// second and the next one's at the first — fine at these limits; for something
// expensive, use a shorter window rather than a cleverer algorithm.
//
// When Redis can't be reached the count is unknown: REDIS_FAIL_OPEN decides
// (allow, the default — or refuse), the verdict says `degraded: true`, and it
// is logged. Key on something an attacker can't cheaply rotate: a user id, or
// clientIp() (src/server/rate-limit.ts — IPv6 bucketed by /64). Never a header
// the client controls.
//

import { getCache } from "./cache";
import { redisConfig } from "./config";

export interface SharedRateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (0 when allowed). Send it as Retry-After on a refusal. */
  retryAfterSeconds: number;
  /** Requests left in this window; null when the backend couldn't answer. */
  remaining: number | null;
  /** The verdict came from REDIS_FAIL_OPEN, not a count. Worth a metric: a week of this is a limiter that isn't limiting. */
  degraded: boolean;
}

/** At most one "backend unavailable" line per minute per process: an outage must not log per request. */
const g = globalThis as unknown as { __openshipkitRateLimitWarnedAt?: number };
const WARN_EVERY_MS = 60_000;

export async function sharedRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<SharedRateLimitResult> {
  const window = Math.floor(now / windowMs);
  const resetIn = Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000));
  const count = await getCache().increment(`ratelimit:${key}:${window}`, Math.ceil(windowMs / 1000));

  if (count === null) {
    const { failOpen } = redisConfig();
    if (!g.__openshipkitRateLimitWarnedAt || Date.now() - g.__openshipkitRateLimitWarnedAt >= WARN_EVERY_MS) {
      g.__openshipkitRateLimitWarnedAt = Date.now();
      console.error(`[ratelimit] backend unavailable: ${failOpen ? "allowing requests (REDIS_FAIL_OPEN=true)" : "refusing requests (REDIS_FAIL_OPEN=false)"}`);
    }
    return { ok: failOpen, retryAfterSeconds: failOpen ? 0 : resetIn, remaining: null, degraded: true };
  }
  const ok = count <= limit;
  return { ok, retryAfterSeconds: ok ? 0 : resetIn, remaining: Math.max(0, limit - count), degraded: false };
}
