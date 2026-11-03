//
// Apply modules/rag/migration.sql directly — for a database where the Drizzle
// migration already ran WITHOUT pgvector (it skips itself with a warning and is
// still recorded as applied, so `npm run db:migrate` won't run it again).
//
//   node --conditions=react-server --import tsx modules/rag/apply-migration.mts
//
// DATABASE_URL set → that Postgres server; unset → the embedded database
// (stop `npm run dev` first: one process at a time). Every statement is
// IF NOT EXISTS, so running it on a database that already has the tables
// changes nothing. Exits non-zero when the tables still aren't there (no
// pgvector yet: see modules/rag/README.md, "Enable", steps 2 and 3).
//

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { closeDrizzle, getDrizzle } from "@/adapters/data/postgres/db";
import { loadLocalEnv } from "../../scripts/load-env.mjs";

loadLocalEnv("rag");

const file = fileURLToPath(new URL("./migration.sql", import.meta.url));
const db = getDrizzle();
try {
  await db.execute(sql.raw(readFileSync(file, "utf8")));
  const result = await db.execute<{ ok: boolean }>(sql`select to_regclass('public.rag_chunks') is not null as ok`);
  if (!result.rows[0]?.ok) {
    console.error("rag: pgvector isn't available on this database, so the tables weren't created. See modules/rag/README.md.");
    process.exitCode = 1;
  } else {
    console.info("rag: tables ready.");
  }
} catch (error) {
  console.error("rag: applying the migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDrizzle();
}
