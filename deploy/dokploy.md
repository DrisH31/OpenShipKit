# OpenShipKit on Dokploy

[Dokploy](https://dokploy.com) is an open-source, self-hosted PaaS: a web UI
over Docker and Traefik on your own server. OpenShipKit deploys on it as a
**Compose** service using the repository’s own `docker-compose.yml` —
Postgres, the one-shot `migrate` and the app — with Dokploy’s Traefik in front
for domains and HTTPS. You don’t use the `https` (Caddy) profile here.

Menu names below match Dokploy 0.2x; if yours differ, the steps are the same.

## 1. Create the service

1. **Projects → Create Project** (“openshipkit”), then **Create Service → Compose**.
2. **Provider**: your Git provider (GitHub, GitLab, Gitea…) or a public Git URL
   of your fork; branch `main`.
3. **Compose Path**: `./docker-compose.yml`. Compose type: **Docker Compose**
   (not Stack).

## 2. Environment

Open **Environment** and paste the variables. Generate them on your laptop,
into a file the dev server never reads (a `.env` in your development checkout
would be loaded by `npm run dev` too):

```bash
npm run setup -- --compose --file .env.deploy --site-url https://example.com --admin-email you@example.com
cat .env.deploy          # paste this into Environment, then:
rm .env.deploy
```

`.env.*` files are git-ignored, but don’t keep this one: it holds the
production secrets. Save a copy in your password manager instead. At minimum:

```dotenv
NEXT_PUBLIC_SITE_URL=https://example.com
BETTER_AUTH_SECRET=<generated>
POSTGRES_PASSWORD=<generated, hex>
ADMIN_EMAILS=you@example.com
```

Dokploy writes them to a `.env` next to the compose file, which compose reads
for both `${…}` substitution and the containers’ environment. Leave
`DATABASE_URL` and `DOMAIN` empty — compose builds the URL from `POSTGRES_*`,
and Traefik (not Caddy) handles the domain.

**Ports.** The compose file publishes the app on `127.0.0.1:3000` and Postgres
on `127.0.0.1:5433`. If another stack on the server already uses them, set
`APP_PORT` and `POSTGRES_HOST_PORT` to free ports. Traefik doesn’t need either:
it reaches the container over Docker’s network.

## 3. Domain

**Domains → Add Domain**:

| Field | Value |
|---|---|
| Service name | `app` |
| Host | `example.com` |
| Path | `/` |
| Container port | `3000` |
| HTTPS | on, certificate provider **Let’s Encrypt** |

Point the domain’s `A` (and `AAAA`) record at the server first; the
certificate is issued once it resolves.

## 4. Deploy

Press **Deploy** and open the logs. You should see Postgres become healthy,
`migrate` print `applied 0000_init` (first run) or `Up to date`, then the app
start. Open `https://example.com`, sign up with the address in `ADMIN_EMAILS`
and open the verification email (production sends it only through Resend: set
`RESEND_API_KEY` and `EMAIL_FROM` first, or see
[docs/email.md](../docs/email.md#no-resend-yet-verifying-the-first-admin)),
and check from your laptop:

```bash
npm run smoke -- https://example.com
```

## Updates

**Redeploy**, or enable **Auto Deploy** (a webhook from your Git provider) so
every push to `main` deploys. `migrate` runs on every deploy and applies only
new migrations. A redeploy replaces the app container before `migrate` runs,
so the site is down for those seconds, and stays down if a migration fails
(the deployment log shows why; fix it and redeploy). Take a backup before a
release whose changelog mentions a migration.

## Backups

Two things to back up: the database and the `uploads` volume (uploaded
images — the database holds only their URLs). Dokploy can back up its *own*
database services to S3; OpenShipKit’s Postgres lives inside your compose
service instead, so use [backups/backup.sh](backups/README.md) on the server
(cron), or a Dokploy **Schedule** that runs it: it takes both. (Dokploy’s
**Volume Backups** can cover `uploads` too — it sees named volumes, which is
why compose names it. Don’t use it for `postgres_data`: a copy of a running
database’s files isn’t a consistent backup; a dump is.) Either way, rehearse a
restore, and check the files arrived in the bucket with something other than
Dokploy’s own backup list.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Set POSTGRES_PASSWORD in .env` (or `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`) | The variable is missing from Environment. Add it and redeploy. |
| `migrate` exits 1 | Its log says why (often the password changed after the volume was created — Postgres keeps the first one). |
| Bad gateway / 404 from Traefik | The domain’s service must be `app` and the port `3000`. |
| Sign-in works, then you’re signed out | `NEXT_PUBLIC_SITE_URL` must be exactly the `https://` origin you visit. |
