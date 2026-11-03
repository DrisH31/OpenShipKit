import "server-only";

//
// Optional error tracking (ROADMAP 1.4): server errors sent to any service
// that speaks Sentry's envelope protocol, without its SDK. GlitchTip, which
// you can host yourself next to the app, does, and so does Sentry.
//
//   ERROR_TRACKING_DSN=https://<key>@errors.example.com/<project id>
//
// Unset (the default), nothing is sent anywhere (invariant 8). Two paths
// report: log.error() (./log.ts) and Next's onRequestError hook
// (src/instrumentation.ts), which catches what nothing else caught.
//
// What an event carries: the scope and message, the error's type, message and
// stack frames, the route, the method and the path WITHOUT its query string
// (reset and verification tokens live there). Never headers, cookies, bodies
// or the signed-in person. A message can still contain what the code put in
// it, which is why log lines don't carry secrets (./log.ts).
//
// Reporting must never hurt the request that failed: it doesn't throw, it
// gives up after REPORT_TIMEOUT_MS, and it stops for the rest of the minute
// after MAX_EVENTS_PER_MINUTE (an outage would otherwise send one event per
// request and spend the tracker's quota in minutes). The same scope and
// message is sent once a minute at most, so one failure repeating on every
// request can't use up the budget the others need.
//

import { randomUUID } from "node:crypto";
import { optionalEnv } from "./env";
import { scrubError, scrubText } from "./scrub";

const REPORT_TIMEOUT_MS = 3_000;
const MAX_EVENTS_PER_MINUTE = 30;
const MAX_FRAMES = 50;

export type Dsn = { endpoint: string; publicKey: string; dsn: string };

/** The envelope endpoint and key from a DSN, or null when it isn't one. Exported for the tests. */
export function parseDsn(value: string): Dsn | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!url.username || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = segments.length ? `/${segments.join("/")}` : "";
  return {
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
    publicKey: decodeURIComponent(url.username),
    dsn: value,
  };
}

type Frame = { function?: string; filename: string; lineno?: number; colno?: number; in_app: boolean };

/** V8 stack lines → Sentry frames, oldest call first (the order Sentry expects). Exported for the tests. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    const m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2];
    frames.push({
      ...(m[1] ? { function: m[1] } : {}),
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames.reverse();
}

export type ErrorReport = {
  scope: string;
  message: string;
  error?: unknown;
  /** Where it happened. `path` loses its query string before it is sent. */
  request?: { method?: string; path?: string; route?: string; kind?: string };
};

/** The Sentry event for a report. Exported for the tests. */
export function buildEvent(report: ErrorReport, environment: string, now = Date.now()): Record<string, unknown> {
  const err = scrubError(report.error);
  const event: Record<string, unknown> = {
    event_id: randomUUID().replace(/-/g, ""),
    timestamp: now / 1000,
    platform: "node",
    level: "error",
    logger: report.scope,
    environment,
    message: { formatted: scrubText(report.message) },
    tags: { scope: report.scope, ...(report.request?.kind ? { route_kind: report.request.kind } : {}) },
  };
  if (err instanceof Error) {
    const digest = (err as { digest?: unknown }).digest;
    event.exception = {
      values: [{ type: err.name, value: err.message, stacktrace: { frames: parseStack(err.stack) } }],
    };
    if (typeof digest === "string") (event.tags as Record<string, string>).digest = digest;
  } else if (err !== undefined) {
    event.extra = { detail: typeof err === "string" ? err : safeJson(err) };
  }
  if (report.request) {
    const { method, path, route } = report.request;
    const pathOnly = path?.split("?")[0]?.split("#")[0];
    event.request = { ...(method ? { method } : {}), ...(pathOnly ? { url: pathOnly } : {}) };
    if (route) event.transaction = route;
  }
  return event;
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[unserialisable]";
  }
}

let budget = { start: 0, count: 0 };
let warnedBadDsn = false;
/** scope + message → when it was last sent. */
const lastSent = new Map<string, number>();
const MAX_REMEMBERED = 500;

/** Resets the per-minute cap. Tests only. */
export function resetReportingForTests(): void {
  budget = { start: 0, count: 0 };
  warnedBadDsn = false;
  lastSent.clear();
}

/** Sends one report when ERROR_TRACKING_DSN is set. Never throws; resolves when sent or given up. */
export async function reportError(report: ErrorReport, fetcher: typeof fetch = fetch): Promise<void> {
  const value = optionalEnv("ERROR_TRACKING_DSN");
  if (!value) return;
  const dsn = parseDsn(value);
  if (!dsn) {
    if (!warnedBadDsn) console.error("[error-reporting] ERROR_TRACKING_DSN is not a DSN (https://<key>@host/<project id>); nothing is reported.");
    warnedBadDsn = true;
    return;
  }

  const now = Date.now();
  const errorText = report.error instanceof Error ? `${report.error.name}: ${report.error.message}` : "";
  const fingerprint = `${report.scope}\u0000${report.request?.route ?? ""}\u0000${report.message}\u0000${errorText}`;
  const previous = lastSent.get(fingerprint);
  if (previous !== undefined && now - previous < 60_000) return;
  if (now - budget.start >= 60_000) budget = { start: now, count: 0 };
  if (++budget.count > MAX_EVENTS_PER_MINUTE) return;
  if (lastSent.size >= MAX_REMEMBERED) lastSent.clear();
  lastSent.set(fingerprint, now);

  const event = buildEvent(report, optionalEnv("ERROR_TRACKING_ENVIRONMENT") ?? process.env.NODE_ENV ?? "development", now);
  const body = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date(now).toISOString(), dsn: dsn.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");

  try {
    const res = await fetcher(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=openshipkit/1`,
      },
      body,
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[error-reporting] the tracker answered ${res.status}; the event was dropped.`);
  } catch (error) {
    // Not log.error: that would report the failure to report, to the tracker that just failed.
    console.error("[error-reporting] could not reach the tracker; the event was dropped.", error instanceof Error ? error.message : error);
  }
}
