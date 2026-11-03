import "server-only";

//
// The embedded database's boot: apply /drizzle migrations to PGlite and, on a
// brand-new database, insert the starter plans and posts. Called once per
// server start from src/instrumentation.ts, before any request is served
// (and again, as a no-op, by getData()). A no-op on a real Postgres server
// (DATABASE_URL), where `npm run db:migrate` / the compose `migrate` service
// own migrations.
//
// Rules:
//  - One boot per process and migration set: the promise is kept on
//    globalThis with the latest migration's tag, so concurrent callers
//    (instrumentation, the first requests, a second Next server layer) share
//    it, and a migration added while `npm run dev` runs is applied on the
//    next call after a reload instead of needing a restart. A failed boot is
//    forgotten and closes the connection, so the next call retries.
//  - One process per data directory: opening it takes a lock (./lock.ts);
//    a second process fails with a message naming the one that holds it.
//  - Skipped while `next build` runs (NEXT_PHASE=phase-production-build): the
//    build needs no database, and its parallel workers must not open one.
//  - "Fresh" = no plans and no posts. The starter content is inserted once;
//    deleting it in /admin keeps it deleted. `npm run db:seed` re-adds
//    anything missing.
//

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { closeDrizzle, getEmbeddedClient, isEmbeddedDatabase, pgliteDir } from "./db";
import { createPostgresStore } from "./index";
import { seedDatabase } from "@/server/seed";
import { log } from "@/server/log";

const g = globalThis as unknown as { __openshipkitEmbeddedReady?: Promise<void>; __openshipkitEmbeddedMigrations?: string };

/** The SQL migrations folder (/drizzle, relative to the working directory). */
export function migrationsFolder(): string {
  return resolve("drizzle");
}

/** The latest migration's tag in /drizzle/meta/_journal.json ("" when unreadable). */
function latestMigration(): string {
  try {
    const journal = JSON.parse(readFileSync(resolve(migrationsFolder(), "meta/_journal.json"), "utf8")) as { entries?: { tag?: string }[] };
    return journal.entries?.at(-1)?.tag ?? "";
  } catch {
    return "";
  }
}

/**
 * Apply pending /drizzle migrations to a PGlite client (the embedded
 * database, or an in-memory one in tests). Idempotent.
 */
export async function migrateEmbedded(client: PGlite): Promise<void> {
  const folder = migrationsFolder();
  if (!existsSync(resolve(folder, "meta/_journal.json"))) {
    throw new Error(`No migrations at ${folder}. Run the app from the project root (the folder with package.json and drizzle/).`);
  }
  try {
    await client.waitReady;
  } catch (error) {
    throw new Error(
      `Could not open the embedded database at ${pgliteDir()}: ${error instanceof Error ? error.message : String(error)}. ` +
        `If it was made by an older version of PGlite, move that folder aside (or delete it to start over) and restart.`,
      { cause: error },
    );
  }
  await migrate(drizzle({ client }), { migrationsFolder: folder });
}

/** Migrate the embedded database and seed it on first boot. Resolves immediately with DATABASE_URL set. */
export function prepareEmbeddedDatabase(): Promise<void> {
  if (!isEmbeddedDatabase() || process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
  const migrations = latestMigration();
  if (g.__openshipkitEmbeddedReady && g.__openshipkitEmbeddedMigrations !== migrations) {
    // A migration was added since the last boot: run again once the previous boot settles.
    const previous = g.__openshipkitEmbeddedReady.catch(() => {});
    g.__openshipkitEmbeddedReady = previous.then(() => boot());
  }
  g.__openshipkitEmbeddedMigrations = migrations;
  return (g.__openshipkitEmbeddedReady ??= boot());
}

function boot(): Promise<void> {
  return (async () => {
    const client = getEmbeddedClient();
    if (!client) return;
    const started = Date.now();
    await migrateEmbedded(client);
    const store = createPostgresStore();
    const fresh = (await store.plans.list()).length === 0 && (await store.posts.list({ limit: 1 })).items.length === 0;
    if (fresh) await seedDatabase(store);
    log.info(
      "db",
      `embedded Postgres ready at ${pgliteDir()} in ${Date.now() - started} ms${fresh ? " (seeded)" : ""}. Set DATABASE_URL to use a Postgres server.`,
    );
  })().catch(async (error: unknown) => {
    g.__openshipkitEmbeddedReady = undefined;
    await closeDrizzle().catch(() => {}); // drop a half-open client and its lock; the next call starts clean
    throw error;
  });
}
