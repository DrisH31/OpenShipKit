# Architecture

One Next.js 16 App Router app. Server Components render every page at request
time from Postgres; one set of services is the only way data changes. This
page is the map; [SPEC.md](../SPEC.md) is the contract.

## The picture

```
                 browser / crawler                       AI agent (MCP client)
                        │                                         │
                        ▼                                         ▼
  ┌──────────────── Caddy / nginx / Traefik (TLS, X-Forwarded-For) ────────────────┐
  └────────────────────────────────────────┬───────────────────────────────────────┘
                                           ▼
  ┌──────────────────────────── Next.js 16 (node server.js) ───────────────────────┐
  │                                                                                │
  │  src/proxy.ts ── optimistic: no session cookie on /dashboard, /admin → sign-in │
  │                                                                                │
  │  src/app/ (routes only)                                                        │
  │   (marketing)/  pages ──────── read ─────┐                                     │
  │   dashboard/    pages + server actions ──┤   requireUser() / requireAdmin()    │
  │   admin/        pages + server actions ──┤   (src/server/session.ts)           │
  │   api/forms/*   route handlers ──────────┤                                     │
  │   api/mcp       MCP protocol ── tools ───┤   agent key → scope check           │
  │   api/billing/* checkout, portal, webhook┤                                     │
  │   api/auth/*    Better Auth handler      │                                     │
  │                                          ▼                                     │
  │  src/server/services/*   THE write path: zod validate → DataStore → audit log  │
  │                                          │                                     │
  │  src/server/{data,auth,billing,email,media-store}.ts registries (lazy)         │
  │                                          │                                     │
  │  src/adapters/*  the only place a driver or SDK is imported                    │
  │    data/postgres (Drizzle) · auth/better-auth · media/s3                       │
  │    billing/{polar,stripe,razorpay} · email/{resend,smtp,console}               │
  │                                                                                │
  │  src/server/jobs  the runner in every process: claims due jobs in Postgres     │
  └──────────────┬───────────────────────────────┬───────────────────┬─────────────┘
                 ▼                               ▼                   ▼
          Postgres (yours)              Billing (optional)    Email (optional)
   app tables, jobs, auth_* tables  Polar, Stripe or Razorpay:  Resend or SMTP
   (dev: embedded PGlite)           checkout, portal, webhooks
                                    → /api/billing/webhook
```

## Layers

| Layer | Path | May import | Never |
|---|---|---|---|
| Contracts | `src/core/` | zod | anything with I/O |
| Content | `src/content/` | `src/core` | — |
| Adapters | `src/adapters/` | `src/core`, `src/content`, `src/server/env`, their SDK; to call back into the app, only the `src/server` modules SPEC §2 lists (the auth adapter: email, copy, `isBanned()` in `services/bans.ts`; the embedded database: the seed) | other adapters; a `src/server` module that imports the adapter back (`auth.ts`, `session.ts`) |
| Server | `src/server/` (`server-only`) | `src/core`, adapters (registries only) | client code |
| Services | `src/server/services/` | the DataStore via `getData()`, `recordAudit` | SDKs directly |
| Routes | `src/app/` | services, `session`, components | the DataStore for writes |
| Components | `src/components/` | `src/core` types, `src/lib`, `src/shared` | `src/server`/`src/adapters` from a client component |

## The write path

Every change — an admin saving the hero, a visitor submitting the contact
form, an agent publishing a post, a webhook recording a subscription — goes:

```
input ─▶ service (src/server/services/<area>.ts)
           1. parseInput(zodSchema, input)          refuse with ServiceError("invalid", …)
           2. read "before" from the DataStore
           3. write through the DataStore           conflict / not_found → ServiceError
           4. recordAudit(actor, action, entity, id, before, after)
         ◀─ the new value
```

A billing webhook (Polar, Stripe or Razorpay) takes the same path once its
signature is verified and the object re-fetched: the billing webhook sink
(`src/adapters/billing/webhook-sink.ts` for now, bound for
`src/server/services/billing-webhooks.ts`) upserts the subscription or
purchase through the DataStore and records the audit itself.

The actor says who: a user, an agent key (by name), the webhook, or `seed`.
`/admin/audit` (and the MCP `audit_*` tools) list every change; content, posts
and plans can be restored from their “before”.

## Reading a page

A public page is an async Server Component. It reads through services
(`getContent("hero")`, `listPublished("post")`) at request time — the root
layout is `force-dynamic` — so the HTML carries the content, JSON-LD and
metadata in the first byte. A content section nothing was saved to renders
its default from `src/content/defaults.ts`. A read that *fails* throws —
content, posts, users and billing alike — and the visitor gets the error page
(500, `noindex`): the template’s default copy on a renamed site, an empty
blog or a wrongly free user would each be worse than a 500, which crawlers
retry (SPEC invariant 3).

## Auth in one paragraph

Better Auth runs inside the app (`src/adapters/auth/better-auth/`), its tables
(`auth_user`, `auth_session`, `auth_account`, `auth_verification`,
`auth_two_factor`, `auth_rate_limit`) in your Postgres next to the app’s.
`getCurrentUser()` turns a Better Auth session into the app’s own `users` row
(roles and bans live there) and promotes `ADMIN_EMAILS` on sign-in. The proxy
only redirects on cookie presence; every page and action calls
`requireUser()`/`requireAdmin()`. [auth.md](auth.md).

## Billing in one paragraph

One provider at a time — Polar, Stripe or Razorpay (`BILLING_PROVIDER`) —
each an adapter in `src/adapters/billing/<provider>/` behind the
`BillingProvider` contract (`src/core/billing.ts`).
`/api/billing/checkout` asks the provider for a hosted checkout for a plan’s
price (the Polar product, Stripe price or Razorpay plan set in `/admin/plans`). The provider calls `/api/billing/webhook`;
the adapter verifies the signature, re-fetches the subscription or order from
the provider’s API, upserts it, and only then marks the event processed.
`getEntitlement(userId)` computes access from those rows. Nothing else grants
access. With teams on, an organisation holds the subscription, per seat
([teams.md](teams.md)); plan limits and metered usage are
[usage.md](usage.md). [billing.md](billing.md).

## Agents

`/api/mcp` speaks MCP (Streamable HTTP, JSON responses). A bearer agent key
(`osk_…`, stored as a SHA-256) has a scope — read, write or admin — and each
tool declares the least scope it needs. Tools call the same services, so an
agent’s change is validated and audited exactly like an admin’s. [mcp.md](mcp.md).

## Boot and environment

`src/instrumentation.ts` runs once per server process. Without `DATABASE_URL`
(and outside production) it opens the embedded database, migrates and seeds
it. In production it checks the environment first and refuses to start without
what every request needs (`src/server/boot-check.ts`). Either way it then starts
the background job runner ([jobs.md](jobs.md); `JOBS_RUNNER=off` skips it).
It never migrates a Postgres server: migrations are a deploy step
(`npm run db:migrate`, the compose `migrate` service), and `/api/health`
answers 503 while the database is behind the code
([observability.md](observability.md#health)).

All env is read lazily in `src/server/env.ts` — never at module scope — so
`next build` runs with no secrets and no database, and one image runs anywhere.

## Testing

- `tests/foundation.test.ts`, `tests/mcp.test.ts`, `tests/billing.test.ts`… run
  on the memory DataStore (`src/adapters/data/memory`), no database needed.
- `tests/contract/` is one suite every DataStore must pass; it runs on memory
  always and on Postgres when `TEST_DATABASE_URL` is set (CI does).
- `tests/modules/` tests the opt-in modules the same way (memory, and
  Postgres where the module has a store); `npm run typecheck:modules` checks
  them on their own.
- `npm run smoke` checks a running site from outside, read-only;
  `npm run e2e` drives a running dev or staging copy end to end (it writes,
  then deletes what it made).
