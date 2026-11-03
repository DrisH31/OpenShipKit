//
// modules/redis — the RESP encoder/parser, URL parsing, the memory cache, the
// shared rate limiter, and the Redis cache against a fake RESP server on
// 127.0.0.1 (no Redis needed, nothing leaves the machine): prefixing, AUTH and
// SELECT on connect, the fixed-window increment, SCAN-based prefix deletes,
// and failing soft when the server is down or hangs.
//

import { createServer, type Server, type Socket } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryCache, getCache } from "../../modules/redis/cache";
import { redisConfig } from "../../modules/redis/config";
import { createRedisCache, escapeGlob, INCREMENT_SCRIPT } from "../../modules/redis/redis-cache";
import { sharedRateLimit } from "../../modules/redis/rate-limit";
import { encodeCommand, parseRedisUrl, RespClient, RespError, RespParser } from "../../modules/redis/resp";

const g = globalThis as unknown as { __openshipkitCache?: unknown };

beforeEach(() => {
  vi.unstubAllEnvs();
  g.__openshipkitCache = undefined;
});

// ---------------------------------------------------------------- protocol

describe("RESP", () => {
  it("encodes a command as an array of bulk strings (bytes, not characters)", () => {
    expect(encodeCommand(["SET", "k", "é", 5]).toString()).toBe("*4\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n$1\r\n5\r\n");
  });

  it("parses every reply type, across chunk boundaries", () => {
    const parser = new RespParser();
    const wire = Buffer.from("+OK\r\n-ERR bad\r\n:42\r\n$-1\r\n$5\r\nhello\r\n*2\r\n$1\r\n0\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n*-1\r\n");
    const replies = [];
    for (let i = 0; i < wire.length; i += 3) replies.push(...parser.push(wire.subarray(i, i + 3)));
    expect(replies[0]).toBe("OK");
    expect(replies[1]).toBeInstanceOf(RespError);
    expect((replies[1] as RespError).message).toBe("ERR bad");
    expect(replies.slice(2)).toEqual([42, null, "hello", ["0", ["a", "b"]], null]);
  });

  it("reads redis:// and rediss:// URLs", () => {
    expect(parseRedisUrl("redis://localhost")).toEqual({ tls: false, host: "localhost", port: 6379, username: null, password: null, db: 0 });
    expect(parseRedisUrl("rediss://app:p%40ss@cache.example.com:6380/2")).toEqual({
      tls: true,
      host: "cache.example.com",
      port: 6380,
      username: "app",
      password: "p@ss",
      db: 2,
    });
    expect(parseRedisUrl("redis://:secret@[::1]:6379").host).toBe("::1");
    expect(() => parseRedisUrl("http://localhost")).toThrow(/redis:\/\//);
    expect(() => parseRedisUrl("redis://localhost/abc")).toThrow(/database number/);
  });

  it("escapes glob characters so a prefix matches literally", () => {
    expect(escapeGlob("a*b?[c]\\")).toBe("a\\*b\\?\\[c\\]\\\\");
  });
});

// ---------------------------------------------------------------- memory

describe("memory cache", () => {
  afterEach(() => vi.useRealTimers());

  it("round-trips JSON, expires on read, and deletes by prefix", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const cache = createMemoryCache();
    const value = { n: 1, list: ["a"] };
    await cache.set("post:1", value, 10);
    await cache.set("post:2", "two", 100);
    await cache.set("user:1", "u", 100);
    const hit = await cache.get<typeof value>("post:1");
    expect(hit).toEqual(value);
    expect(hit).not.toBe(value); // a copy: mutating it can't change the cache
    vi.advanceTimersByTime(11_000);
    expect(await cache.get("post:1")).toBeNull();
    await cache.deleteByPrefix("post:");
    expect(await cache.get("post:2")).toBeNull();
    expect(await cache.get("user:1")).toBe("u");
  });

  it("counts in a fixed window that the increments don't extend", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const cache = createMemoryCache();
    expect(await cache.increment("c", 10)).toBe(1);
    vi.advanceTimersByTime(9_000);
    expect(await cache.increment("c", 10)).toBe(2);
    vi.advanceTimersByTime(1_500);
    expect(await cache.increment("c", 10)).toBe(1);
  });

  it("stays under its key cap", async () => {
    const cache = createMemoryCache(100);
    for (let i = 0; i < 250; i++) await cache.set(`k${i}`, i, 60);
    expect(await cache.get("k249")).toBe(249);
    expect(await cache.get("k0")).toBeNull();
  });

  it("is what getCache() gives without REDIS_URL", () => {
    expect(getCache().kind).toBe("memory");
    expect(getCache()).toBe(getCache());
  });
});

describe("sharedRateLimit (in memory)", () => {
  it("allows the limit, then refuses until the window turns over", async () => {
    const t = Date.UTC(2026, 0, 1, 0, 0, 30);
    expect((await sharedRateLimit("export:u1", 2, 60_000, t)).ok).toBe(true);
    expect(await sharedRateLimit("export:u1", 2, 60_000, t)).toMatchObject({ ok: true, remaining: 0 });
    expect(await sharedRateLimit("export:u1", 2, 60_000, t)).toMatchObject({ ok: false, retryAfterSeconds: 30, degraded: false });
    expect((await sharedRateLimit("export:u1", 2, 60_000, t + 30_000)).ok).toBe(true);
    expect((await sharedRateLimit("export:u2", 2, 60_000, t)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------- a fake RESP server

/** Enough of Redis for this module: AUTH, SELECT, PING, GET, SET … EX, DEL, SCAN, EVAL (our script). */
function fakeRedis(opts: { password?: string; hang?: boolean } = {}) {
  const data = new Map<string, { value: string; expiresAt: number | null }>();
  const commands: string[][] = [];
  const sockets = new Set<Socket>();
  const bulk = (s: string | null) => (s === null ? "$-1\r\n" : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  const live = (k: string) => {
    const e = data.get(k);
    if (e && e.expiresAt !== null && e.expiresAt <= Date.now()) data.delete(k);
    return data.get(k) ?? null;
  };
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let authed = !opts.password;
    const parser = new RespParser();
    socket.on("data", (chunk) => {
      for (const reply of parser.push(chunk)) {
        const args = (reply as string[]).map(String);
        commands.push(args);
        if (opts.hang) continue;
        const [cmd, ...rest] = args;
        const name = cmd.toUpperCase();
        if (name === "AUTH") {
          authed = rest.at(-1) === opts.password;
          socket.write(authed ? "+OK\r\n" : "-WRONGPASS invalid password\r\n");
          continue;
        }
        if (!authed) {
          socket.write("-NOAUTH Authentication required.\r\n");
          continue;
        }
        switch (name) {
          case "PING":
            socket.write("+PONG\r\n");
            break;
          case "SELECT":
            socket.write("+OK\r\n");
            break;
          case "GET":
            socket.write(bulk(live(rest[0])?.value ?? null));
            break;
          case "SET": {
            const ex = rest[2]?.toUpperCase() === "EX" ? Number(rest[3]) : null;
            data.set(rest[0], { value: rest[1], expiresAt: ex ? Date.now() + ex * 1000 : null });
            socket.write("+OK\r\n");
            break;
          }
          case "DEL": {
            let n = 0;
            for (const k of rest) if (data.delete(k)) n++;
            socket.write(`:${n}\r\n`);
            break;
          }
          case "SCAN": {
            // One page; MATCH with a trailing * and backslash escapes.
            const pattern = rest[rest.indexOf("MATCH") + 1];
            const prefix = pattern.slice(0, -1).replace(/\\(.)/g, "$1");
            const keys = [...data.keys()].filter((k) => k.startsWith(prefix) && live(k));
            socket.write(`*2\r\n${bulk("0")}*${keys.length}\r\n${keys.map(bulk).join("")}`);
            break;
          }
          case "EVAL": {
            if (rest[0] !== INCREMENT_SCRIPT) {
              socket.write("-ERR unknown script\r\n");
              break;
            }
            const key = rest[2];
            const entry = live(key);
            const n = (entry ? Number(entry.value) : 0) + 1;
            data.set(key, { value: String(n), expiresAt: entry ? entry.expiresAt : Date.now() + Number(rest[3]) * 1000 });
            socket.write(`:${n}\r\n`);
            break;
          }
          default:
            socket.write(`-ERR unknown command '${cmd}'\r\n`);
        }
      }
    });
  });
  return {
    data,
    commands,
    async listen(): Promise<number> {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return (server.address() as { port: number }).port;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("redis cache over RESP", () => {
  const fake = fakeRedis({ password: "s3cret" });
  let port: number;
  const quiet = () => {};
  beforeAll(async () => {
    port = await fake.listen();
  });
  afterAll(async () => {
    await fake.close();
  });

  function cache(prefix = "test:") {
    const url = `redis://:s3cret@127.0.0.1:${port}/3`;
    const client = new RespClient(url, { commandTimeoutMs: 500, log: quiet });
    return { cache: createRedisCache({ url, keyPrefix: prefix, commandTimeoutMs: 500, failOpen: true }, client), client };
  }

  it("authenticates, selects the database, and prefixes every key", async () => {
    const { cache: c, client } = cache();
    expect(c.kind).toBe("redis");
    expect(await c.ping()).toBe(true);
    await c.set("greeting", { hello: "world" }, 30);
    expect(await c.get("greeting")).toEqual({ hello: "world" });
    expect(fake.data.has("test:greeting")).toBe(true);
    expect(fake.commands.slice(0, 2)).toEqual([
      ["AUTH", "s3cret"],
      ["SELECT", "3"],
    ]);
    expect(fake.commands.find((c) => c[0] === "SET")).toEqual(["SET", "test:greeting", '{"hello":"world"}', "EX", "30"]);
    client.close();
  });

  it("increments in a fixed window, atomically, through one script", async () => {
    const { cache: c, client } = cache();
    expect(await c.increment("hits", 60)).toBe(1);
    expect(await c.increment("hits", 60)).toBe(2);
    expect(fake.commands.filter((x) => x[0] === "EVAL").at(-1)).toEqual(["EVAL", INCREMENT_SCRIPT, "1", "test:hits", "60"]);
    client.close();
  });

  it("deletes by prefix with SCAN, matching the prefix literally", async () => {
    const { cache: c, client } = cache("app*1:");
    await c.set("post:1", 1, 30);
    await c.set("post:2", 2, 30);
    await c.set("user:1", 3, 30);
    fake.data.set("appX1:post:9", { value: "9", expiresAt: null }); // would match an unescaped "*"
    await c.deleteByPrefix("post:");
    expect(await c.get("post:1")).toBeNull();
    expect(await c.get("user:1")).toBe(3);
    expect(fake.data.has("appX1:post:9")).toBe(true);
    expect(fake.commands.some((x) => x[0] === "KEYS")).toBe(false);
    client.close();
  });

  it("treats a value it can't parse as a miss", async () => {
    const { cache: c, client } = cache();
    fake.data.set("test:foreign", { value: "not json", expiresAt: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await c.get("foreign")).toBeNull();
    spy.mockRestore();
    client.close();
  });

  it("fails soft on a wrong password", async () => {
    const url = `redis://:wrong@127.0.0.1:${port}`;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = createRedisCache({ url, keyPrefix: "t:", commandTimeoutMs: 500, failOpen: true }, new RespClient(url, { commandTimeoutMs: 500, log: quiet }));
    expect(await c.get("x")).toBeNull();
    expect(await c.increment("x", 10)).toBeNull();
    spy.mockRestore();
  });
});

describe("redis outages", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  it("a down server is a miss, a dropped write and an unknown count", async () => {
    const url = `redis://127.0.0.1:${await closedPort()}`;
    const logs: string[] = [];
    const c = createRedisCache({ url, keyPrefix: "t:", commandTimeoutMs: 200, failOpen: true }, new RespClient(url, { commandTimeoutMs: 200, log: (m) => logs.push(m) }));
    expect(await c.get("x")).toBeNull();
    await expect(c.set("x", 1, 10)).resolves.toBeUndefined();
    expect(await c.increment("x", 10)).toBeNull();
    expect(await c.ping()).toBe(false);
    expect(logs).toHaveLength(1); // reported once, not per command
    expect(logs[0]).not.toContain("redis://");
  });

  it("a hung server costs one timeout, then fails fast", async () => {
    const hung = fakeRedis({ hang: true });
    const port = await hung.listen();
    const url = `redis://127.0.0.1:${port}`;
    const c = createRedisCache({ url, keyPrefix: "t:", commandTimeoutMs: 100, failOpen: true }, new RespClient(url, { commandTimeoutMs: 100, log: () => {} }));
    const started = Date.now();
    expect(await c.get("x")).toBeNull();
    expect(await c.get("y")).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    await hung.close();
  });

  it("the shared limiter follows REDIS_FAIL_OPEN when it can't count", async () => {
    vi.stubEnv("REDIS_URL", `redis://127.0.0.1:${await closedPort()}`);
    vi.stubEnv("REDIS_COMMAND_TIMEOUT_MS", "100");
    expect(redisConfig().failOpen).toBe(true);
    expect(getCache().kind).toBe("redis");
    expect(await sharedRateLimit("login:192.0.2.1", 5, 60_000)).toMatchObject({ ok: true, degraded: true, remaining: null });

    vi.stubEnv("REDIS_FAIL_OPEN", "false");
    const refused = await sharedRateLimit("login:192.0.2.1", 5, 60_000);
    expect(refused).toMatchObject({ ok: false, degraded: true });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refuses a REDIS_URL that isn't one", () => {
    vi.stubEnv("REDIS_URL", "https://cache.example.com");
    expect(() => redisConfig()).toThrow(/redis:\/\//);
  });
});
