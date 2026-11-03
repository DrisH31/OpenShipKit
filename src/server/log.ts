import "server-only";

//
// log: the one way server code writes to the log (ROADMAP 1.3).
//
//   log.info("billing", "webhook recorded", { event: id })
//   log.error("billing", "webhook failed", error)
//
// Production prints one JSON object per line (time, level, scope, msg, and
// error or data), which Docker, Dokploy, journald and any log shipper read as
// is. Development prints the familiar "[scope] message" with the detail
// beside it. LOG_FORMAT=json|pretty overrides the choice and LOG_LEVEL
// (debug, info, warn, error; default info) drops the quieter levels.
//
// log.error also reports the error to ERROR_TRACKING_DSN when that is set
// (./error-reporting.ts). Without it, nothing leaves the server.
//
// What not to log: request bodies, cookies, tokens, passwords, or anything a
// webhook carried. A person's id is fine and an email only where the line
// is about that address (a failed send).
//

import { optionalEnv } from "./env";
import { reportError } from "./error-reporting";

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const v = optionalEnv("LOG_LEVEL")?.toLowerCase();
  return v && v in RANK ? RANK[v as LogLevel] : RANK.info;
}

function json(): boolean {
  const v = optionalEnv("LOG_FORMAT")?.toLowerCase();
  if (v === "json") return true;
  if (v === "pretty") return false;
  return process.env.NODE_ENV === "production";
}

/** An Error as plain JSON fields: its own message and stack, and the cause chain (bounded). */
export function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const out: Record<string, unknown> = { name: error.name, message: error.message };
  if (error.stack) out.stack = error.stack;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") out.code = code;
  if (error.cause !== undefined && depth < 3) out.cause = serializeError(error.cause, depth + 1);
  return out;
}

/** One JSON log line. Exported for the tests. */
export function formatJson(level: LogLevel, scope: string, msg: string, detail: unknown, now = new Date()): string {
  const line: Record<string, unknown> = { time: now.toISOString(), level, scope, msg };
  if (detail instanceof Error) line.error = serializeError(detail);
  else if (detail !== undefined && detail !== null && typeof detail === "object") line.data = detail;
  else if (detail !== undefined) line.detail = detail;
  try {
    return JSON.stringify(line);
  } catch {
    // A circular or BigInt detail mustn't swallow the line itself.
    return JSON.stringify({ time: line.time, level, scope, msg, detail: "[unserialisable]" });
  }
}

const CONSOLE: Record<LogLevel, (...args: unknown[]) => void> = {
  // Looked up at call time, so a test's vi.spyOn(console, …) still sees every line.
  debug: (...a) => console.debug(...a),
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

/** Writes one line and reports nothing. For a caller that reports the error itself, with more context (./request-error.ts). */
export function write(level: LogLevel, scope: string, msg: string, detail?: unknown): void {
  if (RANK[level] < threshold()) return;
  if (json()) CONSOLE[level](formatJson(level, scope, msg, detail));
  else if (detail === undefined) CONSOLE[level](`[${scope}] ${msg}`);
  else CONSOLE[level](`[${scope}] ${msg}`, detail);
}

export const log = {
  debug: (scope: string, msg: string, detail?: unknown) => write("debug", scope, msg, detail),
  info: (scope: string, msg: string, detail?: unknown) => write("info", scope, msg, detail),
  warn: (scope: string, msg: string, detail?: unknown) => write("warn", scope, msg, detail),
  /** Logs, then reports to ERROR_TRACKING_DSN when set (in the background: never delays or fails the caller). */
  error: (scope: string, msg: string, detail?: unknown) => {
    write("error", scope, msg, detail);
    void reportError({ scope, message: msg, error: detail });
  },
};
