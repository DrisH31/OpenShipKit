# OpenShipKit on plain Node (no Docker)

For a server where you’d rather not run Docker, or a Node host that gives you a
Postgres. The app runs as `node .next/standalone/server.js` under systemd, with
nginx or Caddy in front for HTTPS. Commands are for Ubuntu 24.04 / 26.04; first
do steps 1–2 (user, SSH, firewall) of the [VPS guide](../vps/README.md).

Files here:

| File | What |
|---|---|
| `openshipkit.service` | systemd unit: runs the standalone server as an unprivileged user |
| `nginx.conf` | nginx site: TLS via certbot, the right forwarded headers |
| `Caddyfile` | the same with Caddy (automatic HTTPS, simpler) |
| `deploy.sh` | pull → install → build → migrate → seed → restart |

## 1. Node.js 24 LTS

From NodeSource (or use your distribution’s Node 24, or `fnm`/`nvm` for the
`openshipkit` user):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs
node -v      # v24.x
```

## 2. Postgres

Skip this if your host gives you a Postgres; use its connection string.

PostgreSQL’s own repository has the current major version (18):

```bash
sudo apt -y install postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt -y install postgresql-18
```

Create a role and a database (the password is hex so it’s URL-safe).
`CREATEDB` lets the [restore rehearsal](../backups/README.md) make its scratch
database as this role:

```bash
PGPASS=$(openssl rand -hex 32)
sudo -u postgres psql -c "CREATE ROLE openshipkit LOGIN CREATEDB PASSWORD '$PGPASS';"
sudo -u postgres createdb -O openshipkit openshipkit
echo "DATABASE_URL=postgres://openshipkit:$PGPASS@127.0.0.1:5432/openshipkit"
```

Postgres listens on localhost only by default; keep it that way.

## 3. The app

```bash
sudo adduser --system --group --home /opt/openshipkit openshipkit
sudo -u openshipkit git clone https://github.com/<you>/<your-openshipkit-fork>.git /opt/openshipkit/app
cd /opt/openshipkit/app
sudo -u openshipkit node scripts/setup.mts --file /opt/openshipkit/openshipkit.env --compose
```

The env file sits **outside** the checkout on purpose: Next.js loads
`.env.production` from the project folder at build time, and the build should
see no secrets. `--compose` here only means “production values”: it generates
`BETTER_AUTH_SECRET` (and a `POSTGRES_PASSWORD` you can ignore). Edit
`/opt/openshipkit/openshipkit.env`:

```dotenv
NODE_ENV=production
NEXT_PUBLIC_SITE_URL=https://example.com
DATABASE_URL=postgres://openshipkit:…@127.0.0.1:5432/openshipkit
BETTER_AUTH_SECRET=<generated>
ADMIN_EMAILS=you@example.com
PORT=3000
HOSTNAME=127.0.0.1
UPLOADS_DIR=/opt/openshipkit/uploads
RESEND_API_KEY=re_…
EMAIL_FROM=Your Product <hello@example.com>
```

`UPLOADS_DIR` is where uploaded images go. Keep it **outside** the checkout
(a rebuild replaces `.next/standalone`, and the images with it) and create it
for the app user — the systemd unit allows writes there and nowhere else:

```bash
sudo install -d -m 750 -o openshipkit -g openshipkit /opt/openshipkit/uploads
```

Set up Resend ([docs/email.md](../../docs/email.md)) before you sign up:
production requires a verified email, and without Resend the link is neither
sent nor logged. The env file is already mode 600. Then build and migrate once (as the app user):

```bash
sudo -u openshipkit bash deploy/node/deploy.sh --no-restart
```

`deploy.sh` runs `npm ci`, `npm run build`, copies `.next/static` and
`public/` into the standalone folder (Next leaves them out), then runs the
migrations and the seed with the env file loaded (`ENV_FILE` overrides its path).

## 4. systemd

```bash
sudo cp deploy/node/openshipkit.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openshipkit
systemctl status openshipkit
curl -s http://127.0.0.1:3000/api/health
```

Logs: `journalctl -u openshipkit -f`.

## 5. HTTPS in front

**Caddy** (simplest — certificates are automatic):

```bash
sudo apt -y install caddy
sudo cp deploy/node/Caddyfile /etc/caddy/Caddyfile   # then replace example.com
sudo systemctl reload caddy
```

**nginx + certbot**:

```bash
sudo apt -y install nginx certbot python3-certbot-nginx
sudo cp deploy/node/nginx.conf /etc/nginx/sites-available/openshipkit   # replace example.com
sudo ln -s /etc/nginx/sites-available/openshipkit /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d example.com
```

## Updating

```bash
cd /opt/openshipkit/app
sudo -u openshipkit git pull
sudo -u openshipkit bash deploy/node/deploy.sh --no-restart
sudo systemctl restart openshipkit
```

(`deploy.sh` without `--no-restart` calls `sudo systemctl restart openshipkit`
itself, if the user may.) Back up first when a release adds a migration:
[Plain Node or a managed Postgres](../backups/README.md#plain-node-or-a-managed-postgres)
sets up `backup.sh` for this layout — its own copy of `DATABASE_URL` in
`/etc/openshipkit/backup.env`, a `pg_dump` that matches the server, and a
nightly cron job as the `openshipkit` user. The same job archives
`/opt/openshipkit/uploads`: back up the images with the database, or a restore
brings back posts whose pictures are gone.
