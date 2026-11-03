import "server-only";

//
// The one Postgres connection, and the Drizzle client over it.
//
//   DATABASE_URL        postgres://user:pass@host:5432/db — your Postgres (docker compose, a VPS, any host)
//   DATABASE_POOL_MAX   connections per server process (default 10)
//   DATABASE_SSL        auto | require | verify-full | disable (default auto)
//   PGLITE_DIR          where the embedded database lives without DATABASE_URL (default .data/pglite;
//                       "memory://" keeps it in memory, lost on restart — for CI and throwaway demos)
//
// Without DATABASE_URL — `npm run dev` on a fresh clone — the app runs on
// EMBEDDED Postgres (PGlite: real Postgres compiled to WebAssembly, in-process,
// persisted to PGLITE_DIR). Same schema, same migrations, same queries.
// ONE PROCESS AT A TIME: PGlite itself doesn't stop a second process opening
// the directory (two writers corrupt it), so opening it takes
// `<PGLITE_DIR>.lock` (./lock.ts) and a second process fails with a message
// naming the holder. Committed data survives a crash or `kill -9` (Postgres's
// write-ahead log is replayed on the next open), so no shutdown hook is
// needed — Next dev SIGKILLs its server process on exit anyway.
// Production refuses to run on it unless OPENSHIPKIT_ALLOW_EMBEDDED_DB=true.
// Migrations and the starter seed are applied to it at boot by
// src/instrumentation.ts (prepareEmbeddedDatabase in ./embedded.ts).
//
// SSL, decided here rather than by `pg`'s own sslmode parsing (which treats
// sslmode=require as verify-full and rejects a managed host's private CA):
//   disable      plain TCP.
//   require      encrypted, certificate not verified (libpq's "require").
//   verify-full  encrypted and verified against the system CAs, or against
//                DATABASE_SSL_CA (a PEM string) / ?sslrootcert=<file> when given.
//   auto         the URL's ?sslmode= if present; otherwise disable for local and
//                docker-network hosts (localhost, 127.x, ::1, a unix socket, or
//                a single-label name like "db" / "postgres"), require for
//                everything else.
//
// Lazy: nothing connects or reads env until getDrizzle() is first called, so
// `next build` needs no database. One pool per process, kept on globalThis.
//

import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool, type PoolConfig } from "pg";
import { isProduction, optionalEnv } from "@/server/env";
import { acquireDirectoryLock } from "./lock";
import * as schema from "./schema";

export { authTables } from "./schema";

/**
 * The Drizzle client type the adapter is written against. The PGlite client
 * has the same query-builder surface (both are Drizzle PgDatabases), so the
 * embedded database is typed as this too.
 */
export type Db = NodePgDatabase<typeof schema>;

interface Connection {
  kind: "server" | "embedded";
  db: Db;
  close: () => Promise<void>;
  /** The embedded client, for migrations (null on a real server). */
  pglite: PGlite | null;
}

type SslOption = PoolConfig["ssl"];
type SslMode = "disable" | "require" | "verify-full";

const URL_SSL_PARAMS = ["sslmode", "uselibpqcompat", "sslrootcert", "sslcert", "sslkey", "sslnegotiation"];

function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "" || h.startsWith("/")) return true; // unix socket
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h.startsWith("127.")) return true;
  if (h === "host.docker.internal") return true;
  // A docker compose / Dokploy service name has no dots ("db", "postgres", "myapp-db-x1y2").
  return !h.includes(".") && !h.includes(":");
}

function sslModeFromUrl(value: string | null): SslMode | null {
  switch (value) {
    case null:
      return null;
    case "disable":
      return "disable";
    case "verify-ca":
    case "verify-full":
      return "verify-full";
    default:
      // allow | prefer | require | no-verify: encrypt, as libpq does.
      return "require";
  }
}

/**
 * Split DATABASE_URL into a connection string without SSL parameters plus the
 * `ssl` option for `pg`. Exported for tests.
 */
export function resolveConnection(url: string, setting: string | undefined, caPem?: string): { connectionString: string; ssl: SslOption } {
  const [base, query = ""] = url.split(/\?(.*)/s, 2);
  const params = new URLSearchParams(query);
  const urlMode = sslModeFromUrl(params.get("sslmode"));
  const rootCertFile = params.get("sslrootcert");
  for (const p of URL_SSL_PARAMS) params.delete(p);
  const rest = params.toString();
  const connectionString = rest ? `${base}?${rest}` : base;

  let host = params.get("host") ?? "";
  try {
    host = host || new URL(base).hostname;
  } catch {
    host = "";
  }

  const wanted = (setting ?? "auto").toLowerCase();
  let mode: SslMode;
  if (wanted === "disable" || wanted === "require" || wanted === "verify-full") mode = wanted;
  else if (wanted === "auto") mode = urlMode ?? (isLocalHost(host) ? "disable" : "require");
  else throw new Error(`DATABASE_SSL="${setting}" is not one of: auto, require, verify-full, disable`);

  if (mode === "disable") return { connectionString, ssl: false };
  if (mode === "require") return { connectionString, ssl: { rejectUnauthorized: false } };
  const ca = caPem ?? (rootCertFile && rootCertFile !== "system" ? readFileSync(rootCertFile, "utf8") : undefined);
  return { connectionString, ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true } };
}

function poolMax(): number {
  const raw = optionalEnv("DATABASE_POOL_MAX");
  const n = raw ? Number.parseInt(raw, 10) : 10;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** The embedded database's directory (PGLITE_DIR, default .data/pglite), absolute; or "memory://". */
export function pgliteDir(): string {
  const dir = optionalEnv("PGLITE_DIR") ?? ".data/pglite";
  // The directory comes from the environment at runtime, so there is nothing for
  // the build's file tracer to follow: without the ignore comment it would copy
  // the whole project (and a local .data/pglite) into .next/standalone.
  return dir.startsWith("memory://") ? dir : resolve(/*turbopackIgnore: true*/ dir);
}

/**
 * Drizzle over a PGlite client, typed as the node-postgres client the adapter
 * is written against (the query builders are the same PgDatabase surface).
 * Used for the embedded database and for tests on an in-memory `new PGlite()`.
 */
export function drizzleOverPglite(client: PGlite): Db {
  return drizzlePglite({ client, schema }) as unknown as Db;
}

function connectEmbedded(): Connection {
  const dir = pgliteDir();
  if (dir.startsWith("memory://")) {
    const client = new PGlite(dir);
    return { kind: "embedded", db: drizzleOverPglite(client), pglite: client, close: () => client.close() };
  }
  mkdirSync(dir, { recursive: true });
  const unlock = acquireDirectoryLock(dir); // throws EmbeddedDatabaseLockedError if another process has it
  let client: PGlite;
  try {
    client = new PGlite(dir);
  } catch (error) {
    unlock();
    throw error;
  }
  return {
    kind: "embedded",
    db: drizzleOverPglite(client),
    pglite: client,
    close: async () => {
      try {
        if (!client.closed) await client.close();
      } finally {
        unlock();
      }
    },
  };
}

function connect(): Connection {
  const url = optionalEnv("DATABASE_URL");
  if (!url) {
    if (isProduction() && optionalEnv("OPENSHIPKIT_ALLOW_EMBEDDED_DB") !== "true") {
      throw new Error("DATABASE_URL is not set. Production needs a Postgres server (see docker-compose.yml and docs/deployment.md).");
    }
    return connectEmbedded();
  }
  const { connectionString, ssl } = resolveConnection(url, optionalEnv("DATABASE_SSL"), optionalEnv("DATABASE_SSL_CA"));
  const pool = new Pool({
    connectionString,
    ssl,
    max: poolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "openshipkit",
  });
  // An idle client losing its connection must not crash the process; the next query reconnects.
  pool.on("error", (error) => console.error("[postgres] idle client error:", error.message));
  return { kind: "server", db: drizzle({ client: pool, schema }), pglite: null, close: () => pool.end() };
}

// On globalThis, not a module variable: dev hot reloads re-evaluate this module,
// and Next can instantiate it once per server layer — either would open a
// second pool.
const g = globalThis as unknown as { __openshipkitPg?: Connection };

function connection(): Connection {
  return (g.__openshipkitPg ??= connect());
}

/** The shared Drizzle client. Connects on first use. */
export function getDrizzle(): Db {
  return connection().db;
}

/** True when running on the embedded PGlite database (no DATABASE_URL). */
export function isEmbeddedDatabase(): boolean {
  return !optionalEnv("DATABASE_URL");
}

/** The embedded client, or null on a real Postgres server. */
export function getEmbeddedClient(): PGlite | null {
  return connection().pglite;
}

/** Close the connection (scripts and tests; a server keeps it for its lifetime). */
export async function closeDrizzle(): Promise<void> {
  const conn = g.__openshipkitPg;
  g.__openshipkitPg = undefined;
  if (conn) await conn.close();
}

/** A Drizzle client over its own pool — for tests and one-off scripts that must not share the app's. */
export function createDrizzle(url: string, opts: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  const { connectionString, ssl } = resolveConnection(url, optionalEnv("DATABASE_SSL"), optionalEnv("DATABASE_SSL_CA"));
  const pool = new Pool({ connectionString, ssl, max: opts.max ?? 5 });
  pool.on("error", (error) => console.error("[postgres] idle client error:", error.message));
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}
