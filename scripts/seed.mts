//
// npm run db:seed — insert the starter plans and posts (src/content/seed.ts)
// into the database: your Postgres (DATABASE_URL), or the embedded one at
// PGLITE_DIR when DATABASE_URL is unset (stop `npm run dev` first; it seeds
// a brand-new embedded database on boot anyway).
// The logic lives in src/server/seed.ts, shared with the embedded first boot.
//
// Runs once per database. The first run writes a marker to the audit log
// (entity "seed"); every later run sees it and adds nothing, so a starter post
// or plan you deleted in /admin stays deleted, even though the Docker migrator
// runs this on every deploy.
//
//   npm run db:seed               seed a database that has never been seeded
//   npm run db:seed -- --force    add back any starter plan or post that is
//                                 missing (by key, or by kind and slug)
//
// Neither ever overwrites an edit you made in /admin. Each insert is written
// to the audit log as actor "seed".
//
// Run as `node --conditions=react-server --import tsx scripts/seed.mts`
// (the package.json script does this). Reads .env.local / .env when the
// variables aren't already set. A Postgres server needs `npm run db:migrate` first.
//

import { parseArgs } from "node:util";
import { dataProvider } from "@/server/env";
import { seedDatabase } from "@/server/seed";
import { loadLocalEnv } from "./load-env.mjs";

/** The command line: `--force` only. An unknown flag throws, so a typo never seeds silently. */
function parseFlags(argv: string[]): { force: boolean } {
  const { values } = parseArgs({ args: argv, options: { force: { type: "boolean", default: false } }, strict: true });
  return { force: values.force };
}

async function main(argv: string[]): Promise<number> {
  const { force } = parseFlags(argv);
  loadLocalEnv("db:seed");
  const provider = dataProvider();
  if (provider === "memory") {
    console.log("DATA_PROVIDER is memory: the in-memory store seeds itself on every boot, so there is nothing to write.");
    return 0;
  }
  const { closeDrizzle, getEmbeddedClient, isEmbeddedDatabase, pgliteDir } = await import("@/adapters/data/postgres/db");
  if (isEmbeddedDatabase()) {
    // One process at a time: opening it fails with a clear message while `npm run dev` holds it.
    console.log(`DATABASE_URL is not set: seeding the embedded database at ${pgliteDir()} (stop \`npm run dev\` first).`);
    const client = getEmbeddedClient();
    if (client) {
      const { migrateEmbedded } = await import("@/adapters/data/postgres/embedded");
      await migrateEmbedded(client); // a brand-new embedded database has no tables yet
    }
  } else {
    console.log("Seeding Postgres…");
  }
  if (force) console.log("--force: adding back any starter plan or post that is missing.");
  const { createPostgresStore } = await import("@/adapters/data/postgres");
  const data = createPostgresStore();
  const health = await data.health();
  if (!health.ok) throw new Error(`The database isn't reachable: ${health.detail ?? "no detail"}`);
  const { plans, posts, skipped, alreadySeeded } = await seedDatabase(data, console.log, { force });
  if (alreadySeeded) {
    console.log("Done: skipped (already seeded).");
  } else {
    console.log(`Done: ${plans} plan${plans === 1 ? "" : "s"} and ${posts} post${posts === 1 ? "" : "s"} added${skipped ? `, ${skipped} already present` : ""}.`);
  }

  await closeDrizzle();
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Drizzle wraps the driver's error ("Failed query: …"); its cause holds the real reason.
    const e = error as { message?: string; cause?: { message?: string } };
    const message = e.message ?? String(error);
    console.error("Seed failed:", message.startsWith("Failed query") && e.cause?.message ? e.cause.message : message);
    process.exit(1);
  },
);
