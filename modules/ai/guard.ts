import "server-only";

//
// The guard chain every AI-spending call runs, in this order — the order is
// the point:
//
//   1. CONCURRENCY  in memory, free, instant (./concurrency.ts). Refusing here
//                   costs nothing, so under a stampede 2 and 3 never run.
//   2. RATE LIMIT   per person per minute (./rate-limit.ts — the app's limiter,
//                   or modules/redis's shared one).
//   3. QUOTA        the daily allowance (./usage.ts), the only REFUNDABLE step,
//                   so it goes last: nothing to unwind if 1 or 2 refuse.
//
// Acquire-then-release-on-failure is written out here rather than left to each
// caller, because the leak it prevents is silent: a slot taken and not given
// back when the limiter throws doesn't error, it lowers the ceiling by one for
// good, and after enough refusals nobody is served. Callers still release in a
// `finally` (./service.ts).
//
// Refusals become ServiceErrors the routes already know how to answer
// (modules/shared/api.ts): "unavailable" 503 and "rate_limited" 429, each with
// retryAfterSeconds for the Retry-After header.
//

import { ServiceError } from "@/server/services/errors";
import type { AiConfig } from "./config";
import { acquireAiSlot, AiBusyError } from "./concurrency";
import { AiRateLimitError, assertAiRateLimit } from "./rate-limit";
import { reserveGeneration, type AiReservation } from "./usage";

export interface AiPermit {
  reservation: AiReservation;
  /** Give the concurrency slot back. Idempotent. */
  releaseSlot: () => void;
}

function asServiceError(error: unknown): unknown {
  if (error instanceof AiBusyError) {
    return new ServiceError("unavailable", error.message, { reason: "busy", retryAfterSeconds: error.retryAfterSeconds });
  }
  if (error instanceof AiRateLimitError) {
    return new ServiceError("rate_limited", error.message, { reason: "rate_limit", retryAfterSeconds: error.retryAfterSeconds });
  }
  return error;
}

/** Slot + rate limit, and NO quota — for calls that cost money but don't generate (embedding a document, a search). */
export async function acquireAiBudget(userId: string, config: AiConfig): Promise<() => void> {
  let release: (() => void) | undefined;
  try {
    release = acquireAiSlot(userId, config.maxConcurrent, config.maxConcurrentPerUser);
    await assertAiRateLimit(userId, config.rateLimitPerMinute);
    return release;
  } catch (error) {
    release?.();
    throw asServiceError(error);
  }
}

/** Slot + rate limit + a refundable quota reservation — for anything that GENERATES. */
export async function acquireAiGeneration(userId: string, config: AiConfig): Promise<AiPermit> {
  const releaseSlot = await acquireAiBudget(userId, config);
  try {
    return { reservation: await reserveGeneration(userId, config), releaseSlot };
  } catch (error) {
    releaseSlot();
    throw error;
  }
}

/**
 * Seconds left for the upstream call: the smaller of the per-call ceiling and
 * what remains of the request's total deadline. A request that spent 40 s
 * waiting on a busy database gets what's left, not a fresh 60 — by then the
 * proxy in front of the app has given up and the answer is paid for and lost.
 * Throws "unavailable" when under a second is left.
 */
export function secondsLeft(deadline: number, config: AiConfig): number {
  const left = Math.min(config.requestTimeoutSeconds, Math.floor((deadline - Date.now()) / 1000));
  if (left < 1) throw new ServiceError("unavailable", "The AI request ran out of time before it could start.", { reason: "deadline", retryAfterSeconds: 5 });
  return left;
}
