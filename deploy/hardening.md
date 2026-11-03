# Hardening checklist

Read once after your first deploy. Most items take a minute; together they
close the usual ways a small self-hosted app gets hurt. The app’s own
security model (auth, webhooks, the write path) is in
[docs/security.md](../docs/security.md).

## The server

- [ ] **SSH keys only**, no root login (`PasswordAuthentication no`,
      `PermitRootLogin no`) — [VPS guide §1](vps/README.md#1-first-login-a-user-ssh-keys-updates).
- [ ] **Firewall**: deny incoming except 22, 80, 443 (`ufw`). Restrict 22 to
      your IP if it’s stable: `ufw allow from 198.51.100.7 to any port 22`.
- [ ] **Unattended security updates** (`unattended-upgrades`), and a reboot
      when `/var/run/reboot-required` appears.
- [ ] **fail2ban** for SSH if the port is open to the world:
      `sudo apt -y install fail2ban` (the default `sshd` jail is enough).
- [ ] **Log caps**: Docker’s `max-size`/`max-file` (VPS guide §3), and
      `journalctl --vacuum-size=500M` or `SystemMaxUse=` for the journal.
- [ ] **Disk alerts**: a full disk stops Postgres. Check `df -h` in your
      monitoring, or a cron that mails you above 85 %.

## Docker

- [ ] **Publish only Caddy’s ports.** Docker bypasses ufw for published
      ports. The compose file binds the app and Postgres to `127.0.0.1`; keep
      `APP_BIND=127.0.0.1` unless another firewall sits in front.
- [ ] **Never `docker compose down -v`** on a server — it deletes the database
      volume.
- [ ] **Containers run unprivileged**: the app image runs as `node`, not root.
      Don’t add `privileged`, `network_mode: host` or the Docker socket.
- [ ] **Update images**: Dependabot proposes new `node`, `postgres` and `caddy`
      tags; merge, pull, then build → `run --rm migrate` → `up -d`
      ([vps/README.md](vps/README.md#updating)). Minor Postgres versions (18.x) are
      drop-in; a major upgrade (18 → 19) needs a dump and restore —
      [docs/upgrading.md](../docs/upgrading.md).

## Secrets

- [ ] `.env` is mode 600 (`npm run setup` writes it that way) and only on the
      server and in your password manager. Never committed (`.gitignore`
      covers `.env*`), never in the image (`.dockerignore` excludes it).
- [ ] `BETTER_AUTH_SECRET` is 32+ random bytes and unique to this deployment.
      Rotating it signs everyone out and invalidates stored 2FA secrets.
- [ ] `POSTGRES_PASSWORD` is long and random. Postgres is not reachable from
      outside the server anyway; this is defence in depth.
- [ ] `MCP_DEV_KEY` is **not set** on a server (it’s ignored in production,
      but don’t leave it lying around). Mint real agent keys in `/admin/agents`,
      `read` or `write` scope unless an agent truly needs `admin`, and revoke
      the ones you no longer use.
- [ ] Polar: production and sandbox tokens are different; the server has only
      the one it needs. Give the token only the scopes the app uses
      (checkouts, customer sessions, subscriptions and orders read).

## The app

- [ ] `NEXT_PUBLIC_SITE_URL` is your exact `https://` origin. Auth callbacks,
      cookies and the Origin checks on forms and billing routes depend on it.
- [ ] **Email is on** (`RESEND_API_KEY`) before real users: production
      requires verified email, and password resets need delivery.
- [ ] **ADMIN_EMAILS** lists only you (and co-owners). Promotion happens on
      sign-in; removing an address doesn’t demote — do that in `/admin/users`.
- [ ] Two-factor auth on every admin account (`/dashboard/settings`).
- [ ] The reverse proxy **sets** `X-Forwarded-For` to the client address
      (Caddy does by default; nginx: `$remote_addr`, not
      `$proxy_add_x_forwarded_for`). Rate limits on sign-in, forms and MCP key
      on it.
- [ ] Response headers: `nosniff`, `X-Frame-Options: DENY`, a strict
      `Referrer-Policy`, `Permissions-Policy`, and HSTS in production come
      from `next.config.ts`. Check with `curl -sI https://example.com`.
      Don’t add HSTS `preload` until every subdomain serves HTTPS.
- [ ] **Patch Next.js the week a security release ships**: `npm i next@<patch>`,
      `npm run check`, `npm run build`, deploy. Watch the repository’s
      Dependabot PRs and GitHub’s security advisories.

## Backups and monitoring

- [ ] Nightly `backup.sh` (the database **and** the uploads), an off-site
      copy checked at the destination, and a **rehearsed** restore —
      [backups/](backups/README.md).
- [ ] An uptime check on `https://example.com/api/health` (200 when the
      database answers, 503 when it doesn’t) from any monitor you run or trust —
      self-hosted Uptime Kuma works well.
- [ ] After every deploy: `npm run smoke -- https://example.com`.
- [ ] Skim `/admin/audit` now and then: every content, post, plan, user and
      agent-key change is there with who made it.
