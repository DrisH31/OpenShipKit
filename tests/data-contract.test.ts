//
// Runs the DataStore contract (tests/contract/describe-data-contract.ts) on
// every store OpenShipKit ships:
//
//   memory     always — the reference implementation.
//   pglite     always — the Postgres adapter on an in-memory PGlite with the
//              /drizzle migrations applied: the real SQL, no server needed.
//   postgres   when TEST_DATABASE_URL is set — a real Postgres server. The
//              suite migrates it and TRUNCATES every app table before each
//              test: point it at a throwaway database, never your app's.
//
//   npx vitest run tests/data-contract.test.ts
//   TEST_DATABASE_URL=postgres://localhost:5432/openshipkit_test npx vitest run tests/data-contract.test.ts
//
// Also here: the embedded database's boot (migrate + first-boot seed, on a
// temporary directory), its process lock, the `npm run db:seed` CLI (run for
// real on a temporary directory, with and without --force), and the pure SSL rules.
//

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import { createPostgresStore } from "@/adapters/data/postgres";
import { closeDrizzle, createDrizzle, drizzleOverPglite, resolveConnection, type Db } from "@/adapters/data/postgres/db";
import { migrateEmbedded, prepareEmbeddedDatabase } from "@/adapters/data/postgres/embedded";
import { acquireDirectoryLock, EmbeddedDatabaseLockedError } from "@/adapters/data/postgres/lock";
import { SEED } from "@/content/seed";
import { describeDataContract, describePostgresBehaviour, truncateAppTables } from "./contract/describe-data-contract";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

// ---------------------------------------------------------------- memory (always)

describeDataContract("memory", () => createMemoryStore({ fresh: true }));

// ---------------------------------------------------------------- pglite (always)

/** A fresh in-memory PGlite with the migrations applied, per suite. */
function pgliteSuite() {
  let client: PGlite | undefined;
  let db: Db | undefined;
  return {
    setup: async () => {
      client = new PGlite();
      await migrateEmbedded(client);
      db = drizzleOverPglite(client);
    },
    teardown: async () => {
      await client?.close();
    },
    db: (): Db => {
      if (!db) throw new Error("PGlite test database not ready");
      return db;
    },
  };
}

{
  const suite = pgliteSuite();
  describeDataContract(
    "pglite",
    async () => {
      await truncateAppTables(suite.db());
      return createPostgresStore({ db: suite.db() });
    },
    { setup: suite.setup, teardown: suite.teardown },
  );
}

{
  const suite = pgliteSuite();
  describe("pglite", () => {
    beforeAll(suite.setup, 60_000);
    afterAll(suite.teardown);
    describePostgresBehaviour("pglite", suite.db);
  });
}

// ---------------------------------------------------------------- postgres (TEST_DATABASE_URL)

const pgUrl = process.env.TEST_DATABASE_URL;

if (pgUrl) {
  let handle: { db: Db; close: () => Promise<void> } | undefined;
  const db = () => {
    if (!handle) throw new Error("Postgres test database not connected");
    return handle.db;
  };

  describeDataContract(
    "postgres",
    async () => {
      await truncateAppTables(db());
      return createPostgresStore({ db: db() });
    },
    {
      setup: async () => {
        if (process.env.DATABASE_URL && process.env.DATABASE_URL === pgUrl) {
          throw new Error("TEST_DATABASE_URL is the same as DATABASE_URL. The contract suite truncates every table; give it a throwaway database.");
        }
        handle = createDrizzle(pgUrl, { max: 10 });
        await migrate(handle.db, { migrationsFolder: MIGRATIONS });
      },
      teardown: async () => {
        await handle?.close();
      },
    },
  );

  describe("postgres", () => {
    let local: { db: Db; close: () => Promise<void> } | undefined;
    beforeAll(() => {
      local = createDrizzle(pgUrl, { max: 4 });
    });
    afterAll(async () => {
      await local?.close();
    });
    describePostgresBehaviour("postgres", () => {
      if (!local) throw new Error("Postgres test database not connected");
      return local.db;
    });
  });
}

// ---------------------------------------------------------------- the embedded database

describe("embedded database", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "openshipkit-db-"));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  describe("boot", () => {
    const saved = { url: process.env.DATABASE_URL, dir: process.env.PGLITE_DIR };
    const g = globalThis as unknown as { __openshipkitEmbeddedReady?: Promise<void> };
    afterEach(async () => {
      await closeDrizzle();
      g.__openshipkitEmbeddedReady = undefined;
    });
    afterAll(() => {
      for (const [key, value] of [["DATABASE_URL", saved.url], ["PGLITE_DIR", saved.dir]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it("migrates and seeds a new directory once, then keeps admin deletions on restart", async () => {
      delete process.env.DATABASE_URL;
      process.env.PGLITE_DIR = join(tempDir(), "pglite");

      await Promise.all([prepareEmbeddedDatabase(), prepareEmbeddedDatabase()]); // concurrent callers share one boot
      const store = createPostgresStore();
      expect((await store.plans.list()).map((p) => p.key).sort()).toEqual(SEED.plans.map((p) => p.key).sort());
      const victim = SEED.plans[0].key;
      await store.plans.delete(victim);

      // "Restart": close, forget the boot, prepare again on the same directory.
      await closeDrizzle();
      g.__openshipkitEmbeddedReady = undefined;
      await prepareEmbeddedDatabase();
      const plans = await createPostgresStore().plans.list();
      expect(plans).toHaveLength(SEED.plans.length - 1);
      expect(plans.some((p) => p.key === victim)).toBe(false);
    }, 60_000);

    it("does nothing with DATABASE_URL set", async () => {
      process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/never";
      await expect(prepareEmbeddedDatabase()).resolves.toBeUndefined();
    });
  });

  describe("lock", () => {
    it("is exclusive to one process, re-entrant for its owner, and released on close", () => {
      const dir = join(tempDir(), "pglite");
      const release = acquireDirectoryLock(dir, { waitMs: 0 });
      acquireDirectoryLock(dir, { waitMs: 0 }); // same process: fine
      release();
      acquireDirectoryLock(dir, { waitMs: 0 })(); // free again
    });

    it("refuses while another live process holds it, naming that process", () => {
      const dir = join(tempDir(), "pglite");
      // The test runner's parent is alive for the whole run.
      writeFileSync(`${dir}.lock`, JSON.stringify({ pid: process.ppid, host: hostname(), command: "next dev", since: "2026-01-01T00:00:00.000Z" }));
      let error: unknown;
      try {
        acquireDirectoryLock(dir, { waitMs: 0 });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(EmbeddedDatabaseLockedError);
      expect((error as Error).message).toContain(`pid ${process.ppid}: next dev`);
      expect((error as Error).message).toContain(`${dir}.lock`);
    });

    it("takes over a stale lock left by a crashed process or another host", () => {
      const dir = join(tempDir(), "pglite");
      writeFileSync(`${dir}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), command: "next dev", since: "" }));
      acquireDirectoryLock(dir, { waitMs: 0 })();
      writeFileSync(`${dir}.lock`, "not json");
      acquireDirectoryLock(dir, { waitMs: 0 })();
      writeFileSync(`${dir}.lock`, JSON.stringify({ pid: process.ppid, host: "some-old-container", command: "node server.js", since: "" }));
      acquireDirectoryLock(dir, { waitMs: 0 })();
    });
  });

  describe("npm run db:seed", () => {
    const SCRIPT = fileURLToPath(new URL("../scripts/seed.mts", import.meta.url));
    const ROOT = fileURLToPath(new URL("..", import.meta.url));
    /** Run the real CLI on `dir`. Empty DATABASE_URL / DATA_PROVIDER win over any .env file, so it never touches your database. */
    const seed = (dir: string, ...args: string[]) =>
      execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", SCRIPT, ...args], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"], // keep the CLI's stderr in the thrown error, out of the test output
        env: { ...process.env, DATABASE_URL: "", DATA_PROVIDER: "", PGLITE_DIR: dir },
      });

    it("seeds once, keeps a deletion, and adds it back with --force", async () => {
      const dir = join(tempDir(), "pglite");
      expect(seed(dir)).toContain(`Done: ${SEED.plans.length} plans and ${SEED.posts.length} posts added.`);

      const victim = SEED.plans[0].key;
      const pg = new PGlite(dir);
      await pg.query("delete from plans where key = $1", [victim]);
      await pg.close();

      const again = seed(dir);
      expect(again).toContain("Done: skipped (already seeded).");
      expect(again).not.toContain("already present");

      const forced = seed(dir, "--force");
      expect(forced).toContain(`+ plan ${victim}`);
      expect(forced).toContain(`Done: 1 plan and 0 posts added, ${SEED.plans.length + SEED.posts.length - 1} already present.`);
    }, 120_000);

    it("refuses an unknown flag instead of seeding", () => {
      const dir = join(tempDir(), "pglite");
      expect(() => seed(dir, "--forse")).toThrow(/Unknown option '--forse'/);
    }, 60_000);
  });
});

// ---------------------------------------------------------------- connection settings (pure)

describe("postgres connection settings", () => {
  it("turns SSL off for local and docker-network hosts in auto mode", () => {
    for (const url of ["postgres://u:p@localhost:5432/db", "postgres://u:p@127.0.0.1/db", "postgres://u:p@db:5432/app", "postgres://u:p@postgres/app", "postgres://u@[::1]:5432/db", "postgres:///db?host=/var/run/postgresql"]) {
      expect(resolveConnection(url, undefined).ssl, url).toBe(false);
    }
  });

  it("requires SSL for remote hosts in auto mode, without verifying (libpq's require)", () => {
    expect(resolveConnection("postgres://u:p@db.example.com:5432/app", "auto").ssl).toEqual({ rejectUnauthorized: false });
    expect(resolveConnection("postgres://u:p@10.0.0.5:5432/app", undefined).ssl).toEqual({ rejectUnauthorized: false });
  });

  it("honours sslmode in the URL and strips it from the connection string", () => {
    const r = resolveConnection("postgres://u:p@localhost:5432/db?sslmode=require&application_name=x", undefined);
    expect(r.ssl).toEqual({ rejectUnauthorized: false });
    expect(r.connectionString).toBe("postgres://u:p@localhost:5432/db?application_name=x");
    expect(resolveConnection("postgres://u:p@db.example.com/app?sslmode=verify-full", undefined).ssl).toEqual({ rejectUnauthorized: true });
    expect(resolveConnection("postgres://u:p@db.example.com/app?sslmode=disable", undefined).ssl).toBe(false);
  });

  it("lets DATABASE_SSL override the URL", () => {
    expect(resolveConnection("postgres://u:p@db.example.com/app?sslmode=require", "disable").ssl).toBe(false);
    expect(resolveConnection("postgres://u:p@db/app", "require").ssl).toEqual({ rejectUnauthorized: false });
    expect(resolveConnection("postgres://u:p@db/app", "verify-full", "PEM").ssl).toEqual({ rejectUnauthorized: true, ca: "PEM" });
    expect(() => resolveConnection("postgres://u:p@db/app", "sometimes")).toThrow(/DATABASE_SSL/);
  });
});
