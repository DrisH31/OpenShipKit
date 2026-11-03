import "server-only";

//
// The redis module's settings, read lazily (see modules/shared/config.ts).
//
// One variable decides everything: with no REDIS_URL the cache and the shared
// limiter are in-memory — not a degraded mode, the correct setting for one
// server, which is how OpenShipKit deploys. Set it when you run more than one
// replica (modules/redis/README.md, "Do you need this?").
//
// Any server that speaks the Redis protocol works — Redis or Valkey that you
// run yourself (docker compose, Dokploy, Coolify), or any host's. No hosted
// Redis company is needed or assumed.
//

import { optionalEnv } from "@/server/env";
import { boolEnv, intEnv } from "../shared/config";

export interface RedisConfig {
  /** redis://[user:password@]host[:port][/db] or rediss:// (TLS). Null = in-memory. */
  url: string | null;
  /**
   * Put in front of every key. Not optional in practice: Redis has no
   * per-app isolation beyond numbered databases, so two deployments sharing
   * one (staging and production) read each other's cache unless the prefixes
   * differ.
   */
  keyPrefix: string;
  /** How long a command may take before it counts as a miss. Short on purpose: a cache slower than the database it fronts is worse than none. */
  commandTimeoutMs: number;
  /**
   * When Redis can't be reached, does the shared limiter allow (true) or
   * refuse (false)? Open turns an outage into a short absence of limiting
   * (right for sign-in and forms); closed turns it into refusals (maybe right
   * for something that spends money per call). Logged loudly either way.
   */
  failOpen: boolean;
}

export function redisConfig(): RedisConfig {
  const url = optionalEnv("REDIS_URL") ?? null;
  if (url && !/^rediss?:\/\//i.test(url)) throw new Error('REDIS_URL must start with "redis://" or "rediss://".');
  return {
    url,
    keyPrefix: optionalEnv("REDIS_KEY_PREFIX") ?? "openshipkit:",
    commandTimeoutMs: intEnv("REDIS_COMMAND_TIMEOUT_MS", 250, { min: 20, max: 10_000 }),
    failOpen: boolEnv("REDIS_FAIL_OPEN", true),
  };
}
