# OpenShipKit on Coolify

[Coolify](https://coolify.io) is an open-source, self-hosted PaaS. OpenShipKit
deploys on it as a **Docker Compose** resource built from your repository:
Coolify reads `docker-compose.yml` (Postgres, the one-shot `migrate`, the
app) and puts its own proxy and Let’s Encrypt certificates in front. You don’t
use the `https` (Caddy) profile here.

Menu names below match Coolify v4; the steps are the same if yours differ.

## 1. Create the resource

1. **Projects → your project → + New → Resource**.
2. Pick your Git source: **Public Repository** (your fork’s URL) or a GitHub
   App / deploy key for a private one. Branch `main`.
3. **Build Pack: Docker Compose**, compose file location `/docker-compose.yml`.

Coolify parses the file and lists the services: `postgres`, `migrate`, `app`
(and `caddy`, which stays off — it’s behind a profile).

## 2. Environment variables

Coolify lists every `${…}` the compose file uses. The four below are the
minimum: compose refuses to start without `NEXT_PUBLIC_SITE_URL`,
`BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`, and `ADMIN_EMAILS` makes you the
admin. Everything else in `.env.example` you add yourself, and it reaches the
app through the compose file’s `env_file`.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://example.com` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` (hex: it goes into a URL) |
| `ADMIN_EMAILS` | your address |

Add `RESEND_API_KEY` and `EMAIL_FROM` before you sign up: production requires
a verified email, and without Resend the link is never sent or logged
([docs/email.md](../docs/email.md#no-resend-yet-verifying-the-first-admin)).
Add any other optional ones from `.env.example` the same way (`POLAR_*`,
`AUTH_MAGIC_LINK`…). On your laptop,
`npm run setup -- --compose --file .env.deploy --site-url https://example.com --admin-email you@example.com`
generates a complete set you can paste in. Writing it to `.env.deploy` keeps it
away from `npm run dev`, which would read a `.env`. Delete the file afterwards
and keep the values in your password manager. Leave `DATABASE_URL` and
`DOMAIN` empty.

Mark `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, `RESEND_API_KEY`,
`POLAR_ACCESS_TOKEN` and `POLAR_WEBHOOK_SECRET` as secrets (not build
variables): the image build needs none of them.

## 3. Domain

Open the **app** service and set **Domains** to `https://example.com:3000` —
the `:3000` tells Coolify’s proxy which container port to send traffic to; the
public URL stays `https://example.com`. Leave the other services without a
domain. Point the DNS `A`/`AAAA` record at the server first.

If the server runs other stacks that publish `127.0.0.1:3000` or `:5433`, set
`APP_PORT` and `POSTGRES_HOST_PORT` to free ports; the proxy doesn’t use them.

## 4. Deploy

Press **Deploy**. In the logs: Postgres healthy → `migrate` applies migrations
and seeds → the app starts. Then:

```bash
npm run smoke -- https://example.com
```

## Updates and backups

- Push to `main` with automatic deployment on (GitHub App or webhook), or press
  **Redeploy**. `migrate` runs every time and applies only new migrations.
  The app container is replaced before `migrate` runs, so the site is down
  for those seconds and stays down if a migration fails (the deployment log
  says why). Back up before a release whose changelog mentions a migration.
- Coolify’s scheduled backups cover databases created as Coolify resources.
  OpenShipKit’s Postgres is inside the compose resource, so schedule
  [backups/backup.sh](backups/README.md) (Coolify **Scheduled Tasks** or cron on
  the host), keep an off-site copy, and rehearse a restore. It backs up the
  `uploads` volume (uploaded images) with the database: the database only
  holds the images’ URLs, so one without the other restores broken pages.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Set POSTGRES_PASSWORD in .env` (or `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`) | Fill the variable in Coolify and redeploy. |
| 404 / “no available server” | The domain must be on the `app` service, with `:3000`. |
| Redirect loop or wrong links in emails | `NEXT_PUBLIC_SITE_URL` must match the public `https://` origin exactly. |
| `migrate` fails with “password authentication failed” | The Postgres volume was created with an older password; set it back, or change it inside Postgres (`ALTER USER`). |
