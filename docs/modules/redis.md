# Redis (`modules/redis`)

A cache with an in-memory default and a Redis/Valkey implementation behind
the same interface, and a rate limiter that is correct across replicas. **The
enable steps, variables and API are in
[modules/redis/README.md](../../modules/redis/README.md).** This page is about
whether you need it.

## When you want it

**When the app runs more than one replica.** Not when traffic is high, and
not because Redis is what serious apps have: one OpenShipKit container on a
modest server serves a lot, and a second stateful service is a second thing
to run, secure and watch.

What goes wrong at two replicas without it:

- **Rate limits multiply.** The app’s limiter counts per process: forms,
  account-security actions, checkout, feedback and MCP allow N× their limit
  behind N replicas, and nothing says so. Converting those call sites to the
  module’s `sharedRateLimit()` fixes it (the module README lists them).
  Better Auth’s sign-in limits are already shared (they’re in Postgres), and
  the AI module’s daily quota is too.
- **Caches you add go stale per replica.** OpenShipKit reads Postgres on every
  request and caches nothing across requests, so this only matters once you
  add a cache — and then it should be this one.

## What it doesn’t need

No hosted Redis company and no npm package. It speaks the Redis protocol
itself, to Redis or Valkey that you run next to the app — a compose service
(an override file ships in the module), or a service in Dokploy or Coolify.
Without `REDIS_URL` it is in-memory, which is correct for one server, so code
written against it works before and after you add the server.

## What enabling changes

| Where | Change |
|---|---|
| `docker-compose.yml` (or the override `modules/redis/compose.yml`) | a pinned Valkey service, no published port, memory-capped, no persistence |
| your environment | `REDIS_URL`, `REDIS_PASSWORD`, `REDIS_KEY_PREFIX` |
| your code | `getCache()` where you cache; `await sharedRateLimit(…)` where you limit |
| `modules/ai/rate-limit.ts` | optional: one import line, to share the AI per-minute limit |

No tables, no migrations, no routes.

## Operating it

- **Never publish its port.** The app reaches it over the private network; a
  published port is on the server’s public address. Use a password anyway.
- **Give it a memory cap** with an eviction policy (`allkeys-lru`), so the
  cache is what suffers first when memory runs short — not Postgres.
- **Don’t back it up.** It is a cache; everything in it can be rebuilt.
- **One prefix per deployment** (`REDIS_KEY_PREFIX`) if staging and production
  ever share a server.
- **Decide `REDIS_FAIL_OPEN`**: allow (default) or refuse when the limiter
  can’t reach Redis. It is logged either way.

## Checking it

1. `npm run check`.
2. With `REDIS_URL` set, log `getCache().kind` and `await getCache().ping()`
   at boot (snippet in the module README): `redis (reachable)`.
3. Stop the Redis service: pages keep working (cache misses read Postgres),
   the log says the connection failed once, and limits follow
   `REDIS_FAIL_OPEN`. Start it again: the log says it reconnected.
