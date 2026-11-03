import "server-only";

//
// Per-account limits, on top of the per-IP ones. A per-IP limit alone lets a
// botnet (or a pool of IPv6 addresses) guess one account's password, or make
// the site email one person reset and confirmation links, without end: every
// request comes from a fresh address. These counters are keyed on the account
// instead, whatever the IP:
//
//   - PASSWORD_ATTEMPTS: wrong passwords per account (the normalised email),
//     on the sign-in AND on every signed-in form that checks the current
//     password (change password, two-factor settings, /verify-password).
//     A browser that has proved the account's password (a right password,
//     or a password reset opened from it) gets a signed "known device" cookie
//     and its own counter for that account (KNOWN_DEVICE_ATTEMPTS), so a
//     stranger running the shared counter down locks out guessers, not the
//     owner's own browsers. The cookie is only ever issued after the password
//     was proved, so it opens no extra guesses to anyone who doesn't have it.
//   - LINK_REQUESTS_PER_ADDRESS: asks for an emailed link per address (reset,
//     sign-in link, "send the confirmation again"), counted whether or not the
//     address has an account, so the form can say plainly when it is full
//     without revealing anything. A reset or sign-in link is bounded by this
//     counter alone: other email to the address can't use up the owner's
//     recovery.
//   - EMAILS_PER_ADDRESS: every other emailed link per address (confirmation
//     on sign-up or sign-in, "you already have an account", a confirmation
//     asked for again); over it, the email is quietly not sent.
//
// The counters live where Better Auth keeps its own rate limits: the
// auth_rate_limit table (rateLimit model) in production, so every process
// behind the load balancer shares them, or this process for the memory
// adapter (unit tests). A row's key is "throttle:<kind>:<sha256 of the
// subject>", so the table never holds an email address, and its lastRequest
// column holds the moment the window ENDS: Better Auth prunes rows whose
// lastRequest is older than its longest window, which then never removes a
// live window of ours, and its own keys ("<ip>|<path>") never collide with these.
//
// take() is atomic (a guarded increment), so a burst of parallel requests
// can't all slip in under the limit before any of them is counted.
//

import { createHash } from "node:crypto";
import type { DBAdapter } from "better-auth";

/** At most `max` events per `windowSeconds`, a fixed window from the first event. */
export interface ThrottleRule {
  max: number;
  windowSeconds: number;
}

/** Wrong passwords per account: 10 per 15 minutes (a person mistyping gets plenty; a guesser gets ~1,000 a day). */
export const PASSWORD_ATTEMPTS: ThrottleRule = { max: 10, windowSeconds: 15 * 60 };

/** Wrong passwords per account from one known browser: the same budget, its own counter. */
export const KNOWN_DEVICE_ATTEMPTS: ThrottleRule = PASSWORD_ATTEMPTS;

/** Asks for an emailed link per address: 5 an hour, across reset, sign-in and confirmation links. Refused out loud. */
export const LINK_REQUESTS_PER_ADDRESS: ThrottleRule = { max: 5, windowSeconds: 60 * 60 };

/** Other emailed links per address (confirmation, "you already have an account"): 5 an hour, then quietly not sent. */
export const EMAILS_PER_ADDRESS: ThrottleRule = { max: 5, windowSeconds: 60 * 60 };

/**
 * The key for one subject (an email address, or "<address> <device id>" for a
 * known device); hashed so the table holds no addresses.
 */
export function throttleKey(kind: "password" | "device" | "request" | "email", subject: string): string {
  return `throttle:${kind}:${subjectDigest(subject)}`;
}

/** A subject's digest (sha256 of the trimmed, lower-cased text): what keys and the known-device cookie hold instead of an address. */
export function subjectDigest(subject: string): string {
  return createHash("sha256").update(subject.trim().toLowerCase()).digest("base64url");
}

export interface Throttle {
  /** Count one event. False (and nothing counted) when the window is already full. */
  take(key: string, rule: ThrottleRule): Promise<boolean>;
  /** Hand one event back — a password check that turned out right. */
  give(key: string): Promise<void>;
  /** Forget the window (a successful password reset ends a lockout). */
  clear(key: string): Promise<void>;
}

/** The adapter calls the database store needs. */
export type ThrottleAdapter = Pick<DBAdapter, "findMany" | "create" | "incrementOne" | "deleteMany">;

interface Row {
  key: string;
  count: number;
  /** When the window ends (ms since the epoch). */
  lastRequest: number | bigint;
}

const MODEL = "rateLimit";

/** Counters in the auth database (auth_rate_limit). `adapter` is read on each call (the instance is built after this). */
export function databaseThrottle(adapter: () => Promise<ThrottleAdapter>): Throttle {
  const read = async (db: ThrottleAdapter, key: string): Promise<Row | undefined> =>
    (await db.findMany<Row>({ model: MODEL, where: [{ field: "key", value: key }], limit: 1 }))[0];

  return {
    async take(key, rule) {
      const db = await adapter();
      // A few rounds at most: each lost race means someone else just moved the row.
      for (let round = 0; round < 4; round++) {
        const now = Date.now();
        const ends = now + rule.windowSeconds * 1000;
        const row = await read(db, key);
        if (!row) {
          try {
            await db.create({ model: MODEL, data: { key, count: 1, lastRequest: ends } });
            return true;
          } catch {
            continue; // created by a parallel request: read it again
          }
        }
        const endsAt = Number(row.lastRequest);
        if (endsAt <= now) {
          // The window is over: start a new one, unless a parallel request already did.
          const restarted = await db.incrementOne({
            model: MODEL,
            where: [
              { field: "key", value: key },
              { field: "lastRequest", value: endsAt },
            ],
            increment: {},
            set: { count: 1, lastRequest: ends },
          });
          if (restarted) return true;
          continue;
        }
        const counted = await db.incrementOne({
          model: MODEL,
          where: [
            { field: "key", value: key },
            { field: "lastRequest", operator: "gt", value: now },
            { field: "count", operator: "lt", value: rule.max },
          ],
          increment: { count: 1 },
        });
        if (counted) return true;
        if (row.count >= rule.max) return false;
      }
      return false;
    },
    async give(key) {
      const db = await adapter();
      await db.incrementOne({
        model: MODEL,
        where: [
          { field: "key", value: key },
          { field: "count", operator: "gt", value: 0 },
        ],
        increment: { count: -1 },
      });
    },
    async clear(key) {
      const db = await adapter();
      await db.deleteMany({ model: MODEL, where: [{ field: "key", value: key }] });
    },
  };
}

/** Counters in this process — for the memory adapter (unit tests), where nothing else is shared either. */
export function memoryThrottle(): Throttle {
  const windows = new Map<string, { count: number; endsAt: number }>();
  return {
    async take(key, rule) {
      const now = Date.now();
      const w = windows.get(key);
      if (!w || w.endsAt <= now) {
        if (windows.size >= 10_000) for (const [k, v] of windows) if (v.endsAt <= now) windows.delete(k);
        windows.set(key, { count: 1, endsAt: now + rule.windowSeconds * 1000 });
        return true;
      }
      if (w.count >= rule.max) return false;
      w.count += 1;
      return true;
    },
    async give(key) {
      const w = windows.get(key);
      if (w && w.count > 0) w.count -= 1;
    },
    async clear(key) {
      windows.delete(key);
    },
  };
}
