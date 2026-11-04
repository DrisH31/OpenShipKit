# Deployment

OpenShipKit is one Node server plus one Postgres, and it runs on any Linux server you control: a VPS with docker compose and Caddy, Dokploy, Coolify, or Node under systemd. This page helps you choose, then covers what every deployment has in common.

Every option uses the same image and the same environment variables, so moving between them later means copying the env file and restoring a database dump. The step-by-step guides live in [deploy/](../deploy/README.md).

## Choose where it runs

| You have… | Use | HTTPS from |
|---|---|---|
| A fresh Linux VPS and SSH | **[docker compose + Caddy](../deploy/vps/README.md)** (recommended) | Caddy, automatic Let’s Encrypt |
| A server running [Dokploy](https://dokploy.com) | [a Dokploy Compose service](../deploy/dokploy.md) | Dokploy’s Traefik |
| A server running [Coolify](https://coolify.io) | [a Coolify Docker Compose resource](../deploy/coolify.md) | Coolify’s proxy |
| No Docker, or a Node host with its own Postgres | [`node server.js` under systemd](../deploy/node/README.md) | nginx or Caddy in front |

Then, whichever you picked:
[deploy/backups/](../deploy/backups/README.md) (nightly dumps of the database
**and** the uploads, an off-site copy, a restore rehearsal) and
[deploy/hardening.md](../deploy/hardening.md) (the checklist after your first
deploy). An AI agent can do every step with you: the
[AI setup guide](ai-setup.md) has a prompt for each host.

**docker compose + Caddy on a VPS.** This is the default, and the one the
other options are built from. `docker-compose.yml` runs Postgres 18, a one-shot
`migrate` service (migrations, then the seed) and the app. Under the `https`
profile it also runs Caddy, which gets the certificate for `DOMAIN` by itself.
The app and Postgres are published on `127.0.0.1` only, so the firewall has
just 22, 80 and 443 open. A €5–10 a month VPS with 2 GB of RAM runs all of it, and the guide goes from
a blank Ubuntu server to HTTPS in about fifteen minutes.
Updates are three commands that keep the old app serving while migrations run
([Updating](../deploy/vps/README.md#updating)).

**Dokploy and Coolify.** These are open-source, self-hosted PaaS dashboards
over Docker on your own server. Both deploy the **same compose file** from
your git repository, without the Caddy profile: their own proxy (Traefik on
Dokploy, Coolify’s proxy on Coolify) terminates HTTPS and routes the domain to
the `app` service on port 3000. You paste the variables from
`npm run setup -- --compose --file .env.deploy` into the dashboard’s
environment tab, and a push to `main` can redeploy automatically. One
difference from plain compose: a redeploy is a single `up`, so the site is
down for the few seconds `migrate` runs. Their built-in backup features cover
databases they created themselves. OpenShipKit’s Postgres lives inside the
compose service, so you schedule [`backup.sh`](../deploy/backups/README.md)
there too (a Dokploy Schedule, a Coolify Scheduled Task, or host cron). Pick
one of these if you already run other apps on it, or want a dashboard for
logs and redeploys. Both also have MCP servers an agent can drive
([AI setup](ai-setup.md#optional-third-party-mcp-servers)).

**Plain Node.** `npm run build` makes a standalone server
(`.next/standalone/server.js`). [deploy/node/](../deploy/node/README.md) runs
it under systemd behind nginx or Caddy, with a Postgres you install or one you
already have, and `deploy/node/deploy.sh` does build → migrate → seed →
restart on each release. Use it on a server that can’t run Docker, or one that
already runs Node apps this way.

**Not covered: serverless platforms.** See
[Platforms that aren’t a server](#platforms-that-arent-a-server).

## Required in production

| Variable | Why |
|---|---|
| `DATABASE_URL` | Production refuses to start without it (compose assembles it from `POSTGRES_*`) |
| `BETTER_AUTH_SECRET` | Signs sessions; 32+ random bytes. The app throws without it in production |
| `NEXT_PUBLIC_SITE_URL` | Your `https://` origin: canonical URLs, sitemap, emails, auth callbacks, Origin checks |
| `ADMIN_EMAILS` | Who becomes admin on sign-in (in practice: required once) |

And one folder: **`UPLOADS_DIR`** on persistent storage — uploaded images
live there, the database stores only their URLs. Compose mounts the `uploads`
volume at `/app/uploads` (and pins the variable); on plain Node use a folder
outside the checkout. Back it up with the database
([deploy/backups](../deploy/backups/README.md)). Or keep uploads in an
S3-compatible bucket (`S3_*`, `MEDIA_STORAGE=s3`): then `backup.sh` doesn’t
cover them, and you back the bucket up yourself
([content.md](content.md#media-library)).

Strongly recommended before real users: `RESEND_API_KEY` + `EMAIL_FROM`, or
`SMTP_URL` + `EMAIL_FROM` for your own mail server (production requires email
verification; [email.md](email.md)). Optional:

| Variable | For |
|---|---|
| `POLAR_*`, `STRIPE_*` or `RAZORPAY_*` (and `BILLING_PROVIDER`) | Charging, one provider at a time ([billing.md](billing.md)) |
| `BILLING_METERED_METRICS` | Reporting usage to Polar or Stripe meters ([usage.md](usage.md)) |
| `OPENSHIPKIT_TENANCY=org` | Teams ([teams.md](teams.md)) |
| `OPENSHIPKIT_PROFILE=site`, `OPENSHIPKIT_WITHOUT` | A content site, or the blog or MCP switched off ([site-profile.md](site-profile.md)) |
| `ERROR_TRACKING_DSN` | Errors sent to GlitchTip or Sentry ([observability.md](observability.md)) |
| `JOBS_RUNNER=off` | Processes that shouldn’t run background jobs ([jobs.md](jobs.md#running-it)) |
| `GITHUB_*`/`GOOGLE_*`, `AUTH_MAGIC_LINK` | More ways to sign in ([auth.md](auth.md)) |
| `INDEXNOW_KEY` | Faster recrawls ([seo.md](seo.md#getting-crawled)) |

All of them: [.env.example](../.env.example). A choice set without what it
needs stops the app at start, with a line that names the missing variable: a
billing provider without its key and webhook secret, `EMAIL_PROVIDER=smtp`
without `SMTP_URL` or `EMAIL_FROM`, `MEDIA_STORAGE=s3` without its `S3_*`
values ([troubleshooting.md](troubleshooting.md#production)).

A reverse proxy you run yourself must accept request bodies of at least
**6 MB** on `POST /api/admin/media` (an image of up to 5 MB plus the form’s
framing). nginx’s default `client_max_body_size` is 1 MB:
[deploy/node/nginx.conf](../deploy/node/nginx.conf) raises it for that one
path. Caddy has no limit by default.

`npm run setup -- --compose` writes a `.env` with the secrets generated.

## The image

`Dockerfile` has two targets built from the same source:

| Target | Runs | Notes |
|---|---|---|
| `runner` (default) | `node server.js` (Next.js standalone) as user `node` | `HEALTHCHECK` on `/api/health` (readiness); port 3000; `/app/uploads` created owned by `node`, `UPLOADS_DIR=/app/uploads` |
| `migrator` | `npm run db:migrate && npm run db:seed`, then exits | full `node_modules` (drizzle, tsx) |

The build needs no build args and reads no env: the same image runs in every
environment, configured at runtime.

## Migrations

`npm run db:migrate` applies the SQL files in `drizzle/` that haven’t run yet
(recorded in `drizzle.__drizzle_migrations`), each in a transaction, and exits
non-zero on failure. `npm run db:seed` seeds a brand-new database once (a
`seed.run` marker in the audit log stops later runs, so deleted starter rows
stay deleted); `npm run db:seed -- --force` adds back any starter plan or post
that is missing. Neither overwrites an edit. Both are safe on every deploy.

Order on each deploy: **build → migrate → seed → start the new app**. On plain
Node, `deploy/node/deploy.sh` does it. With compose, `app` waits for `migrate`
to complete successfully, but `docker compose up -d --build` stops the old app
container before that wait — so the site is down while migrations run, and
stays down if one fails. Update in three steps instead
([deploy/vps/](../deploy/vps/README.md#updating)):

```bash
docker compose --profile https build
docker compose run --rm migrate          # fails here → the old app is still serving
docker compose --profile https up -d
```

On Dokploy and Coolify a redeploy is a single `up`, with the same short
downtime while `migrate` runs; that’s fine for additive migrations.

A deploy that skips the migrations shows up in `/api/health`: it answers 503
with `"schema":{"ok":false,"state":"behind"}` until `npm run db:migrate` has run.

Migrations are written to be additive (new nullable columns, new tables), so
the old app keeps working while they run. A destructive change gets its own
release, after the code stops using the column.

## Health and checks

- `GET /api/health` → `200 {"ok":true,…}` when the database answers and has
  every migration the code expects, `503` otherwise. This is **readiness**: use
  it for uptime monitors and load balancers. It also reports whether background
  jobs keep up (`"jobs":{"ok":…}`), which doesn’t change the status code. Safe
  to expose; it reveals no secrets or counts.
- `GET /api/health/live` → `200` whenever the process answers, without
  touching the database. This is **liveness**: point restart policies here, so
  a database blip doesn’t restart a healthy app.
  [observability.md](observability.md#health) has what each field means.
- `npm run smoke -- https://example.com` after every deploy: pages (with their
  canonicals and robots tags), feeds, sitemap, robots, llms.txt, JSON-LD,
  signed-out redirects, security headers, that `/uploads/` 404s a made-up
  file, and that MCP refuses a missing key. `--mcp-key <key>` also checks
  `initialize` and `tools/list`, and that unlisted posts are live, indexable
  and in the sitemap but off `/blog`; `--indexnow-key <key>` checks that
  `/<key>.txt` answers with the key. Read-only.
- `npm run e2e -- https://staging.example.com --email e2e@example.com --email-log <server log>`
  on a **staging** copy (it writes): signs up, becomes admin through
  `ADMIN_EMAILS`, edits a section, publishes a post and checks it everywhere,
  sends the contact form, calls MCP, then deletes what it made. CI runs it
  against the production build on every push.

**During a database outage** `/api/health` answers 503, so the container’s
healthcheck and your monitor notice — point uptime checks at it, not at `/`.
Every page that reads the database answers with the error page instead:
HTTP 500, `noindex`, “try again” (SPEC invariant 3). That includes the
landing page and every other page built from editable content, the blog, the
sitemap, the feeds and the llms files. It is deliberate. A failed content read
never falls back to the default copy: on a renamed site the defaults are the
template’s words — OpenShipKit’s name, tagline and Organization JSON-LD — and a
200 carrying them would get another product indexed under your domain. An
empty 200 would tell crawlers the site shrank. A 500 is retried, and is
forgotten once the database is back. (The defaults in `src/content/defaults.ts`
are still what a section shows when nothing is stored for it yet.)

## Behind a proxy

Terminate TLS in front (Caddy, nginx, Traefik, a load balancer) and pass
`Host`, `X-Forwarded-Proto` and `X-Forwarded-For` **set to the client address**
(not appended — rate limits key on its first entry). Bind the app to
`127.0.0.1` or a private network.

**A CDN proxy in front (Cloudflare’s orange cloud, for example)** is a separate
decision. Start with the DNS records set to **DNS only**, so visitors reach
your server directly as the guides assume. If you later proxy through a CDN,
two rules apply ([scaling.md](scaling.md#what-to-do-cheapest-first)): never
cache `/admin`, `/dashboard`, `/api` or anything with a session cookie, and
make sure the client address reaches the app. Otherwise every visitor shares
the CDN’s addresses, and with them one rate limit.

## Scaling

One app process handles a lot: pages are server-rendered from Postgres with no
external calls. Before you add a second instance, know that:

- the in-app rate limiter for forms and MCP is per process (Better Auth’s own
  limits are stored in Postgres and are shared);
- uploads are on one machine’s disk: a second **host** needs them in a
  bucket first (`MEDIA_STORAGE=s3`, [content.md](content.md#media-library));
- every process runs the background job runner; that’s safe (jobs are claimed
  with a lock), and `JOBS_RUNNER=off` keeps one from running them
  ([jobs.md](jobs.md#running-it));
- `DATABASE_POOL_MAX` (default 10) is per process — keep the total under
  Postgres’s `max_connections`;
- the embedded database is never for production.

[scaling.md](scaling.md) has what breaks first, the signals to watch, and the
order to fix things in (a CDN and a bigger server come before a second one).

## Platforms that aren’t a server

OpenShipKit is built for a long-running Node server next to its Postgres. A
serverless platform can run the build, but you’d need an external Postgres,
a pooled connection with a small `DATABASE_POOL_MAX`, and a separate migration
step — not covered by these guides.
