import "server-only";

//
// The daily-quota ledger on Postgres: the `ai_usage` table from ./migration.sql.
// The adapter half of ./usage-store.ts, so it is the one file in modules/ai
// that talks to the database driver (through the app's shared Drizzle client;
// SPEC §2 keeps drivers in adapters, and this is this module's adapter).
//
// Raw SQL through Drizzle's `sql` tag rather than a pgTable: the table isn't in
// src/adapters/data/postgres/schema.ts, so drizzle-kit never generates a
// migration that would drop it, and the module stays one SQL file to apply.
// Days go in and out as "YYYY-MM-DD" text (to_char on the way out): a DATE
// read back as a JS Date lands on local midnight and is a day early anywhere
// west of UTC — here, a refund to the wrong day.
//

import { sql } from "drizzle-orm";
import { getDrizzle, type Db } from "@/adapters/data/postgres/db";
import { assertDay, type AiUsageStore } from "./usage-store";

/** `db` for tests (an in-memory PGlite); the app's shared client otherwise. */
export function createPostgresUsageStore(opts: { db?: Db } = {}): AiUsageStore {
  const db = (): Db => opts.db ?? getDrizzle();
  return {
    id: "postgres",
    async reserve(userId, day, limit) {
      assertDay(day);
      if (limit <= 0) return null;
      // The WHERE on DO UPDATE makes this atomic: the second of two racing
      // requests for the last call matches no row, and RETURNING comes back
      // empty — which IS the refusal.
      const result = await db().execute<{ count: number }>(sql`
        insert into ai_usage (user_id, day, count) values (${userId}, ${day}::date, 1)
        on conflict (user_id, day) do update set count = ai_usage.count + 1
        where ai_usage.count < ${limit}
        returning count`);
      const row = result.rows[0];
      return row ? Number(row.count) : null;
    },
    async release(userId, day) {
      assertDay(day);
      await db().execute(sql`
        update ai_usage set count = greatest(count - 1, 0)
        where user_id = ${userId} and day = ${day}::date`);
    },
    async used(userId, day) {
      assertDay(day);
      const result = await db().execute<{ count: number }>(sql`
        select count from ai_usage where user_id = ${userId} and day = ${day}::date`);
      return Number(result.rows[0]?.count ?? 0);
    },
    async sweep(before) {
      assertDay(before);
      const result = await db().execute<{ day: string }>(sql`
        delete from ai_usage where day < ${before}::date returning to_char(day, 'YYYY-MM-DD') as day`);
      return result.rows.length;
    },
  };
}
