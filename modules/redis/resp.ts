import "server-only";

//
// A small Redis client: RESP2 over node:net / node:tls, no npm package.
//
// The cache and the shared limiter need six commands (GET, SET … EX, DEL,
// SCAN, EVAL, PING) plus AUTH and SELECT on connect. That is a few hundred
// lines of protocol, not a dependency — so enabling modules/redis installs
// nothing, and it works with Redis and Valkey alike. If you'd rather use a
// full client (ioredis, node-redis), implement CacheAdapter (./cache.ts) over
// it in ./redis-cache.ts; nothing else changes.
//
// Behaviour the cache depends on:
//  - Connects on first use, never at import: `next build` imports route
//    modules and must not try to reach a Redis that isn't there.
//  - No offline queue: while disconnected a command fails at once instead of
//    waiting behind a dead socket, and the caller falls back (a cache miss,
//    or the limiter's REDIS_FAIL_OPEN decision).
//  - Every command has a deadline (REDIS_COMMAND_TIMEOUT_MS). A command that
//    misses it fails, and the connection is dropped: its replies can no longer
//    be trusted to line up with requests.
//  - Reconnects with a capped backoff (200 ms × failures, at most 5 s).
//  - Logs a connection failure once (until it recovers), with the error's
//    message only — never the URL, which carries the password.
//

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export class RespError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RespError";
  }
}

export type RespReply = string | number | null | RespError | RespReply[];

/** A command as RESP: an array of bulk strings. */
export function encodeCommand(args: readonly (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const value = Buffer.from(String(arg), "utf8");
    parts.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

const INCOMPLETE = Symbol("incomplete");
type Parsed = { value: RespReply; next: number } | typeof INCOMPLETE;

function parseAt(buf: Buffer, at: number): Parsed {
  if (at >= buf.length) return INCOMPLETE;
  const eol = buf.indexOf("\r\n", at);
  if (eol === -1) return INCOMPLETE;
  const line = buf.toString("utf8", at + 1, eol);
  const next = eol + 2;
  switch (buf[at]) {
    case 0x2b: // + simple string
      return { value: line, next };
    case 0x2d: // - error
      return { value: new RespError(line), next };
    case 0x3a: // : integer
      return { value: Number(line), next };
    case 0x24: {
      // $ bulk string
      const length = Number(line);
      if (length < 0) return { value: null, next };
      if (buf.length < next + length + 2) return INCOMPLETE;
      return { value: buf.toString("utf8", next, next + length), next: next + length + 2 };
    }
    case 0x2a: {
      // * array
      const count = Number(line);
      if (count < 0) return { value: null, next };
      const items: RespReply[] = [];
      let cursor = next;
      for (let i = 0; i < count; i++) {
        const item = parseAt(buf, cursor);
        if (item === INCOMPLETE) return INCOMPLETE;
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new RespError(`Unexpected reply type byte ${buf[at]}`);
  }
}

/** Feed it socket chunks; it returns every reply that is now complete, in order. */
export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): RespReply[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const replies: RespReply[] = [];
    let at = 0;
    for (;;) {
      const parsed = parseAt(this.buffer, at);
      if (parsed === INCOMPLETE) break;
      replies.push(parsed.value);
      at = parsed.next;
    }
    this.buffer = at === this.buffer.length ? Buffer.alloc(0) : this.buffer.subarray(at);
    return replies;
  }
}

export interface RedisTarget {
  tls: boolean;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  db: number;
}

/** redis://[user:password@]host[:port][/db], rediss:// for TLS. */
export function parseRedisUrl(raw: string): RedisTarget {
  const url = new URL(raw);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error('REDIS_URL must start with "redis://" or "rediss://".');
  const db = url.pathname.replace(/^\//, "");
  if (db && !/^\d+$/.test(db)) throw new Error("REDIS_URL's path must be a database number, like /0.");
  return {
    tls: url.protocol === "rediss:",
    host: url.hostname.replace(/^\[|\]$/g, "") || "localhost",
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : null,
    password: url.password ? decodeURIComponent(url.password) : null,
    db: db ? Number(db) : 0,
  };
}

interface Pending {
  resolve: (reply: RespReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

export interface RespClientOptions {
  commandTimeoutMs: number;
  /** Default: four command timeouts, at least a second. */
  connectTimeoutMs?: number;
  /** Where connection problems are reported (default console.error). */
  log?: (message: string) => void;
}

export class RespClient {
  private readonly target: RedisTarget;
  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly log: (message: string) => void;
  private socket: Socket | null = null;
  private ready: Promise<void> | null = null;
  private parser = new RespParser();
  private pending: Pending[] = [];
  private failures = 0;
  private retryAt = 0;
  private reported = false;
  private closed = false;

  constructor(url: string, options: RespClientOptions) {
    this.target = parseRedisUrl(url);
    this.commandTimeoutMs = options.commandTimeoutMs;
    this.connectTimeoutMs = options.connectTimeoutMs ?? Math.max(1_000, options.commandTimeoutMs * 4);
    this.log = options.log ?? ((m) => console.error(m));
  }

  /** Run one command. Rejects with RespError for a Redis error reply, Error for anything else. */
  async command(args: readonly (string | number)[]): Promise<RespReply> {
    await this.connect();
    return this.send(args);
  }

  /** Close for good (scripts and tests). */
  close(): void {
    this.closed = true;
    this.teardown(new Error("client closed"), false);
  }

  private connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("client closed"));
    if (this.ready) return this.ready;
    if (Date.now() < this.retryAt) return Promise.reject(new Error("redis unavailable (waiting to reconnect)"));

    const { tls, host, port } = this.target;
    const socket = tls ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
    this.socket = socket;
    this.parser = new RespParser();
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.unref(); // an idle cache connection must not keep a script or test process alive

    // Events from a socket that has since been replaced are ignored: a late
    // "close" from the old one must not tear down the new connection.
    const current = () => this.socket === socket;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (current()) this.teardown(new Error(`connect timed out after ${this.connectTimeoutMs} ms`));
      }, this.connectTimeoutMs);
      this.rejectReady = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      socket.once(tls ? "secureConnect" : "connect", () => {
        clearTimeout(timer);
        this.handshake().then(
          () => {
            this.rejectReady = null;
            this.failures = 0;
            this.retryAt = 0;
            if (this.reported) this.log("[redis] reconnected");
            this.reported = false;
            resolve();
          },
          (error: unknown) => {
            if (current()) this.teardown(error instanceof Error ? error : new Error(String(error)));
            reject(error);
          },
        );
      });
      socket.on("data", (chunk: Buffer) => {
        if (current()) this.onData(chunk);
      });
      socket.on("error", (error) => {
        if (current()) this.teardown(error);
      });
      socket.on("close", () => {
        if (current()) this.teardown(new Error("connection closed"));
      });
    });
    // Callers see the rejection; this only stops an unhandled-rejection warning when nobody is waiting.
    ready.catch(() => {});
    this.ready = ready;
    return ready;
  }

  /** Rejects the connect in progress (set until the handshake succeeds). */
  private rejectReady: ((error: Error) => void) | null = null;

  private async handshake(): Promise<void> {
    const { username, password, db } = this.target;
    if (password) await this.send(username ? ["AUTH", username, password] : ["AUTH", password]);
    if (db) await this.send(["SELECT", db]);
  }

  private send(args: readonly (string | number)[]): Promise<RespReply> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error("redis not connected"));
    return new Promise<RespReply>((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        settled: false,
        timer: setTimeout(() => {
          if (entry.settled) return;
          entry.settled = true;
          reject(new Error(`redis command timed out after ${this.commandTimeoutMs} ms`));
          // Late replies would now pair with the wrong request: start over (after a short backoff,
          // so a hung server costs each request one timeout, not one per command).
          this.teardown(new Error("command timed out"));
        }, this.commandTimeoutMs),
      };
      this.pending.push(entry);
      socket.write(encodeCommand(args));
    });
  }

  private onData(chunk: Buffer): void {
    let replies: RespReply[];
    try {
      replies = this.parser.push(chunk);
    } catch (error) {
      this.teardown(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    for (const reply of replies) {
      const entry = this.pending.shift();
      if (!entry) {
        this.teardown(new Error("reply with no request (protocol out of step)"));
        return;
      }
      if (entry.settled) continue;
      entry.settled = true;
      clearTimeout(entry.timer);
      if (reply instanceof RespError) entry.reject(reply);
      else entry.resolve(reply);
    }
  }

  /** Drop the connection, fail everything in flight, and schedule the next attempt. */
  private teardown(error: Error, isFailure = true): void {
    const socket = this.socket;
    if (!socket && this.pending.length === 0 && !this.ready) return;
    this.socket = null;
    this.ready = null;
    socket?.destroy();
    this.rejectReady?.(error);
    this.rejectReady = null;
    const pending = this.pending;
    this.pending = [];
    for (const entry of pending) {
      if (entry.settled) continue;
      entry.settled = true;
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    if (isFailure && !this.closed) {
      this.failures += 1;
      this.retryAt = Date.now() + Math.min(this.failures * 200, 5_000);
      if (!this.reported) {
        this.reported = true;
        this.log(`[redis] connection failed: ${error.message}`);
      }
    }
  }
}
