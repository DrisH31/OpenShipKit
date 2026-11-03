# Scaling

The honest ceiling of one app process and one Postgres, the signals that say
you are getting close, and what breaks **first** when you add a second
instance. The short version: one server holds far more than people expect, and
the first thing to break when you scale out is not speed but correctness — a
limit that quietly doubles, an image that exists on one machine only.

## What one server is

```
one server
  app       Node, one process (the Next.js standalone server)
  postgres  one database, DATABASE_POOL_MAX connections per app process (default 10)
  volumes   postgres_data, uploads (local disk)
```

Every public page is rendered on request: a handful of indexed Postgres reads
(the editable content in one query, then the posts the page shows) and React
rendering them. Nothing is cached between requests on purpose — see
[SEO, rule 1](seo.md#rules-that-cost-traffic) for why a time-based page cache
costs more than it saves here. Blog bodies are rendered from Markdown on each
request, which is the most expensive step on the site and still cheap.

**Don’t reason about capacity in requests per second you haven’t measured.**
Measure your own: the ratios below are what the architecture fixes.

## Why the ceiling is higher than it looks

- **The real constraint is one Node process rendering React**, not the
  database. Rendering is CPU work on one thread; queries are short and
  indexed.
- **Lists are paged.** `/blog` and the changelog read one page of posts at a
  time, and the sitemap reads body-less refs, so a long blog doesn’t make
  them heavier per request.
- **The pool is not the queue.** `DATABASE_POOL_MAX` defaults to 10 per
  process. Raising it rarely helps: the waiting just moves into Postgres, where
  it is harder to see. If requests queue for a connection, find the query that
  holds one.

## What breaks first, in order, when you add an instance

### 1. In-process rate limits multiply

`src/server/rate-limit.ts` keeps its counters in the process’s memory: the
contact, newsletter and feedback forms, the auth server actions and the MCP
endpoint. Two instances with a limit of 5 is a limit of 10, and nothing
reports it — the configuration still says five, the logs still say “rate
limited”. Better Auth’s own limits (sign-in, sign-up, two-factor, emailed
links) are stored in Postgres in production and stay correct.

Fix before the second instance: back `rateLimit()` with a shared store you run
(a Postgres table like `auth_rate_limit`, or a self-hosted Redis/Valkey — the
optional Redis module under `modules/redis`, if your checkout has it). If your
privacy policy says how long an IP is kept for rate limiting, it now describes
that store; update it in the same change.

### 2. Uploads live on one machine’s disk

`UPLOADS_DIR` is a local folder (the `uploads` volume). Two instances on **one**
host can mount the same named volume, and nothing changes. Two instances on
**two** hosts can’t: an image uploaded through one is a 404 from the other,
permanently, for half the requests.

Fix before the second **host**, not after: move the bytes to object storage
(any S3-compatible service, self-hosted MinIO or Garage, or Cloudflare R2), keep
storing only URLs in the database, and serve them from the bucket or a CDN.
It also takes image bytes off the app and out of the nightly volume archive.

### 3. Anything you add that caches in memory

OpenShipKit keeps no cross-request cache today, so two instances never
disagree about content. The day you add one (a cache of rendered posts, of
settings), it is per process: an admin’s edit invalidates the copy in the
process that handled the save and nowhere else, and the author sees their
correction, reloads, and sees the old text. That isn’t a bug anyone finds by
reading code. Cache in a shared store, or key the cache on the row’s
`updatedAt` so a stale entry can’t be served.

### 4. CPU, eventually

One Node process at 100% CPU shows up as latency on every route at once. That
is the point where a second instance is genuinely the answer — after 1–3 are
solved, not before.

### 5. Postgres, last

Usually not throughput but one query: an unindexed filter added to a list, a
`LIKE '%…%'` over bodies. `EXPLAIN (ANALYZE, BUFFERS)` that statement before
buying hardware. Keep the total of `DATABASE_POOL_MAX` × instances under
Postgres’s `max_connections`.

## The signals

- **Time to first byte on `/blog` at the origin.** No body rendering, so it
  isolates “React plus a couple of reads”. Climbing while Postgres is idle:
  you’re CPU-bound.
- **Memory that grows and never settles.** The in-process maps are capped (the
  rate limiter at 10,000 keys) precisely so they can’t be the leak.
- **Pool timeouts in the log.** Find the query holding a connection before you
  raise the pool.
- **`/api/health` flapping.** It answers 503 when the database doesn’t; the
  container’s healthcheck uses it, so repeated restarts mean the database, not
  the app.
- **Deploys getting slower.** The migrator runs before the new app starts; a
  migration that starts taking seconds is rewriting a table that is no longer
  small — split it ([deployment.md](deployment.md#migrations)).

## What to do, cheapest first

1. **Measure**, with the signals above. Most “we need to scale” is one slow
   query.
2. **Put a CDN in front.** Static assets (`/_next/static`, already immutable)
   and `/uploads/*` (random names, served `immutable`) stop touching the
   origin at all. Two rules: **never cache `/admin`, `/dashboard`, `/api` or
   anything with a session cookie**, and make the CDN **overwrite**
   `X-Forwarded-For` with the client address (or set the header your proxy
   trusts) — otherwise the client controls the first entry and every rate limit
   keys on a value an attacker picks.
3. **A bigger server before more servers.** A vertical step keeps every
   in-process assumption true; a second instance breaks two of them.
4. **Uploads to object storage** — required before a second host, useful
   before that.
5. **A shared rate-limit store, then a second instance** behind a load
   balancer, in that order.
6. **Postgres last**, by query, not by hardware. A read replica is a large step
   for a site whose reads are already small and indexed.

## When this shape stops being right

It runs out of *shape* before it runs out of capacity: many editors working at
once want drafts and review (the audit log records who did what, but there is
no approval step), and a catalogue of tens of thousands of posts wants search
that isn’t a `LIKE`. Both are features to add, not servers.
