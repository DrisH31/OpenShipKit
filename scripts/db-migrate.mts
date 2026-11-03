//
// npm run db:migrate — apply the SQL migrations in /drizzle.
//
//   DATABASE_URL set     migrates that Postgres server (what a deploy runs).
//   DATABASE_URL unset   migrates the embedded database at PGLITE_DIR
//                        (default .data/pglite). Stop `npm run dev` first: the
//                        embedded database allows one process at a time (the
//                        dev server migrates it on boot anyway).
//
// Safe to run on every deploy: already-applied migrations are skipped
// (drizzle records them in drizzle.__drizzle_migrations), and each pending
// one runs in a transaction. Exits non-zero on failure so a deploy stops.
//
// Run as `node --conditions=react-server --import tsx scripts/db-migrate.mts`
// (the package.json script does this): the condition lets modules that
// import "server-only" load outside Next. Reads .env.local / .env when the
// variables aren't already set.
//

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDrizzle, createDrizzle, getDrizzle, getEmbeddedClient, pgliteDir, type Db } from "@/adapters/data/postgres/db";
import { migrateEmbedded } from "@/adapters/data/postgres/embedded";
import { loadLocalEnv } from "./load-env.mjs";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** The created_at (folder millis) of every applied migration, or [] before the first run. */
async function applied(db: Db): Promise<number[]> {
  const exists = await db.execute<{ t: string | null }>(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`);
  if (!exists.rows[0]?.t) return [];
  const rows = await db.execute<{ created_at: string }>(sql`select created_at::text from drizzle.__drizzle_migrations order by created_at`);
  return rows.rows.map((r) => Number(r.created_at));
}

function journal(): { tag: string; when: number }[] {
  const raw = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as { entries: { tag: string; when: number }[] };
  return raw.entries;
}

/** Host and database only: never print credentials. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname || "local socket"}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

interface Target {
  label: string;
  db: Db;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

function serverTarget(url: string): Target {
  const { db, close } = createDrizzle(url, { max: 1 });
  return { label: describeTarget(url), db, migrate: () => migrate(db, { migrationsFolder: MIGRATIONS }), close };
}

function embeddedTarget(): Target {
  const dir = pgliteDir();
  console.log(`DATABASE_URL is not set: migrating the embedded database at ${dir}.`);
  console.log("(It allows one process at a time: stop `npm run dev` first. Set DATABASE_URL to migrate a Postgres server instead.)");
  const client = getEmbeddedClient(); // takes the directory lock; throws if the dev server has it
  if (!client) throw new Error("The embedded database did not open.");
  return { label: `embedded ${dir}`, db: getDrizzle(), migrate: () => migrateEmbedded(client), close: closeDrizzle };
}

async function main(): Promise<void> {
  loadLocalEnv("db:migrate");
  const url = process.env.DATABASE_URL?.trim();
  const target = url ? serverTarget(url) : embeddedTarget();
  console.log(`Migrating ${target.label} from ./drizzle`);
  try {
    const before = new Set(await applied(target.db));
    const started = Date.now();
    await target.migrate();
    const after = await applied(target.db);
    const entries = journal();
    const ran = after.filter((when) => !before.has(when)).map((when) => entries.find((e) => e.when === when)?.tag ?? String(when));
    if (ran.length === 0) console.log(`Up to date: ${after.length} migration${after.length === 1 ? "" : "s"} already applied.`);
    else {
      for (const tag of ran) console.log(`  applied ${tag}`);
      console.log(`Done: ${ran.length} applied in ${Date.now() - started} ms (${after.length} total).`);
    }
  } finally {
    await target.close();
  }
}

/** The most specific message in an error's cause chain (drizzle wraps pg's error; a refused connection is an AggregateError). */
function explain(error: unknown): string {
  let e = error as { message?: string; code?: string; cause?: unknown; errors?: unknown[] } | undefined;
  let best = "";
  let code = "";
  for (let depth = 0; e && depth < 5; depth++) {
    if (e.message) best = e.message;
    if (e.code) code = e.code;
    e = (e.cause ?? e.errors?.[0]) as typeof e;
  }
  return code && !best.includes(code) ? `${best} (${code})` : best || String(error);
}

main().catch((error: unknown) => {
  console.error("Migration failed:", explain(error));
  process.exit(1);
});
