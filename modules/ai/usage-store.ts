//
// The daily-quota ledger's contract, and its memory implementation.
//
// One counter per (person, UTC day). Two adapters, one contract
// (tests/modules/ai.test.ts runs the same suite on both):
//
//   memory     this file — the reference implementation; DATA_PROVIDER=memory and unit tests.
//   postgres   ./usage-postgres.ts — the `ai_usage` table (./migration.sql), on your
//              Postgres server or the embedded development database.
//
// The contract:
//  - reserve() decides AND records in one step: it adds one only while the day's
//    count is under `limit`, and returns the new count, or null when the day is
//    used up. A read-then-write version lets two tabs both take the last free
//    call; the Postgres adapter does it in one INSERT … ON CONFLICT … WHERE.
//  - release() gives one back for exactly the day reserved (a request that
//    finishes after midnight must not refund tomorrow), and never goes below 0.
//  - `day` is "YYYY-MM-DD" (UTC). A malformed day throws.
//  - sweep() deletes days before `before`; returns how many rows went.
//
// Pure: no server-only, no I/O — safe to import in tests.
//

export interface AiUsageStore {
  readonly id: "memory" | "postgres";
  reserve(userId: string, day: string, limit: number): Promise<number | null>;
  release(userId: string, day: string): Promise<void>;
  used(userId: string, day: string): Promise<number>;
  sweep(before: string): Promise<number>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for the UTC day of `at`. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Seconds until the next UTC midnight, when the quota resets (at least 1). */
export function secondsUntilUtcMidnight(at: Date = new Date()): number {
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - at.getTime()) / 1000));
}

export function assertDay(day: string): void {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new Error(`Not a UTC day: "${day}"`);
}

export function createMemoryUsageStore(): AiUsageStore {
  const counts = new Map<string, number>();
  const key = (userId: string, day: string) => `${day}\u0000${userId}`;
  return {
    id: "memory",
    async reserve(userId, day, limit) {
      assertDay(day);
      const k = key(userId, day);
      const current = counts.get(k) ?? 0;
      if (current >= limit) return null;
      counts.set(k, current + 1);
      return current + 1;
    },
    async release(userId, day) {
      assertDay(day);
      const k = key(userId, day);
      const current = counts.get(k);
      if (current !== undefined) counts.set(k, Math.max(0, current - 1));
    },
    async used(userId, day) {
      assertDay(day);
      return counts.get(key(userId, day)) ?? 0;
    },
    async sweep(before) {
      assertDay(before);
      let removed = 0;
      for (const k of counts.keys()) {
        if (k.slice(0, 10) < before) {
          counts.delete(k);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
