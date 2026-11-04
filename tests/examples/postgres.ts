//
// The examples' store contracts on a real Postgres server, when
// TEST_DATABASE_URL is set (as tests/data-contract.test.ts does): the app's
// migrations, then the example's own SQL. A pool of real connections, so a
// lock that's missing shows (PGlite runs one query at a time and can't).
// Its own database, next to TEST_DATABASE_URL's (<name>_examples, created on
// first use): the app's contract suite truncates TEST_DATABASE_URL before
// every test, and test files run in parallel.
//

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDrizzle, type Db } from "@/adapters/data/postgres/db";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Connect to TEST_DATABASE_URL's <name>_examples database, created and migrated if needed. Test files
 * run in parallel, so the whole setup runs under one session lock on a single admin connection: no
 * two files create or migrate it at once.
 */
export async function connectExample(example: "projects" | "usage-api"): Promise<{ db: Db; close: () => Promise<void> }> {
  const url = new URL(TEST_DATABASE_URL!);
  const name = `${url.pathname.slice(1) || "postgres"}_examples`.replace(/[^A-Za-z0-9_]/g, "_");
  url.pathname = `/${name}`;
  const admin = createDrizzle(TEST_DATABASE_URL!, { max: 1 });
  try {
    await admin.db.execute(sql`select pg_advisory_lock(hashtext('openshipkit-example-tests'))`);
    const found = await admin.db.execute<{ n: number }>(sql`select count(*)::int as n from pg_database where datname = ${name}`);
    if (!Number(found.rows[0]?.n)) await admin.db.execute(sql.raw(`create database "${name}"`));
    const handle = createDrizzle(url.toString(), { max: 10 });
    await migrate(handle.db as never, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    const file = fileURLToPath(new URL(`../../examples/${example}/migration.sql`, import.meta.url));
    for (const statement of readFileSync(file, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await handle.db.execute(sql.raw(statement));
    return handle;
  } finally {
    await admin.db.execute(sql`select pg_advisory_unlock(hashtext('openshipkit-example-tests'))`).catch(() => {});
    await admin.close();
  }
}
