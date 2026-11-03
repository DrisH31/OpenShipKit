import "server-only";

//
// Which migration this build of the code expects the database to be on: the newest
// entry in drizzle's journal (drizzle/meta/_journal.json, bundled at build time).
// /api/health compares it with the newest migration the database has applied
// (DataStore.appliedMigration): behind means a deploy skipped `npm run db:migrate`,
// and queries for new columns would fail, so readiness says so first (503).
//

import journal from "../../drizzle/meta/_journal.json";

export const EXPECTED_MIGRATION: number = Math.max(...journal.entries.map((e) => e.when));

export type SchemaState = "current" | "behind" | "ahead";

/** Pure: how an applied migration (null: none recorded) compares with the expected one. */
export function schemaState(applied: number | null, expected = EXPECTED_MIGRATION): SchemaState {
  if (applied === null || applied < expected) return "behind";
  return applied > expected ? "ahead" : "current";
}
