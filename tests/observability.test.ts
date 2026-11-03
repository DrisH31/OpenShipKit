//
// The log and optional error tracking (ROADMAP 1.3, 1.4): one JSON line per
// event in production, nothing sent anywhere without ERROR_TRACKING_DSN, and
// an event that never carries a query string, headers or a body.
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEvent, parseDsn, parseStack, reportError, resetReportingForTests } from "@/server/error-reporting";
import { formatJson, log } from "@/server/log";
import { logRequestError } from "@/server/request-error";

beforeEach(() => resetReportingForTests());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("log", () => {
  it("prints one parseable JSON object per line, with the error's message, stack and cause", () => {
    const err = new Error("connect refused", { cause: new Error("ECONNREFUSED") });
    const line = JSON.parse(formatJson("error", "billing", "webhook failed", err, new Date("2026-11-03T00:00:00Z")));
    expect(line).toMatchObject({
      time: "2026-11-03T00:00:00.000Z",
      level: "error",
      scope: "billing",
      msg: "webhook failed",
      error: { name: "Error", message: "connect refused", cause: { message: "ECONNREFUSED" } },
    });
    expect(line.error.stack).toContain("connect refused");
    expect(JSON.parse(formatJson("info", "s", "m", { id: 1 })).data).toEqual({ id: 1 });
    expect(JSON.parse(formatJson("info", "s", "m", "plain")).detail).toBe("plain");
  });

  it("survives a detail that can't be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(JSON.parse(formatJson("warn", "s", "m", circular))).toMatchObject({ msg: "m", detail: "[unserialisable]" });
  });

  it("writes JSON under LOG_FORMAT=json, '[scope] message' under pretty, and honours LOG_LEVEL", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubEnv("LOG_FORMAT", "json");
    log.info("forms", "saved", { n: 1 });
    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({ level: "info", scope: "forms", msg: "saved", data: { n: 1 } });

    vi.stubEnv("LOG_FORMAT", "pretty");
    log.warn("forms", "slow", 12);
    expect(warn.mock.calls[0]).toEqual(["[forms] slow", 12]);

    vi.stubEnv("LOG_LEVEL", "warn");
    log.info("forms", "dropped");
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("reports log.error to the tracker only when ERROR_TRACKING_DSN is set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    log.error("billing", "no DSN", new Error("x"));
    await vi.waitFor(() => Promise.resolve());
    expect(fetcher).not.toHaveBeenCalled();

    vi.stubEnv("ERROR_TRACKING_DSN", "https://abc@errors.example.com/7");
    log.error("billing", "with DSN", new Error("y"));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });
});

describe("error tracking", () => {
  it("reads a DSN into the envelope endpoint, including a path prefix, and refuses what isn't one", () => {
    expect(parseDsn("https://abc@errors.example.com/42")).toMatchObject({
      endpoint: "https://errors.example.com/api/42/envelope/",
      publicKey: "abc",
    });
    expect(parseDsn("https://abc@example.com/glitchtip/42")?.endpoint).toBe("https://example.com/glitchtip/api/42/envelope/");
    for (const bad of ["", "not a url", "https://example.com/42", "https://abc@example.com/", "https://abc@example.com/x", "ftp://abc@example.com/1"]) {
      expect(parseDsn(bad), bad).toBeNull();
    }
  });

  it("turns a V8 stack into frames, oldest first, marking dependencies as not in the app", () => {
    const stack = [
      "Error: boom",
      "    at inner (/app/.next/server/chunks/a.js:10:5)",
      "    at /app/node_modules/pg/lib/client.js:3:1",
      "    at async outer (node:internal/process/task_queues:95:5)",
    ].join("\n");
    expect(parseStack(stack)).toEqual([
      { function: "async outer", filename: "node:internal/process/task_queues", lineno: 95, colno: 5, in_app: false },
      { filename: "/app/node_modules/pg/lib/client.js", lineno: 3, colno: 1, in_app: false },
      { function: "inner", filename: "/app/.next/server/chunks/a.js", lineno: 10, colno: 5, in_app: true },
    ]);
  });

  it("never sends the query string, headers or a body", () => {
    const event = buildEvent(
      { scope: "request", message: "GET /auth/[page]", error: new Error("x"), request: { method: "GET", path: "/auth/reset?token=SECRET#frag", route: "/auth/[page]", kind: "render" } },
      "production",
    );
    const text = JSON.stringify(event);
    expect(text).not.toContain("SECRET");
    expect(event.request).toEqual({ method: "GET", url: "/auth/reset" });
    expect(event.transaction).toBe("/auth/[page]");
    expect(event).toMatchObject({ platform: "node", level: "error", environment: "production", tags: { scope: "request", route_kind: "render" } });
  });

  it("sends a Sentry envelope with the key in X-Sentry-Auth", async () => {
    vi.stubEnv("ERROR_TRACKING_DSN", "https://pubkey@errors.example.com/3");
    const fetcher = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 200 }));
    await reportError({ scope: "billing", message: "webhook failed", error: new TypeError("bad") }, fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://errors.example.com/api/3/envelope/");
    expect((init?.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=pubkey");
    const [header, item, event] = String(init?.body).split("\n").map((l) => JSON.parse(l));
    expect(header.event_id).toBe(event.event_id);
    expect(item).toEqual({ type: "event" });
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "bad" });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("never throws, and stops after 30 events in a minute", async () => {
    vi.stubEnv("ERROR_TRACKING_DSN", "https://k@errors.example.com/1");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(reportError({ scope: "s", message: "m" }, down as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();

    resetReportingForTests();
    const ok = vi.fn(async () => new Response(null, { status: 200 }));
    for (let i = 0; i < 40; i++) await reportError({ scope: "s", message: `m${i}` }, ok as unknown as typeof fetch);
    expect(ok).toHaveBeenCalledTimes(30);
  });

  it("says once that a malformed DSN reports nothing", async () => {
    vi.stubEnv("ERROR_TRACKING_DSN", "nonsense");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn();
    await reportError({ scope: "s", message: "a" }, fetcher as unknown as typeof fetch);
    await reportError({ scope: "s", message: "b" }, fetcher as unknown as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("a request error is logged with its route, without the query, and reported once", async () => {
    vi.stubEnv("ERROR_TRACKING_DSN", "https://k@errors.example.com/1");
    vi.stubEnv("LOG_FORMAT", "json");
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    const fetcher = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await logRequestError(new Error("db down"), { path: "/dashboard?token=SECRET", method: "GET" }, { routePath: "/dashboard", routeType: "render" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("SECRET");
    expect(JSON.parse(lines[0])).toMatchObject({ level: "error", scope: "request", error: { message: "db down" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain("SECRET");
  });
});
