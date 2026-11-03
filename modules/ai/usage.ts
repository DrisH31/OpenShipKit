import "server-only";

//
// Who may generate, and the refundable daily quota — the paywall seam.
//
// The policy, in order:
//   1. Holds a plan in AI_UNMETERED_PLANS (hasPlan(), src/server/services/billing.ts:
//      webhook-written rows only, and "Everything in Pro" counts as Pro) → unmetered.
//   2. AI_FREE_CALLS_PER_DAY = 0 → refused: plan holders only.
//   3. Otherwise one atomic increment against today's (UTC) allowance; refused when used up.
//
// Billing needs no wiring here: OpenShipKit's billing is in the core, and with
// Polar off nobody holds a plan, so step 3 is the whole policy. Entitlement is
// a local database read, so there is no "couldn't check" state to answer with
// a 503 — a failed query throws and the request fails honestly.
//
// A reservation is refundable: only a DELIVERED answer costs a free call. The
// service releases it when the provider fails, times out or the caller leaves.
//
// The store follows the data registry: memory under DATA_PROVIDER=memory,
// otherwise the Postgres adapter — after getData(), which readies (migrates)
// the embedded development database. Old rows are swept hourly by one timer
// per process (on globalThis, so hot reloads and Next's separate route
// bundles don't stack up timers), unref'd so it never holds a process open.
//

import { dataProvider } from "@/server/env";
import { getData } from "@/server/data";
import { hasPlan } from "@/server/services/billing";
import { ServiceError } from "@/server/services/errors";
import type { AiConfig } from "./config";
import { createMemoryUsageStore, secondsUntilUtcMidnight, utcDay, type AiUsageStore } from "./usage-store";

/** Days of usage kept for "was this person limited on Tuesday?". */
const RETENTION_DAYS = 7;
const SWEEP_EVERY_MS = 60 * 60_000;

const g = globalThis as unknown as {
  __openshipkitAiUsage?: { provider: string; store: Promise<AiUsageStore> };
  __openshipkitAiSweep?: ReturnType<typeof setInterval>;
};

async function load(provider: string): Promise<AiUsageStore> {
  if (provider === "memory") return createMemoryUsageStore();
  const { createPostgresUsageStore } = await import("./usage-postgres");
  return createPostgresUsageStore();
}

/** The ledger for this process. */
export async function getUsageStore(): Promise<AiUsageStore> {
  const provider = dataProvider();
  if (g.__openshipkitAiUsage?.provider !== provider) {
    const store = load(provider);
    g.__openshipkitAiUsage = { provider, store };
    store.catch(() => {
      if (g.__openshipkitAiUsage?.store === store) g.__openshipkitAiUsage = undefined; // retry next time
    });
  }
  if (provider !== "memory") await getData(); // readies the embedded database (no-op on a server)
  const store = await g.__openshipkitAiUsage!.store;
  startSweep();
  return store;
}

function startSweep(): void {
  if (g.__openshipkitAiSweep) return;
  g.__openshipkitAiSweep = setInterval(() => {
    const before = utcDay(new Date(Date.now() - RETENTION_DAYS * 86_400_000));
    // Whatever store the process uses now; a failed pass is harmless, the next hour retries.
    g.__openshipkitAiUsage?.store
      .then((store) => store.sweep(before))
      .catch((error: unknown) => console.error("[ai] usage sweep failed:", error instanceof Error ? error.message : error));
  }, SWEEP_EVERY_MS);
  g.__openshipkitAiSweep.unref?.();
}

export interface AiReservation {
  /** False for plan holders: nothing was counted, nothing to give back. */
  metered: boolean;
  /** Free calls left today after this one (null when unmetered). */
  remaining: number | null;
  /** Give the call back. Safe to call more than once. */
  release(): Promise<void>;
}

const UNMETERED: AiReservation = { metered: false, remaining: null, release: async () => {} };

export async function isUnmetered(userId: string, config: AiConfig): Promise<boolean> {
  return config.unmeteredPlans.length > 0 && (await hasPlan(userId, config.unmeteredPlans));
}

/**
 * Reserve one generation for `userId`, or throw ServiceError: "forbidden"
 * (plan holders only) or "rate_limited" (today's free calls are used; carries
 * retryAfterSeconds until UTC midnight).
 */
export async function reserveGeneration(userId: string, config: AiConfig, now = new Date()): Promise<AiReservation> {
  if (await isUnmetered(userId, config)) return UNMETERED;
  if (config.freeCallsPerDay === 0) {
    throw new ServiceError("forbidden", "AI is part of a paid plan. Upgrade to use it.", { reason: "plan_required" });
  }
  const day = utcDay(now);
  const store = await getUsageStore();
  const count = await store.reserve(userId, day, config.freeCallsPerDay);
  if (count === null) {
    throw new ServiceError(
      "rate_limited",
      config.unmeteredPlans.length > 0
        ? "You’ve used today’s free AI requests. Upgrade for unlimited use, or come back tomorrow."
        : "You’ve used today’s AI requests. They reset at midnight UTC.",
      { reason: "daily_quota", retryAfterSeconds: secondsUntilUtcMidnight(now) },
    );
  }
  let released = false;
  return {
    metered: true,
    remaining: Math.max(0, config.freeCallsPerDay - count),
    release: async () => {
      if (released) return;
      released = true;
      await store.release(userId, day);
    },
  };
}

/** For the UI: is this person unmetered, and how many free calls are left today. */
export async function usageSummary(
  userId: string,
  config: AiConfig,
  now = new Date(),
): Promise<{ unmetered: boolean; freePerDay: number; usedToday: number; remainingToday: number | null; resetsInSeconds: number }> {
  const resetsInSeconds = secondsUntilUtcMidnight(now);
  if (await isUnmetered(userId, config)) {
    return { unmetered: true, freePerDay: config.freeCallsPerDay, usedToday: 0, remainingToday: null, resetsInSeconds };
  }
  const usedToday = await (await getUsageStore()).used(userId, utcDay(now));
  return {
    unmetered: false,
    freePerDay: config.freeCallsPerDay,
    usedToday,
    remainingToday: Math.max(0, config.freeCallsPerDay - usedToday),
    resetsInSeconds,
  };
}
