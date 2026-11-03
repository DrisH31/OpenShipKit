# Data

Everything lives in one Postgres: the app’s tables and Better Auth’s
(`auth_*`). The app talks to it through Drizzle ORM in
`src/adapters/data/postgres/`, behind the `DataStore` contract in
`src/core/data.ts`.

## Three ways to run it

| Setting | Database | For |
|---|---|---|
| `DATABASE_URL` unset (development) | **Embedded Postgres** (PGlite) in `.data/pglite` | `npm run dev` on a fresh clone |
| `DATABASE_URL=postgres://…` | Your Postgres server | production, and local work against a real server |
| `DATA_PROVIDER=memory` | In-process memory store | unit tests only — resets on every restart |

### The embedded database

PGlite is Postgres compiled to WebAssembly, running inside the Node process.
Same SQL, same migrations, same queries as production — and nothing to
install. On boot, `src/instrumentation.ts` migrates it and seeds a brand-new
one; data persists in `PGLITE_DIR` (default `.data/pglite`, git-ignored).

- **One process at a time.** Opening it takes a lock file
  (`.data/pglite.lock`); a second process gets an error naming the holder.
  Stop `npm run dev` before `npm run db:migrate`, `db:seed` or `mcp:key`
  against it.
- **Start over:** stop the dev server, delete `.data/pglite`, start again.
- `PGLITE_DIR=memory://` keeps it in memory (CI, throwaway demos).
- **Not for production.** With `NODE_ENV=production` and no `DATABASE_URL` the
  app refuses to start (`OPENSHIPKIT_ALLOW_EMBEDDED_DB=true` overrides, for a
  single-process demo only).

### A real Postgres locally

```bash
npm run setup -- --compose --site-url http://localhost:3000   # writes .env with a generated POSTGRES_PASSWORD
docker compose up -d postgres                       # Postgres 18 on 127.0.0.1:5433
echo "DATABASE_URL=postgres://openshipkit:$(grep ^POSTGRES_PASSWORD= .env | cut -d= -f2)@127.0.0.1:5433/openshipkit" >> .env.local
npm run db:migrate && npm run db:seed
npm run dev
```

Compose refuses to run any command until `.env` has a non-empty
`POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` and `NEXT_PUBLIC_SITE_URL` (a copy
of `.env.example` has them empty), which is why the first step is
`npm run setup -- --compose`. `npm run dev` reads both files,
and a key set in `.env.local` wins over the same key in `.env`. Postgres keeps the password it was first created with: if you
change it in `.env` later, `docker compose down -v` (this deletes the local
data) and start again.

## Connection settings

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | — | `postgres://user:password@host:5432/db` (URL-encode special characters in the password) |
| `DATABASE_POOL_MAX` | `10` | connections per app process |
| `DATABASE_SSL` | `auto` | `auto`: no TLS for localhost and docker service names (`postgres`, `db`), TLS for everything else. Also `require` (encrypted, unverified), `verify-full` (verified), `disable` |
| `DATABASE_SSL_CA` | — | PEM text of a private CA for `verify-full` |

A private-network IP (`10.0.0.5`) counts as remote under `auto`: set
`DATABASE_SSL=disable` if that Postgres has no TLS, or `verify-full` with its
CA if it does.

## Tables

| Table | Holds |
|---|---|
| `users` | the app’s users: role, ban, last seen — keyed by the auth identity |
| `content` | one JSON document per editable section (`site`, `hero`, `faq`, …) |
| `posts` | blog posts, changelog entries and pages (`kind`), drafts and published; `listed` (false = unlisted: live, off the lists — [content.md](content.md#posts-changelog-and-pages)) |
| `plans` | pricing plans and their prices (`polarProductId` per price) |
| `subscriptions`, `purchases`, `billing_customers` | what Polar’s webhooks reported |
| `webhook_events` | processed webhook ids (idempotency) |
| `feedback` | feedback and contact-form messages |
| `subscribers` | newsletter sign-ups |
| `agent_keys` | MCP keys (SHA-256 only) |
| `audit_log` | every change, with before and after |
| `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor`, `auth_rate_limit` | Better Auth |

The schema is `src/adapters/data/postgres/schema.ts`. Ids are uuids,
timestamps `timestamptz`. Deleting a user deletes their subscriptions,
purchases and billing customer rows; their feedback stays, unlinked.

## Migrations

Migrations are SQL files in `drizzle/`, generated from `schema.ts` and
committed. They are the only way the schema changes.

```bash
# 1. edit src/adapters/data/postgres/schema.ts
npm run db:generate -- --name add_company_to_users   # writes drizzle/00NN_add_company_to_users.sql
# 2. read the SQL; commit it
npm run db:migrate                                    # apply (stop npm run dev first on the embedded database)
```

- `db:generate` needs no database. `db:migrate` targets `DATABASE_URL`, or the
  embedded database when it’s unset.
- Applied migrations are recorded in `drizzle.__drizzle_migrations`; each
  pending one runs in a transaction; failure exits non-zero (a deploy stops).
- Don’t use `drizzle-kit push` against a real database, and don’t edit a
  migration that has been applied anywhere — generate a new one.
- Prefer additive changes (nullable columns, new tables). Drop a column one
  release after the code stops reading it.
- A new field also needs: the domain type (`src/core/types.ts`), the mapping in
  `src/adapters/data/postgres/index.ts` **and** the memory adapter, and a
  contract test (`tests/contract/`). [AGENTS.md](../AGENTS.md#add-a-database-column)
  has the full recipe.

`npm run db:studio` opens drizzle-kit’s browser UI against `DATABASE_URL`.

## Seed data

`npm run db:seed` seeds a brand-new database once with the starter plans
(`src/content/seed.ts`) and posts (`src/content/seed-posts.ts`). The first run
writes a marker to the audit log — the `seed.run` entry (entity `seed`) — and
every later run sees it and adds nothing, so it is safe on every deploy (the
Docker migrator runs it each time) and a starter plan or post you delete stays
deleted. A database that already has plans or posts but no marker (seeded
before the marker existed, or filled by hand) counts as seeded and gets one.
`npm run db:seed -- --force` adds back any starter plan or post that is
missing (by key, or by kind and slug). Neither ever overwrites an edit, and
every insert is in the audit log as actor `seed`. Every run, marker or not,
also rewrites stored tags into their normalised form (“Getting Started” →
`getting-started`), which changes nothing once they are clean. Delete the
sample posts in `/admin/posts` once you have your own: on a renamed site, ones
still in OpenShipKit’s words are kept out of search
([content.md](content.md#posts-changelog-and-pages)).

## Uploads

Uploaded images are files under `UPLOADS_DIR` (default `.data/uploads` in
development, git-ignored; `/app/uploads` on the `uploads` volume under
compose; a folder outside the checkout on plain Node), uploaded through
`/admin/media` ([content.md](content.md#media-library)). The database stores
only their URLs — never the bytes: `pg_dump` would double them as hex, and
every image read would hold a pool connection. So the database and the folder
are **one** backup, taken together every time: a dump restored without its
uploads gives posts whose covers 404; uploads without the matching dump are
files nothing points at. Put the folder on persistent storage (the compose
`uploads` volume) — a container’s own filesystem is replaced on every
deploy.

## Backups

`deploy/backups/backup.sh` takes both halves nightly — `pg_dump` and an archive
of the uploads, with one timestamp — keeps 14 days, and optionally copies them
off-site with rclone. `restore.sh --rehearse` restores the dump into a scratch
database, unpacks the uploads into a scratch folder and counts both;
`--replace` puts both back. [deploy/backups/](../deploy/backups/README.md) —
including how to check the off-site copies themselves, not the job’s exit
status.

## Tests against Postgres

The contract suite (`tests/contract/`) runs every DataStore method on the
memory store and — with `TEST_DATABASE_URL` set to a **throwaway** database,
truncated before each test — on Postgres. CI runs both on Postgres 18.
[CONTRIBUTING.md](../CONTRIBUTING.md#check-your-change) shows the commands.
