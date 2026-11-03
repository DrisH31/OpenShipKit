import "server-only";

//
// A small fixed-window rate limiter for public forms (contact, newsletter,
// feedback), the auth server actions and the MCP endpoint. In-process: correct
// for one server (the self-hosted default). Behind several instances, back
// this same function with a shared store you run: a Postgres table like
// auth_rate_limit, or a self-hosted Redis/Valkey.
//
// Keys are whatever the caller passes. clientIp() buckets IPv6 by /64 (one
// customer's whole allocation), so rotating addresses inside one network
// doesn't buy fresh limits. For sign-in style forms also limit per account
// (key on the normalised email), so a spread-out attack on one account is
// throttled whatever the IP.
//

import { headers } from "next/headers";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;
/** When the map is full of live windows, drop this share of the oldest — never everyone's counters at once. */
const EVICT_SHARE = 0.1;

function makeRoom(now: number): void {
  if (windows.size < MAX_KEYS) return;
  for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
  if (windows.size < MAX_KEYS) return;
  // Map iterates in insertion order and a window is re-inserted when it resets, so these are the oldest.
  let drop = Math.ceil(MAX_KEYS * EVICT_SHARE);
  for (const k of windows.keys()) {
    if (drop-- <= 0) break;
    windows.delete(k);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (w) windows.delete(key);
    makeRoom(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  w.count += 1;
  if (w.count > limit) return { ok: false, retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) };
  return { ok: true, retryAfterSeconds: 0 };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Eight 16-bit groups of an IPv6 address (lower case, no leading zeros), or null when it isn't one. */
function ipv6Groups(address: string): string[] | null {
  let s = address;
  // An embedded IPv4 tail (64:ff9b::192.0.2.1) becomes two groups.
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4[1].split(".").map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    s = `${s.slice(0, -v4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ""));
}

/**
 * The rate-limit bucket for an address: IPv4 as is, IPv4-mapped IPv6 as its
 * IPv4, any other IPv6 as its /64 network ("2001:db8:1:2::/64"). Ports,
 * brackets and zone ids are dropped. Anything unparseable is returned trimmed.
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    ip = end > 0 ? ip.slice(1, end) : ip.slice(1);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }
  ip = ip.split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  if (IPV4.test(ip) || !ip.includes(":")) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  // ::ffff:c000:201 is the hex spelling of a mapped IPv4.
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const hi = Number.parseInt(groups[6], 16);
    const lo = Number.parseInt(groups[7], 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * The client's address as the reverse proxy reports it (Traefik, Caddy and
 * nginx set x-forwarded-for), normalised by normalizeIp() so it is a fair
 * rate-limit key.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const raw = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  return raw ? normalizeIp(raw) : "unknown";
}
