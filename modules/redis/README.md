# modules/redis — a seam, not an upgrade

A cache interface with an **in-memory default** and a Redis/Valkey
implementation behind the same shape, plus a fixed-window rate limiter that
is correct across replicas.

**Installs nothing** — it speaks the Redis protocol itself (`resp.ts`).
**Requires nothing; nothing requires it.** It sits under your code (and,
optionally, `modules/ai`’s per-minute limit), not above it. No hosted Redis
company is needed or assumed: you run Redis or Valkey next to the app, the
way you run Postgres.

---

## Do you need this?

Probably not yet. OpenShipKit deploys as **one** app container, and for one
container in-process state is the right answer: faster than any network hop,
nothing extra to run, back up or secure.

It becomes wrong at one moment: **when you run more than one replica of the
app.** Then:

- **In-process rate limits multiply.** The app’s `rateLimit()`
  (`src/server/rate-limit.ts`) counts per process, so two replicas with a
  limit of 5 allow 10 — silently: the config still says 5, the logs still say
  “rate limited”. That covers the contact and newsletter forms, the
  account-security actions, checkout and portal, feedback, and the MCP
  endpoint. (Better Auth’s own sign-in limits are already shared: they live
  in the `auth_rate_limit` table.)
- **Anything you cache in process goes stale per replica.** A write
  invalidates the copy in the process that handled it; the others serve the
  old value until their TTL runs out — an author reloads, sees the fix,
  reloads again and sees the old text. OpenShipKit’s core reads Postgres per
  request and has no such cache, so this is about caches **you** add.

So enable it when you run a second replica, when you need a cross-process
invalidation, or when you’re about to put a per-process counter in front of
something that spends money. Not because Redis is what serious apps have: a
second stateful service is a second thing that can be down.

## What it doesn’t fix

**Single-flight** (one query for a burst of misses on a cold key) is per
process: N replicas still issue N queries. **Durability**: this is a cache.
Nothing in it is the only copy, everything has a TTL, and losing the instance
must be survivable. Something you can’t rebuild from Postgres is a table.

## Using the cache

```ts
import { getCache } from "../../modules/redis/cache"; // path from your file

const cache = getCache();                              // memory, or Redis when REDIS_URL is set
const hit = await cache.get<Report>(`report:${id}`);
if (hit) return hit;
const report = await buildReport(id);                 // Postgres stays the source of truth
await cache.set(`report:${id}`, report, 60);          // a TTL is mandatory
return report;

// in the service that writes:
await cache.delete(`report:${id}`);
await cache.deleteByPrefix("report:");               // SCAN, never KEYS
```

`get()` never throws: a miss and an outage both return `null`, and “read the
database” is the right response to both. Writes fail silently for the same
reason. Values are JSON (a `Date` comes back as a string).

## Using the shared limiter

Same arguments and answer as the app’s `rateLimit()`, but async — so
converting a call site is adding `await`:

```ts
import { sharedRateLimit } from "../../../../modules/redis/rate-limit"; // path from your file

const { ok, retryAfterSeconds } = await sharedRateLimit(`export:${user.id}`, 10, 60_000);
if (!ok) return json(429, { error: "rate_limited", message: "Too many exports. Try again shortly." }, { "retry-after": String(retryAfterSeconds) });
```

Without `REDIS_URL` it counts in process, exactly like `rateLimit()`, so a
converted call site is correct before and after you add Redis. Key on
something an attacker can’t cheaply rotate: a user id, or `clientIp()` (IPv6
bucketed by /64). Never a header the client controls.

To share the app’s own limits across replicas, convert its call sites —
`rateLimit(` → `await sharedRateLimit(`:

| File | Limit |
|---|---|
| `src/server/services/contact.ts` | contact form, per IP |
| `src/app/api/forms/newsletter/route.ts` | newsletter form, per IP |
| `src/adapters/auth/better-auth/actions.ts` | account-security actions, per IP |
| `src/app/api/billing/checkout/route.ts` | checkout, per person |
| `src/app/api/billing/portal/route.ts` | billing portal, per person |
| `src/app/dashboard/feedback/actions.ts` | feedback, per person |
| `src/app/api/mcp/route.ts` | MCP, per key |
| `src/server/mcp/auth.ts` | MCP failed-auth, per IP (its `authBlocked` map is in-process too) |

And for `modules/ai`, swap the import in `modules/ai/rate-limit.ts` (the line
is written out there).

## Enable

**1. Run a Redis or Valkey server** next to the app, on a private network,
with a password and a memory cap.

With docker compose, use the override file in this folder (it adds a pinned
Valkey service with no published port, a 256 MB `allkeys-lru` cap and no
persistence, and sets the app’s `REDIS_URL`):

```bash
echo "REDIS_PASSWORD=$(openssl rand -hex 32)" >> .env
docker compose -f docker-compose.yml -f modules/redis/compose.yml up -d --build
```

On Dokploy or Coolify, add a Redis/Valkey service in the same project (or
paste the `redis` service from `compose.yml` into `docker-compose.yml`) and set
`REDIS_URL` on the app. Any Redis-protocol server works, self-hosted or not.

**2. Set the variables**, and add this block to `.env.example`:

```bash
# ---- Cache and shared rate limits (modules/redis) — in-memory until REDIS_URL is set ----
# REDIS_URL=                        # redis://:password@redis:6379/0 (rediss:// for TLS)
# REDIS_PASSWORD=                   # used by modules/redis/compose.yml; openssl rand -hex 32
# REDIS_KEY_PREFIX=openshipkit:      # different for every deployment sharing a server
# REDIS_COMMAND_TIMEOUT_MS=250      # slower than this counts as a miss
# REDIS_FAIL_OPEN=true              # limiter when Redis is down: true = allow, false = refuse
```

**3. Use it** — `getCache()` in your services, `sharedRateLimit()` at the call
sites above. Nothing to mount, nothing to migrate.

**4. Optional:** show it in `/api/health` (`await getCache().ping()`), or log
it at boot from `src/instrumentation.ts`:

```ts
const { getCache } = await import("../modules/redis/cache");
const cache = getCache();
console.info(`[cache] ${cache.kind}${cache.kind === "redis" ? (await cache.ping()) ? " (reachable)" : " (UNREACHABLE)" : ""}`);
```

## Environment

| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | — | Empty means in-memory, a valid setting for one server |
| `REDIS_KEY_PREFIX` | `openshipkit:` | Two deployments sharing a server (staging and production) read each other’s cache unless these differ |
| `REDIS_COMMAND_TIMEOUT_MS` | `250` | Short on purpose: a cache slower than the database it fronts is worse than none |
| `REDIS_FAIL_OPEN` | `true` | See below |

### `REDIS_FAIL_OPEN` is a real decision

When Redis can’t be reached the limiter can’t count.

- **`true`** (default) — allow. An outage is a short absence of limiting.
  Right for sign-in and forms: briefly unprotected beats unreachable.
- **`false`** — refuse. An outage refuses everything behind the limiter. May
  be the cheaper failure in front of something that spends money per call.

Either way it is logged, and the verdict says `degraded: true` — worth a
metric, because a limiter quietly not limiting for a week is the worst state.
The cache has no such switch: a miss falls through to Postgres.

## How the client behaves

`resp.ts` is a small RESP2 client over `node:net`/`node:tls`: it connects on
first use (never at import, so `next build` doesn’t dial anything), sends
`AUTH`/`SELECT` from the URL, fails commands at once while disconnected
instead of queueing them, gives every command `REDIS_COMMAND_TIMEOUT_MS`,
drops a connection whose command timed out, reconnects with a capped backoff
(200 ms × failures, at most 5 s), and logs a failure once — the error’s
message, never the URL (it carries the password). The counter is one Lua
script (`INCR`, and `EXPIRE` only on the first hit), so a window can’t lose
its TTL between two commands. Prefix deletes use `SCAN` with the prefix
escaped: `KEYS` blocks the whole single-threaded server for the traversal.

Prefer a full client (ioredis, node-redis)? Implement `CacheAdapter` over it
in `redis-cache.ts`; nothing else changes.

## Removing it

1. Unset `REDIS_URL`: everything falls back to in-memory at once. Converted
   call sites keep working (in process).
2. Remove the `redis` service (or stop using `modules/redis/compose.yml`).
3. If no code imports it any more, delete `modules/redis/` and
   `tests/modules/redis.test.ts`.

No tables, nothing to drop: a cache can be removed without a data question.
