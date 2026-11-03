# OpenShipKit on a VPS: docker compose + Caddy

From a blank Ubuntu server to your site on HTTPS, with Postgres, automatic
certificates and nightly backups. About fifteen minutes. Commands are for
Ubuntu 24.04 LTS or 26.04 LTS; on Debian 13 replace `ubuntu` with `debian`
in the Docker repository URL.

You need: a VPS with 2 GB RAM or more and a public IPv4 address, SSH access as
root (or a sudo user), and a domain whose DNS you can edit. Replace
`example.com` with your domain and `203.0.113.10` with your server’s address
throughout.

---

## 1. First login: a user, SSH keys, updates

```bash
ssh root@203.0.113.10

apt update && apt -y full-upgrade
apt -y install unattended-upgrades ufw git
dpkg-reconfigure -plow unattended-upgrades     # answer Yes: security updates install themselves

adduser deploy                                 # pick a strong password; you'll use sudo with it
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copy your authorized key
```

In a **second terminal**, check you can log in before you lock anything down:

```bash
ssh deploy@203.0.113.10
```

Then turn off password and root logins:

```bash
sudo tee /etc/ssh/sshd_config.d/10-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo systemctl reload ssh
```

## 2. Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp      # HTTP/3
sudo ufw enable
sudo ufw status verbose
```

> **Docker ports skip ufw.** Docker writes its own iptables rules, so a port a
> container publishes on `0.0.0.0` is public even if ufw says deny. That’s why
> OpenShipKit’s compose file binds the app (3000) and Postgres (5433) to
> `127.0.0.1` and only Caddy publishes 80/443. Keep it that way.

## 3. Docker

Docker’s own repository (Ubuntu’s `docker.io` package lags behind and has no
compose plugin):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy
```

Cap container logs, or they grow until the disk is full:

```bash
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }' \
  | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Log out and back in (for the `docker` group), then check:

```bash
docker compose version
```

A 1–2 GB server benefits from swap during the first image build:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. DNS

At your DNS provider, create:

| Type | Name | Value |
|---|---|---|
| `A` | `@` (example.com) | `203.0.113.10` |
| `AAAA` | `@` | your IPv6 address, if the server has one |

Wait until it resolves before starting Caddy — the certificate is issued only
once the name points here:

```bash
dig +short example.com     # must print 203.0.113.10
```

## 5. Clone and configure

```bash
sudo mkdir -p /opt/openshipkit && sudo chown deploy:deploy /opt/openshipkit
git clone https://github.com/<you>/<your-openshipkit-fork>.git /opt/openshipkit
cd /opt/openshipkit
```

Write `.env` with generated secrets. The server has no Node.js, so run the
setup script in a throwaway Node container (it has no dependencies):

```bash
docker run --rm -v "$PWD":/app -w /app --user "$(id -u):$(id -g)" node:24.21.0-alpine3.24 \
  node scripts/setup.mts --compose --domain example.com --admin-email you@example.com
```

(Or generate it on your laptop into a file Next.js never loads, copy it over
and delete the local copy — a `.env` in your development checkout would be
read by `npm run dev` too:
`npm run setup -- --compose --file .env.deploy --domain example.com --admin-email you@example.com`,
then `scp .env.deploy deploy@203.0.113.10:/opt/openshipkit/.env && rm .env.deploy`.)

Open `.env` and check:

| Variable | Should be |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://example.com` — no trailing slash |
| `DOMAIN` | `example.com` — what Caddy gets a certificate for |
| `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD` | long random strings (generated) |
| `ADMIN_EMAILS` | your address |
| `RESEND_API_KEY`, `EMAIL_FROM` | set them now: production requires a verified email before you can sign in or become the admin ([docs/email.md](../../docs/email.md)). No Resend yet? See the end of §6 |
| `POLAR_*` | optional, only when you charge ([docs/billing.md](../../docs/billing.md)) |

```bash
chmod 600 .env
```

Put a copy of `.env` in your password manager. Losing `BETTER_AUTH_SECRET`
signs everyone out and makes stored two-factor secrets unreadable.

## 6. Start it

```bash
docker compose --profile https up -d --build
docker compose ps
```

Compose starts Postgres, waits for it to be healthy, runs `migrate` (migrations
then seed) once, starts the app, and starts Caddy on 80/443. The first build
takes a few minutes. Watch it:

```bash
docker compose logs -f migrate app caddy
```

When Caddy logs `certificate obtained successfully`, open
`https://example.com`, sign up with the address in `ADMIN_EMAILS`, and you are
the admin (`/admin`).

Production requires email verification, and `ADMIN_EMAILS` promotes only a
verified address. With `RESEND_API_KEY` set, the link arrives by email.

**No Resend yet?** Without it, production logs only each email’s To and Subject,
never the link. To verify the first admin anyway, print the bodies for a few
minutes:

```bash
echo 'EMAIL_CONSOLE_PRINT_BODIES=true' >> .env
docker compose --profile https up -d                  # recreates the app with it
# sign up (or press “resend”) with the ADMIN_EMAILS address, then:
docker compose logs app | grep -A6 -i verify          # open the link it prints
sed -i '/^EMAIL_CONSOLE_PRINT_BODIES=/d' .env         # then turn it off again
docker compose --profile https up -d
```

Leave it off afterwards: with it on, every reset and sign-in link for every
user lands in the log. Set up Resend before anyone else signs up.

## 7. Check it

From your laptop:

```bash
npm run smoke -- https://example.com
```

Then follow [backups](../backups/README.md) — today, not later.

---

## Updating

```bash
cd /opt/openshipkit
git pull
docker compose --profile https build              # 1. build the new images; the old app keeps serving
docker compose run --rm migrate                   # 2. apply new migrations (and seed); the old app keeps serving
docker compose --profile https up -d              # 3. replace the app (a few seconds of downtime)
docker image prune -f
```

Run the three steps in that order, not a single `up -d --build`: `up` stops
and replaces the old app container *before* it waits for `migrate`, so the
site would be down while migrations run, and a failed migration would leave it
down. With the steps apart, a failed step 2 stops the update with the old app
still serving — read the error, fix it, and run step 2 again. (Step 3 starts
`migrate` once more; with nothing pending it finishes in a second.)

Migrations are additive (see [docs/deployment.md](../../docs/deployment.md#migrations)),
so the old app keeps working against the migrated database for those minutes.

Take a backup first when the changelog mentions a migration:
`./deploy/backups/backup.sh`.

## Logs and status

```bash
docker compose ps                          # what's running, health
docker compose logs -f app                 # the app (requests errors, emails in console mode)
docker compose logs --since 1h caddy       # certificates, proxy errors
docker compose logs migrate                # the last migration run
docker compose exec postgres psql -U openshipkit openshipkit   # a SQL prompt
curl -s http://127.0.0.1:3000/api/health   # from the server itself
```

## Common operations

| Task | Command |
|---|---|
| Restart the app | `docker compose restart app` |
| Change a variable | edit `.env`, then `docker compose up -d` (recreates what changed) |
| Run migrations by hand | `docker compose run --rm migrate` |
| Mint an MCP agent key | sign in → `/admin/agents` (the CLI needs the full source: `docker compose run --rm migrate npm run mcp:key -- --name "my agent"`) |
| Stop everything | `docker compose --profile https down` (volumes — your data — stay) |
| Database from your laptop | `ssh -L 5433:127.0.0.1:5433 deploy@203.0.113.10`, then `postgres://openshipkit:…@127.0.0.1:5433/openshipkit` |

Never run `docker compose down -v` on a server: `-v` deletes the volumes, and
with them the database, every uploaded image and Caddy’s certificates.

## Without Caddy

Already have a reverse proxy (nginx, Traefik, a load balancer)? Leave out the
profile — `docker compose up -d --build` — and proxy to `127.0.0.1:3000`
(or set `APP_BIND` to an internal address). Pass `Host`, `X-Forwarded-For`
(set to the client address, not appended) and `X-Forwarded-Proto`. The nginx
example in [node/nginx.conf](../node/nginx.conf) shows the headers.
