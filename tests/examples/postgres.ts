//
// The examples' store contracts on a real Postgres server, when
// TEST_DATABASE_URL is set (as tests/data-contract.test.ts does): the app's
// migrations, then the example's own SQL. A pool of real connections, so a
// lock that's missing shows (PGlite runs one query at a time and can't).
//
// Each run gets its own database, next to TEST_DATABASE_URL's
// (<name>_ex_<random>), dropped when the suite closes it: fresh every time, so
// a changed migration.sql never meets a stale table, and never the database
// the app's contract suite truncates while files run in parallel. The role
// needs CREATEDB (CI's is the server's superuser).
//

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDrizzle, type Db } from "@/adapters/data/postgres/db";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export async function connectExample(example: "projects" | "usage-api"): Promise<{ db: Db; close: () => Promise<void> }> {
  const url = new URL(TEST_DATABASE_URL!);
  const name = `${(url.pathname.slice(1) || "postgres").replace(/[^A-Za-z0-9_]/g, "_")}_ex_${randomBytes(4).toString("hex")}`;
  url.pathname = `/${name}`;
  const admin = createDrizzle(TEST_DATABASE_URL!, { max: 1 });
  await admin.db.execute(sql.raw(`create database "${name}"`));
  await admin.close();
  const handle = createDrizzle(url.toString(), { max: 10 });
  const close = async () => {
    await handle.close();
    const drop = createDrizzle(TEST_DATABASE_URL!, { max: 1 });
    try {
      await drop.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    } finally {
      await drop.close();
    }
  };
  try {
    await migrate(handle.db as never, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    const file = fileURLToPath(new URL(`../../examples/${example}/migration.sql`, import.meta.url));
    for (const statement of readFileSync(file, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await handle.db.execute(sql.raw(statement));
  } catch (error) {
    // A broken migration (the case this per-run database is for) mustn't leave the database behind.
    await close();
    throw error;
  }
  return { db: handle.db, close };
}
