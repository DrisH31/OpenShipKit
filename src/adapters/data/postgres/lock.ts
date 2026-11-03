import "server-only";

//
// A process lock for the embedded database's directory.
//
// PGlite is Postgres in single-user mode: it does not stop a second process
// from opening the same data directory, and two writers corrupt it. So the
// first process to open PGLITE_DIR writes `<PGLITE_DIR>.lock` (its pid,
// hostname and command) and every other process refuses to open the
// directory with a clear message instead.
//
// Rules:
//  - The same process may take its own lock again (hot reload, a second
//    Next server layer, a script that closes and reopens).
//  - A lock whose pid is no longer running (a crash, `kill -9`, Next dev
//    SIGKILLing its child on restart) is stale and taken over.
//  - A lock written on another host (a container that was replaced, sharing
//    the volume) can't be checked for liveness and is taken over with a
//    warning. One process per data directory is the rule; this lock catches
//    the common mistake (`npm run db:migrate` while `npm run dev` runs), it
//    is not a cluster lock.
//  - While another live process holds it, acquiring waits `waitMs` (default
//    3 s, covering a dev-server restart where the old child is still
//    exiting) before failing.
//  - Released on close and on process exit. Synchronous throughout, because
//    the connection is opened synchronously.
//

import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { basename } from "node:path";
import { log } from "@/server/log";

interface LockInfo {
  pid: number;
  host: string;
  command: string;
  since: string;
}

/** Thrown when another live process holds the embedded database. */
export class EmbeddedDatabaseLockedError extends Error {
  constructor(
    readonly dir: string,
    readonly holder: LockInfo,
    readonly lockFile: string,
  ) {
    super(
      `The embedded database at ${dir} is in use by another process (pid ${holder.pid}: ${holder.command || "unknown command"}, since ${holder.since}). ` +
        `It allows one process at a time: stop that process first (usually \`npm run dev\`), or set DATABASE_URL to use a Postgres server. ` +
        `If no such process is running, delete ${lockFile}.`,
    );
    this.name = "EmbeddedDatabaseLockedError";
  }
}

function readLock(file: string): LockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LockInfo>;
    if (typeof parsed.pid !== "number") return null;
    return { pid: parsed.pid, host: String(parsed.host ?? ""), command: String(parsed.command ?? ""), since: String(parsed.since ?? "") };
  } catch {
    return null; // missing, half-written or garbage: treated as stale
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to another user — still running.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Modified in the last second (a lock file another process is still writing). */
function justWritten(file: string): boolean {
  try {
    return Date.now() - statSync(file).mtimeMs < 1000;
  } catch {
    return false;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function describeCommand(): string {
  const [, script, ...args] = process.argv;
  return [script ? basename(script) : "node", ...args].join(" ").slice(0, 200);
}

const held = new Set<string>();
let exitHookInstalled = false;

function release(file: string): void {
  held.delete(file);
  if (readLock(file)?.pid !== process.pid) return; // someone took it over; not ours to delete
  try {
    unlinkSync(file);
  } catch {
    // already gone
  }
}

/**
 * Take the lock for `dir` (the lock file is `<dir>.lock`) or throw
 * EmbeddedDatabaseLockedError. Returns the release function.
 */
export function acquireDirectoryLock(dir: string, opts: { waitMs?: number } = {}): () => void {
  const file = `${dir}.lock`;
  const deadline = Date.now() + (opts.waitMs ?? 3000);
  const me: LockInfo = { pid: process.pid, host: hostname(), command: describeCommand(), since: new Date().toISOString() };

  for (;;) {
    try {
      const fd = openSync(file, "wx");
      try {
        writeSync(fd, JSON.stringify(me));
      } finally {
        closeSync(fd);
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const holder = readLock(file);
    if (!holder && justWritten(file) && Date.now() < deadline) {
      sleepSync(50); // another process is between creating the file and writing its pid
      continue;
    }
    const ours = holder?.pid === process.pid && holder.host === me.host;
    const otherHost = holder !== null && holder.host !== "" && holder.host !== me.host;
    if (holder && !ours && !otherHost && isRunning(holder.pid)) {
      if (Date.now() >= deadline) throw new EmbeddedDatabaseLockedError(dir, holder, file);
      sleepSync(100);
      continue;
    }
    if (otherHost) log.warn("db", `taking over the embedded database lock written on host "${holder.host}" (pid ${holder.pid}).`);
    if (ours) break; // re-entrant
    // Stale: remove and retry the exclusive create (another process may win the race; then we wait for it).
    try {
      unlinkSync(file);
    } catch {
      // someone else removed it first
    }
  }

  held.add(file);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", () => {
      for (const f of [...held]) release(f);
    });
  }
  return () => release(file);
}
