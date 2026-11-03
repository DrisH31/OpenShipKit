import "server-only";

//
// The per-person, per-minute limit on AI requests — and the one-line seam for
// sharing it across replicas.
//
// As shipped it uses the app's own limiter (src/server/rate-limit.ts):
// in-process, correct for one server, which is how OpenShipKit deploys. Behind
// several replicas an in-process counter multiplies by the replica count, so
// a limit of 20 quietly becomes 40. The daily quota (./usage.ts) is in
// Postgres and stays exact either way; this is the short-window brake.
//
// With modules/redis enabled, swap the import below for its shared limiter —
// same arguments, same answer, one counter for every replica:
//
//   import { sharedRateLimit as limit } from "../redis/rate-limit";
//
// Nothing else changes: the call is awaited, so a synchronous limiter works too.
//

import { rateLimit as limit } from "@/server/rate-limit";

export class AiRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many AI requests. Slow down and try again in a minute.");
    this.name = "AiRateLimitError";
  }
}

/** Count one request for `userId`; throws AiRateLimitError when over `perMinute`. */
export async function assertAiRateLimit(userId: string, perMinute: number): Promise<void> {
  const { ok, retryAfterSeconds } = await limit(`ai:${userId}`, perMinute, 60_000);
  if (!ok) throw new AiRateLimitError(Math.max(1, retryAfterSeconds));
}
