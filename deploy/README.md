# Deploying OpenShipKit

OpenShipKit is one Node server and one Postgres database. Anything that can run
those can run it. Every option below uses the same `Dockerfile` and the same
environment variables (`.env.example` lists them all), so moving later is
copying a `.env` and restoring a database dump.

## Pick one

| You have… | Use | Guide | HTTPS from |
|---|---|---|---|
| A fresh Linux VPS and SSH | **docker compose + Caddy** | [vps/](vps/README.md) | Caddy (automatic Let’s Encrypt) |
| A server running Dokploy | Dokploy “Compose” service | [dokploy.md](dokploy.md) | Dokploy’s Traefik |
| A server running Coolify | Coolify “Docker Compose” resource | [coolify.md](coolify.md) | Coolify’s proxy |
| A server without Docker, or a Node host with a Postgres | `node server.js` under systemd | [node/](node/README.md) | nginx or Caddy in front |

Not sure? Take the VPS guide. A €5–10 a month VPS with 2 GB of RAM runs the
app, Postgres and Caddy comfortably, and the guide goes from a blank Ubuntu
server to HTTPS in about fifteen minutes.

## What every deployment needs

1. **Postgres 16 or newer** (compose ships 18). Set `DATABASE_URL`, or let
   compose assemble it from `POSTGRES_*`.
2. **Three variables**: `NEXT_PUBLIC_SITE_URL` (your `https://` origin),
   `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), and `ADMIN_EMAILS` (you).
   `npm run setup -- --compose` writes them, with generated secrets.
3. **Migrations before the app starts**: `npm run db:migrate && npm run db:seed`.
   Both are safe to repeat: migrations apply once, and the seed fills only a
   brand-new database (a marker in the audit log stops later runs, so starter
   posts you deleted stay deleted). Compose and the Dokploy/Coolify guides run
   them for you (the `migrate` service); on plain Node you run them on each deploy.
4. **HTTPS** in front, terminating TLS and passing `X-Forwarded-For` and
   `X-Forwarded-Proto`. Rate limits key on the client address it reports.
5. **Email before the first sign-up.** Production requires email verification
   (and `ADMIN_EMAILS` promotes only a verified address), so set
   `RESEND_API_KEY` and `EMAIL_FROM` ([docs/email.md](../docs/email.md)).
   Without them production logs only each email’s To and Subject, not the link;
   to bootstrap the admin, set `EMAIL_CONSOLE_PRINT_BODIES=true` briefly
   ([docs/email.md](../docs/email.md#no-resend-yet-verifying-the-first-admin)).
6. **Uploads on a volume.** Uploaded images go to `UPLOADS_DIR` — a named
   volume at `/app/uploads` under compose (already wired), a folder outside the
   checkout on plain Node. A container’s own filesystem is replaced on every
   deploy, and the images with it.
7. **Backups — of both.** [backups/](backups/README.md): a nightly `pg_dump`
   **and** an archive of the uploads, with retention, an off-site copy and a
   restore you’ve actually rehearsed. The database stores only the images’
   URLs: one without the other restores a site of broken images.

Then read [hardening.md](hardening.md) once.

## After any deploy

```bash
npm run smoke -- https://example.com
```

It checks what a crawler sees on every public page (title, h1, description,
JSON-LD, a self-referencing canonical on your origin, and no stray `noindex`),
the feeds, sitemap, robots.txt, llms.txt, `/api/health`, the signed-out
redirects, and that `/api/mcp` refuses a request with no key; it exits non-zero
if anything is wrong. Add `--mcp-key <key>` (a `read` key from `/admin/agents`)
to also check MCP `initialize` and `tools/list`. Run it from your laptop; it
only reads.

## Files here

| File | What |
|---|---|
| `Caddyfile` | Used by the compose `https` profile: one site block for `DOMAIN` |
| `vps/README.md` | Fresh Ubuntu VPS → firewall → Docker → compose → HTTPS → updates |
| `dokploy.md`, `coolify.md` | The same compose file on a self-hosted PaaS |
| `node/` | systemd unit, nginx and Caddy examples, Postgres install, deploy script |
| `backups/` | `backup.sh` (nightly dump + uploads archive + retention + optional rclone), `restore.sh`, the rehearsal |
| `hardening.md` | SSH, firewall, Docker ports, updates, secrets, headers, monitoring |
