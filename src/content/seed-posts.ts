//
// Starter content: three real blog posts, the 1.0 and 1.1 changelog entries, and the
// privacy and terms templates (kind "page", served at /legal/<slug>). Inserted
// by the embedded database's first boot and by `npm run db:seed` (only where
// the slug is missing, so an edit is never overwritten). Edit or delete freely
// — in the admin, through the MCP server, or here.
//
// Rules for this file:
//  - every entry must pass postCreateSchema (tests/foundation.test.ts and
//    src/components/seo/seo.test.ts check, and render every body);
//  - internal links point only at routes that exist (the test checks);
//  - bodies are template literals: escape every backtick and every "${".
//
// The legal pages are templates, not legal advice: every [bracketed
// placeholder] must be replaced, and a qualified lawyer should review them.
// Dates are fixed ISO strings so seeded sites (and their sitemaps) are stable.
//
// The posts and the changelog entry are OpenShipKit's own story. On a renamed
// site, the ones still carrying their seeded title or body stay readable but
// are noindex and kept out of the sitemap, feeds and llms files
// (isStarterContent, below). No tag sits on every post: a catch-all tag's page
// would only repeat /blog.
//

import type { PostInput } from "@/core/types";

const WELCOME = `OpenShipKit is a free, MIT-licensed starter for software-as-a-service products. It gives you the parts every SaaS needs and nobody wants to build twice — sign-in, billing, a marketing site, a blog, an admin panel — in one Next.js app that runs on your own server, against your own Postgres.

This post is the tour: what’s in the box, how it fits together, and the order to make it yours in.

## What you get

- **A marketing site** with a landing page, pricing, contact form, blog, changelog and legal pages. Every word on it is editable from the admin, without a deploy.
- **Authentication in the app**, through Better Auth: email and password with verification and password reset, magic links, and optional GitHub or Google sign-in. Users, sessions and roles live in your database.
- **Billing, when you want it**, through Polar as merchant of record: subscriptions, one-time purchases, trials and a customer portal. Access is granted only by signature-verified webhooks. Off until you add a key.
- **Email, when you want it**, through Resend. Until then every email — verification links, password resets — is printed to the server log.
- **A dashboard** for signed-in users (billing, settings, feedback) and an **admin** for you: users, content, posts, plans, feedback, subscribers, agent keys and an audit log.
- **An MCP server**, so Claude, Cursor or any MCP client can do what the admin does — with scoped keys, and every change logged and reversible.
- **SEO and AI-search plumbing**: server-rendered pages, JSON-LD, a sitemap, \`robots.txt\`, RSS feeds, generated Open Graph images and \`llms.txt\`.

There is no auth company, no database company and no analytics script in the default install. Nothing phones home.

## How it fits together

One rule holds the codebase together: pages never talk to a database or an SDK directly. They call services, the services talk to small interfaces in \`src/core/\`, and each driver lives behind one of them in \`src/adapters/\`.

| Layer | Lives in | Talks to |
|---|---|---|
| Routes and pages | \`src/app/\` | services |
| Services — the write path | \`src/server/services/\` | the DataStore, the audit log |
| Contracts | \`src/core/\` | nothing (no I/O) |
| Drivers and SDKs | \`src/adapters/\` | Postgres, Polar, Resend |

Every write goes through a service: validate the input with zod, write through the DataStore, record the before and after in the audit log. The admin, the public forms and the MCP server all call the same services, so there is one set of rules to trust.

## Run it in two minutes

You don’t need a database server or any accounts to see it working:

\`\`\`bash
npm install
npm run dev
\`\`\`

With no \`DATABASE_URL\` set, OpenShipKit starts an **embedded Postgres** in \`.data/pglite\`, applies the migrations and seeds the starter content. It’s real Postgres, so what you see is what production runs, and your data survives a restart. Emails print to the terminal and billing is off.

Open \`http://localhost:3000\` and sign up with any email. To see the admin, put that address in \`ADMIN_EMAILS\` in \`.env.local\` first (\`npm run setup\` writes the file with fresh secrets).

> The embedded database is for development: one process at a time, on your laptop. In production OpenShipKit refuses to start without a \`DATABASE_URL\`.

## Make it yours, in this order

1. **Set your origin.** \`NEXT_PUBLIC_SITE_URL\` is the only place your domain is written down. Canonical URLs, the sitemap, RSS and Open Graph images all read it.
2. **Rewrite the copy.** Open \`/admin/content\`: the site name, tagline, hero, features, FAQ and footer are all there. The defaults live in \`src/content/defaults.ts\` if you prefer to edit in code.
3. **Set up your plans.** \`/admin/plans\` holds names, prices and features. When you’re ready to charge, add your Polar keys and connect each price to its Polar product. Until then the pricing page shows your plans and free plans work.
4. **Turn on email before real users arrive.** Set \`RESEND_API_KEY\` and \`EMAIL_FROM\`, so verification and password-reset emails reach inboxes instead of the log.
5. **Replace the legal pages.** The privacy policy and terms ship as templates with \`[bracketed placeholders]\`. Fill them in and have someone qualified review them.
6. **Write your first post.** In \`/admin/posts\`, or ask an agent to draft one through the MCP server.
7. **Put it on a server.** [Self-hosting OpenShipKit on your own VPS](/blog/self-hosting-openshipkit-on-a-vps) goes from a blank server to HTTPS, backups and updates.

## What it deliberately doesn’t do

- **No client-side data fetching for content.** Public pages render on the server at request time, so search engines and AI crawlers see the words in the first byte of HTML.
- **No access from redirects.** A user is on a paid plan because a verified webhook said so, never because a success page loaded.
- **No invented numbers.** Stats, testimonials and logos only show what you put there.
- **No required third parties.** Payments and email are the only outside services, both optional and off by default.

## Where to go next

- [Self-hosting OpenShipKit on your own VPS](/blog/self-hosting-openshipkit-on-a-vps) — docker compose, automatic HTTPS, backups and updates.
- [Let AI agents run your site](/blog/mcp-server-for-ai-agents) — connecting Claude or Cursor to your admin.
- The [changelog](/changelog) — what changed in the 1.0 rewrite.

OpenShipKit is MIT licensed: use it for anything, commercial included. If it saves you a month, tell someone about it.
`;

const SELF_HOSTING = `OpenShipKit is built to run on a server you control: one Next.js app and one Postgres database, started together with Docker Compose. This guide takes a blank Linux server to a live site with automatic HTTPS, nightly backups, a tested restore and a routine for updates. Budget an hour the first time.

Prefer a panel to a terminal? Dokploy and Coolify run the same compose file and handle HTTPS and backups from a web UI — see [the end of this guide](#prefer-a-panel). Everything below still explains what they do for you.

## What you need

- **A server** running a current Ubuntu LTS or Debian, with SSH access. For a new product, 2 vCPUs and 2 GB of memory are comfortable for the app and Postgres together. Building the image is the hungriest step, so on a small machine add swap (below) or build the image elsewhere.
- **A domain** whose DNS you can edit.
- **About ten minutes of attention a month** for updates, and a glance at your backups.

Throughout, \`example.com\` stands for your domain and \`/opt/openshipkit\` for where the app lives. Replace both.

## 1. Prepare the server

Log in as root once, create a user for yourself, and stop using root:

\`\`\`bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
\`\`\`

From a new terminal, confirm \`ssh deploy@your-server\` works. Then turn off password logins in \`/etc/ssh/sshd_config\`:

\`\`\`text
PasswordAuthentication no
PermitRootLogin no
\`\`\`

Files in \`/etc/ssh/sshd_config.d/\` win over the main file, and some cloud images ship one that turns passwords back on — check there too. Then:

\`\`\`bash
sudo systemctl reload ssh
\`\`\`

Open only SSH and the web ports, and let the OS patch itself:

\`\`\`bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443
sudo ufw enable
sudo apt update && sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
\`\`\`

On a 2 GB machine, add a swap file so an image build can’t run out of memory:

\`\`\`bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
\`\`\`

## 2. Install Docker

Install Docker Engine and the Compose plugin from Docker’s own apt repository, following the instructions for your distribution in Docker’s documentation (the versions in the distribution’s own repositories lag behind). Then let your user run it:

\`\`\`bash
sudo usermod -aG docker deploy
\`\`\`

Log out and back in, and check \`docker compose version\` prints a version.

> **Docker ports skip the firewall.** A port a container publishes (\`ports: - "3000:3000"\`) is reachable from the internet even when \`ufw\` says otherwise, because Docker writes its own firewall rules. Publish only what must be public — here, Caddy’s 80 and 443 — and let everything else talk over Compose’s private network.

Cap the size of container logs too, or they grow until the disk is full. Create \`/etc/docker/daemon.json\`:

\`\`\`json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
\`\`\`

\`\`\`bash
sudo systemctl restart docker
\`\`\`

## 3. Point your domain at the server

Create an \`A\` record for \`example.com\` with the server’s IPv4 address (and an \`AAAA\` record if it has IPv6). Add the same for \`www\` if you want it. Wait until \`dig +short example.com\` answers with your server’s address before the next step: the HTTPS certificate is issued only once the name resolves.

## 4. Get the code and the configuration

Clone your copy of OpenShipKit:

\`\`\`bash
sudo mkdir -p /opt/openshipkit && sudo chown deploy:deploy /opt/openshipkit
git clone <your-repository-url> /opt/openshipkit
cd /opt/openshipkit
\`\`\`

Compose reads its settings from a \`.env\` file next to \`docker-compose.yml\` (not \`.env.local\`, which is for \`npm run dev\`). The setup script writes one with freshly generated secrets:

\`\`\`bash
npm run setup -- --compose --domain example.com --admin-email you@example.com
\`\`\`

No Node on the server? Run it on your laptop and copy the file over with \`scp\`, or copy \`.env.example\` to \`.env\` and fill it in by hand. The values that matter on a server:

| Variable | Set it to |
|---|---|
| \`DOMAIN\` | \`example.com\` — Caddy requests its certificate for this name |
| \`NEXT_PUBLIC_SITE_URL\` | \`https://example.com\` — no trailing slash |
| \`BETTER_AUTH_SECRET\` | a long random string: \`openssl rand -base64 32\` |
| \`POSTGRES_PASSWORD\` | another one; Compose uses it to create the database and build \`DATABASE_URL\` |
| \`ADMIN_EMAILS\` | your email, so your account becomes the first admin |
| \`RESEND_API_KEY\`, \`EMAIL_FROM\` | optional — without them, emails are written to the app’s log |
| \`POLAR_ACCESS_TOKEN\`, \`POLAR_WEBHOOK_SECRET\` | optional — only when you start charging |

\`\`\`bash
chmod 600 .env
\`\`\`

Keep a copy of \`.env\` in your password manager. If you lose \`BETTER_AUTH_SECRET\`, everyone is signed out and anything encrypted with it, such as two-factor secrets, can’t be read back.

> Plan to turn email on before real users arrive. Without it, a person who forgets their password can’t reset it unless you read the reset link out of the server log for them.

## 5. HTTPS with Caddy

Caddy is a web server that obtains and renews Let’s Encrypt certificates on its own. It’s already in \`docker-compose.yml\`, behind the \`https\` profile: it takes ports 80 and 443 and passes requests to the app over Compose’s private network, using \`deploy/Caddyfile\` and the \`DOMAIN\` from \`.env\`. The app itself only listens on \`127.0.0.1\`, so nothing reaches it except through Caddy.

Point your domain’s A (and AAAA) record at the server **before** you start, so Caddy can prove it owns the name. The \`caddy_data\` volume holds your certificates; keep it, or Caddy has to request new ones and can hit Let’s Encrypt’s rate limits.

## 6. Start it

\`\`\`bash
docker compose --profile https up -d --build
docker compose ps
\`\`\`

Compose starts Postgres, applies the database migrations once (the \`migrate\` service), then starts the app and Caddy. The first build takes a few minutes. Follow along with:

\`\`\`bash
docker compose logs -f app
\`\`\`

Open \`https://example.com\`, sign up with the address in \`ADMIN_EMAILS\`, and you’re the admin. Then check what search engines will see:

\`\`\`bash
curl -sI https://example.com | head -n 1
curl -s https://example.com/robots.txt | tail -n 2
\`\`\`

The first should say \`200\`, and the sitemap line in the second should show your domain, not \`localhost\`. If it shows \`localhost\`, \`NEXT_PUBLIC_SITE_URL\` isn’t set.

## 7. Back up the database

Your Postgres volume is the business: users, subscriptions, posts, the audit log. A backup you haven’t restored is a hope, so this section ends with a restore.

Create \`/opt/openshipkit/backup.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# Nightly dump of the OpenShipKit database. Keeps 14 days.
set -euo pipefail
cd /opt/openshipkit
mkdir -p backups
file="backups/db-$(date +%Y-%m-%d-%H%M).dump"
docker compose exec -T postgres sh -c 'pg_dump -U "\${POSTGRES_USER:-openshipkit}" -d "\${POSTGRES_DB:-openshipkit}" --format=custom' > "$file"
find backups -name 'db-*.dump' -mtime +14 -delete
echo "wrote $file"
\`\`\`

\`pg_dump\` takes a consistent snapshot while the app keeps running, and the custom format is compressed and restores table by table. Make it executable, run it once, then schedule it with \`crontab -e\`:

\`\`\`bash
chmod +x backup.sh && ./backup.sh
\`\`\`

\`\`\`text
15 3 * * * /opt/openshipkit/backup.sh >> /opt/openshipkit/backups/backup.log 2>&1
\`\`\`

**Copy the dumps off the server.** A backup on the same disk dies with the disk. Send \`backups/\` to a second machine, or to any S3-compatible storage with an open-source tool such as \`rclone\` or \`restic\`, as a second cron line after the dump.

### Test a restore

Restore into a scratch database, never over the live one:

\`\`\`bash
docker compose exec -T postgres sh -c 'createdb -U "\${POSTGRES_USER:-openshipkit}" restore_check'
docker compose exec -T postgres sh -c 'pg_restore -U "\${POSTGRES_USER:-openshipkit}" -d restore_check --no-owner' < backups/db-2026-10-06-0315.dump
docker compose exec -T postgres sh -c 'psql -U "\${POSTGRES_USER:-openshipkit}" -d restore_check -c "select count(*) from users"'
docker compose exec -T postgres sh -c 'dropdb -U "\${POSTGRES_USER:-openshipkit}" restore_check'
\`\`\`

Use the name of a dump you actually have. If the count looks right, your backups work. Do this again every few months, and after every Postgres major upgrade.

## 8. Update safely

OpenShipKit is a template, so updates are your own commits plus whatever you merge from upstream. Next.js publishes security releases about monthly; apply them the same week.

\`\`\`bash
cd /opt/openshipkit
./backup.sh
git pull
docker compose --profile https up -d --build
docker compose logs --since 5m app
docker image prune -f
\`\`\`

\`up -d --build\` rebuilds the image, applies any new migrations, and replaces the running container. Expect a few seconds of downtime while the new container starts; for a young product that’s usually fine.

To take in improvements from OpenShipKit itself, add it as a second remote once (\`git remote add upstream <openshipkit-repository-url>\`), then \`git fetch upstream && git merge upstream/main\`, resolve any conflicts, run \`npm run check\` locally, and push before you pull on the server.

**Rolling back:** check out the previous commit and run \`docker compose --profile https up -d --build\` again. Migrations only go forward, so if the bad release changed the schema, restore the dump you took before updating.

## 9. Know when it breaks

You don’t need an observability stack on day one. You need to hear about an outage before your users tell you.

- **An uptime check.** Point a checker at \`https://example.com/api/health\` every minute or two, and have it alert you by email or chat. Run your own (Uptime Kuma is open source and runs in one container — on a different machine, so it can see this one go down) or use any service you trust.
- **The logs.** \`docker compose logs --since 1h app\` shows errors, sign-in emails in console mode, and webhook deliveries. \`docker compose ps\` shows what’s running and what keeps restarting.
- **The disk.** \`df -h\` and \`docker system df\`. A full disk takes Postgres down, and Postgres will not start again until there’s room. Old images and backups are the usual culprits.
- **Certificates.** Caddy renews them by itself; if one ever fails, the reason is in \`docker compose logs caddy\` — almost always DNS that no longer points here, or port 80 blocked.

Put a monthly reminder in your calendar: update, glance at the backup log, check free disk space.

## Prefer a panel?

**Dokploy** and **Coolify** are open-source panels you install on the same kind of server. Both deploy straight from your Git repository with the same \`docker-compose.yml\`, issue certificates through their own proxy (so you skip the Caddy step), and can schedule database backups. You give up a little transparency for a UI; the app doesn’t change.

Whichever way you run it, the shape is the same: one app, one Postgres, both yours. Next, [connect an AI agent](/blog/mcp-server-for-ai-agents) to the site you just deployed, or go back to the [tour of what’s in the box](/blog/welcome-to-openshipkit).
`;

const MCP_SERVER = `Most SaaS admin panels are built for one kind of user: a person with a mouse. OpenShipKit’s admin has a second door. It ships a **Model Context Protocol (MCP) server**, so an AI agent — Claude, Cursor, or any MCP client — can read and change your site with the same rules the admin follows.

It runs inside your app, on your server, against your database. No relay, no hosted connector.

This guide covers what an agent can do, how keys and scopes keep it in bounds, and how to connect a client.

## What an agent can do

Anything the admin can, through the same services:

- **Edit the site.** Read and update every content section — hero, features, pricing copy, FAQ, navigation — with the same schema validation as the admin forms.
- **Write and publish.** Draft blog posts, changelog entries and pages in Markdown, then publish them when you say so.
- **Manage pricing.** Change plan names, features and prices.
- **Handle feedback.** Read what users sent, set its status, add a note.
- **Look things up.** Find a user, check a subscription, read the audit log.

A few things agents are good at here:

> “Read the last five changelog entries and draft one for today’s release from this list of commits.”

> “The FAQ says trials are 7 days but the Pro plan has 14. Make them agree.”

> “Summarise this week’s feedback by theme and mark the duplicates closed.”

## Keys and scopes

Every agent uses its own key, and every key has one scope:

| Scope | Can |
|---|---|
| \`read\` | read everything that isn’t a secret |
| \`write\` | \`read\`, plus edit and publish content, posts, plans and feedback |
| \`admin\` | \`write\`, plus users, roles, subscribers and agent keys |

Give an agent the smallest scope that does the job. A writing assistant needs \`write\`; almost nothing needs \`admin\`.

Keys are shown once when you create them, and only a hash is stored. Create one in the admin under **Agent keys**, or from the command line:

\`\`\`bash
npm run mcp:key
\`\`\`

Revoke a key at any time; it stops working on the next request.

## Every change is recorded — and reversible

Agents write through the same services as people, so every change lands in the audit log with **who** made it (the key’s name), **what** changed, and the value **before and after**. Content, posts and plans can be restored from \`/admin/audit\`, or by the agent itself with the \`audit_restore\` tool.

That’s the safety net that makes it reasonable to let an agent edit a live site: a bad edit is one click from undone.

## Connect a client

The server speaks MCP over HTTP at \`/api/mcp\` on your site, authenticated with the agent key as a bearer token. Most clients take a URL and a header; the repository’s \`docs/mcp.md\` has copy-paste configuration for Claude Code, Claude Desktop and Cursor.

For local development, \`.env.local\` can set \`MCP_DEV_KEY\` so you don’t have to create a key while you build. It only works outside production; never set it on a server.

Once connected, ask the agent to list its tools. Start read-only:

> “What’s on the pricing page right now, and does it match the plans?”

## Good habits

- **One key per agent or person**, named after it (“Claude — blog drafts”), so the audit log reads clearly.
- **Drafts first.** Ask agents to save posts as drafts, review them, then publish.
- **Review the diff.** The audit log shows exactly what changed; skim it after a long session.
- **Keep it out of public clients.** An agent key is a password. It belongs in your MCP client’s config, never in a browser or a repository.
- **Mind the door.** \`/api/mcp\` is reachable wherever your site is. Revoke keys you no longer use, and keep \`admin\` keys rare.

## Why build it in

An AI agent that can only *suggest* changes to your site leaves you doing the copy-and-paste. One that can *make* them — inside scopes you set, with every change logged and undoable — turns “update the pricing FAQ” into a sentence instead of a chore. OpenShipKit treats agents as first-class users of the admin, with the same validation, the same permissions model and the same audit trail as people.

New here? Start with the [tour of OpenShipKit](/blog/welcome-to-openshipkit), and [put it on your own server](/blog/self-hosting-openshipkit-on-a-vps) before you hand an agent a key.
`;

const CHANGELOG_1_0 = `OpenShipKit 1.0 is a self-hosted, ground-up rewrite of the idea behind **GetShipKit**, which continues as a separate starter built on hosted services. Same idea — a SaaS starter you can ship this weekend — rebuilt to run entirely on infrastructure you own, stay fast and indexable, and be run by AI agents as well as people.

## Highlights

- **One independent stack.** Next.js 16, Postgres through Drizzle, and Better Auth inside the app. No auth or database company in the loop; your users and data live in your Postgres.
- **Zero-config development.** \`npm install && npm run dev\` starts an embedded Postgres in \`.data/pglite\` — migrated, seeded and persisted across restarts. No accounts, no Docker.
- **Self-hosting first.** A Dockerfile and a docker compose setup for your own server, with guides for a plain VPS (with Caddy for HTTPS), Dokploy, Coolify and any Node host.
- **An MCP server built in.** Agents can edit content, publish posts, manage plans and answer feedback with scoped keys, and every change is audited and reversible.
- **An admin panel.** Users and roles, every content section, posts, plans, feedback, subscribers, agent keys and the audit log.
- **A real content system.** The blog, changelog and legal pages are Markdown in your database, editable from the admin or through MCP — no redeploy to fix a typo.
- **SEO and AI search by default.** Server-rendered pages, JSON-LD, sitemap, RSS, generated Open Graph images and \`llms.txt\`.

## What changed from GetShipKit

Sign-in and data no longer depend on hosted services: Better Auth runs inside the app, and everything is stored in your own Postgres. GetShipKit is still maintained for people who prefer hosted services; [Upgrading from GetShipKit](#upgrading-from-getshipkit), below, covers moving a project if you want to own it instead.

### Architecture

- Rebuilt on **Next.js 16** (App Router, React 19) with \`proxy.ts\` in place of middleware.
- Contracts live in \`src/core/\` — \`DataStore\`, \`BillingProvider\`, \`EmailProvider\` — and every driver or SDK is imported only under \`src/adapters/\`.
- Every write now goes through a service that validates with zod, writes through the DataStore and records an audit entry.

### Auth

- **Better Auth** runs in the app: email and password with verification and reset, magic links, and optional GitHub or Google sign-in.
- Roles live in the app’s own \`users\` table, promoted by \`ADMIN_EMAILS\` or by another admin. The last admin can’t be demoted, banned or deleted.

### Billing and email

- **Polar** stays, as merchant of record, and is optional: billing is off until \`POLAR_ACCESS_TOKEN\` is set. Subscriptions, one-time purchases, trials and a customer portal.
- Access is granted **only** by signature-verified, idempotent webhooks. The old \`subscription/sync\` and \`fix-user-id\` endpoints are gone: there is nothing to sync when the webhook is the source of truth.
- Email goes through **Resend** when \`RESEND_API_KEY\` is set, and to the server log otherwise.

### Content and SEO

- The hard-coded landing page is now editable content with schemas and defaults, so a fresh clone renders a complete site.
- \`next-sitemap\` is replaced by Next’s native \`sitemap.ts\` and \`robots.ts\`, generated at request time from published content.
- New: RSS feeds for the blog and changelog, JSON-LD on public pages, per-post Open Graph images, and \`llms.txt\` / \`llms-full.txt\`.
- \`robots.txt\` names search and AI crawlers explicitly and allows them; private routes are disallowed and protected by auth.

### Design

- A new design system: tokens for light and dark, measured for WCAG 2.2 AA contrast, and components built with shadcn on Base UI.
- Reduced motion is respected everywhere; content is never hidden behind an entrance animation.

## Upgrading from GetShipKit

There is no in-place upgrade: 1.0 is a new codebase. To move a GetShipKit project:

1. Start from a fresh OpenShipKit clone and run it locally with \`npm run dev\`.
2. Copy your copy and pricing into \`/admin/content\` and \`/admin/plans\`.
3. Deploy it with your own Postgres and point your Polar webhook at \`/api/billing/webhook\`.
4. Ask existing users to sign up again with the same email address, so their accounts are created on your server.
5. Existing Polar subscriptions carry GetShipKit’s old user ids, so they don’t attach to the new accounts by themselves. For each paying customer, add a row to the \`billing_customers\` table linking their Polar customer id to their new user id (shown in \`/admin/users\`), then redeliver their latest subscription event from the Polar dashboard. The webhook finds the user through that row and records the subscription.
6. Re-create your legal pages from the new templates.

## Licence

Still MIT. Use it for anything, commercial included.
`;

const CHANGELOG_1_1 = `OpenShipKit 1.1 takes the kit from a single-tenant starter to a SaaS foundation you can run in production: teams, three billing providers, plan limits and usage billing, and the operations work a real site needs. Everything new is off until you turn it on, and nothing you set up on 1.0 changes.

## Highlights

- **Teams.** Set \`OPENSHIPKIT_TENANCY=org\` for organisations with owner, admin and member roles, email invitations and per-seat billing by the organisation.
- **More ways to get paid.** Stripe and Razorpay join Polar behind one billing contract. Webhooks are verified and re-fetched before anything is written, and chargebacks and failed refunds are handled.
- **Plan limits and usage billing.** Give a plan limits such as \`projects: 3\` or \`api_calls: 10000\`, meter usage with an atomic consume, and report metered prices to Polar or Stripe meters through an outbox. Customers see a Usage card on their billing page.
- **Production hardening.** Security scanning in CI, an authorization test that fails closed, structured logs with optional error tracking, a Postgres job queue with \`/admin/jobs\`, SMTP email, and a health check that knows when migrations are behind.
- **Uploads on S3.** Any S3-compatible bucket can hold the media library instead of the local disk.
- **A friendlier start.** \`npm run setup\` asks what you need, \`OPENSHIPKIT_WITHOUT=blog,mcp\` switches features off everywhere, a generated API reference, \`npm run upgrade\` for merging new template releases, and two example apps to copy from.

## Upgrading from 1.0

1. Merge the release (\`npm run upgrade\` reports what changes, then \`npm run upgrade -- --merge\` does it on a new branch).
2. Stop \`npm run dev\` and run \`npm run db:migrate\`: eight new migrations, all additive.
3. Point your load balancer's readiness check at \`/api/health\` and its liveness check at \`/api/health/live\`.

## What stays the same

The stack is still Next.js, Postgres and Better Auth on your own server, with no hosted auth or database company. Every write still goes through a service and lands in the audit log, access is still granted only by verified webhooks, and the build still needs no secrets. Every new setting is optional; the docs for teams, billing and usage say what each one does.
`;

const PRIVACY = `> **This is a template, not legal advice.** It was written as a starting point for a SaaS built on OpenShipKit and run on servers you control. Replace every \`[bracketed placeholder]\`, delete what doesn’t apply, add what’s missing for your product and your users’ countries, and have a qualified lawyer review it before you rely on it.

**Effective date:** [Effective date]

This policy explains what personal data [Company name] (“we”, “us”) collects when you use [Product name] and [website URL] (the “Service”), why we collect it, who we share it with, and the choices and rights you have.

## Who we are

[Company name] is the controller of the personal data described here. We are registered in [Jurisdiction] at [Registered address].

- Privacy contact: [privacy@your-domain]
- EU/UK representative (if required): [Name and address, or delete]
- Data protection officer (if appointed): [Name and contact, or delete]

## Where your data lives

We run the Service ourselves. Your account, your content and our records are stored in our own database on servers we operate, rented from [Hosting provider] in [Region]. We do not use a third-party sign-in service or a hosted database company, and we don’t load third-party trackers on our pages. The few outside providers we use are listed under [Who we share it with](#who-we-share-it-with), with what each receives.

## The data we collect

### Data you give us

- **Account data:** your name, email address and password (stored only as a one-way hash, never in readable form). If you choose to sign in with [GitHub / Google], we receive your name, email address and profile picture from that account.
- **Billing data:** when you buy a plan, our payment provider Polar collects your name, billing address, tax details and card details. We receive your name, email address, what you bought and the status of your subscription — never your full card number.
- **Content you create:** [the data your users put into the product — describe it].
- **Messages:** what you send through our contact and feedback forms, and support emails.
- **Newsletter:** your email address, if you subscribe.

### Data collected automatically

- **Sign-in sessions:** for each signed-in session we store the IP address and browser type it was created from, so you can see and end sessions and we can spot misuse.
- **Server logs:** IP address, browser and device type, the pages requested, and the date and time of requests, kept for security and debugging.
- **Cookies and local storage:** see [Cookies](#cookies) below.
- **Analytics:** [We do not use analytics. / We use [self-hosted analytics tool] on our own servers, configured to [describe — e.g. not use cookies and not store full IP addresses].]

## How we use your data, and our legal bases

| Purpose | Legal basis (EU/UK GDPR) |
|---|---|
| Create and run your account; provide the Service | Performance of our contract with you |
| Take payments, issue invoices, meet tax and accounting duties | Contract; legal obligation |
| Keep the Service secure; prevent fraud and abuse | Legitimate interests |
| Answer your messages and support requests | Contract; legitimate interests |
| Send service emails (verification and sign-in links, password resets, receipts, important changes) | Contract |
| Send product news and newsletters | Consent — withdraw any time |
| Understand and improve how the Service is used | Legitimate interests |

We do not sell your personal data, and we do not use it to train AI models [— edit if this is not true for your product].

## Who we share it with

We share personal data only with providers that need it to run the Service, and only as far as each needs:

| Provider | What for | What they receive | Where |
|---|---|---|---|
| [Hosting provider] | The servers our application and database run on | Everything stored in the Service, encrypted in transit | [Region] |
| Polar | Payments, subscriptions, invoices and sales tax, as merchant of record | Your billing details and purchase | [Region] |
| Resend | Delivering our emails | Your email address and the email’s content | [Region] |
| [GitHub / Google] | Optional sign-in, only if you choose it | That you are signing in to the Service | [Region] |

[Delete Polar if you don’t take payments, and Resend if you send email another way. With another payment provider instead of Polar, replace the Polar row: a payment processor that isn't a merchant of record makes you the seller, and it processes payment data for you. Add anything else you connect.]

**Polar is the merchant of record** for purchases: it is the seller of record, handles payment and sales tax, and processes your payment data as an independent controller under its own privacy policy.

We may also disclose data when the law requires it, to protect our rights or the safety of others, or as part of a merger or acquisition (we’ll tell you before your data becomes subject to a different policy).

## International transfers

[Describe where your servers are and where Polar and Resend process data.] When personal data leaves the EEA or the UK, we rely on [adequacy decisions / the European Commission’s Standard Contractual Clauses / the UK International Data Transfer Addendum] to protect it.

## How long we keep it

- **Account data:** for as long as your account is open, and [30] days after you delete it.
- **Billing records:** [7] years, or as long as tax law in [Jurisdiction] requires.
- **Sessions:** until you sign out or the session expires.
- **Server logs:** [30] days.
- **Backups:** database backups are kept for [14] days, then deleted; data you delete disappears from backups within that time.
- **Messages and feedback:** [2] years, unless you ask us to delete them sooner.

## How we protect it

Data is encrypted in transit (HTTPS) [and our backups are encrypted at rest]. Passwords are stored only as hashes. Access to our servers and admin tools is limited to people who need it, and changes made through our admin tools are recorded in an audit log. No system is perfectly secure; if a breach affects your data, we’ll notify you and the relevant authorities as the law requires.

## Your rights

Depending on where you live, you can ask us to:

- **access** the personal data we hold about you, and get a copy in a portable format;
- **correct** data that is wrong or incomplete;
- **delete** your data;
- **restrict** or **object to** certain processing, including direct marketing;
- **withdraw consent** where we rely on it, without affecting earlier processing.

**California residents** have the right to know, delete and correct personal information, and to opt out of its sale or sharing — we do not sell or share personal information as those terms are defined in the CCPA/CPRA — and the right not to be discriminated against for using these rights.

To use any of these rights, email [privacy@your-domain]. We’ll answer within [30] days and may need to verify your identity first. If you’re unhappy with our answer, you can complain to your local data protection authority [— in the UK, the ICO; in the EU, the authority in your country].

## Cookies

We use only what the Service needs to work, and no advertising or tracking cookies:

| Name | Type | Purpose | Lasts |
|---|---|---|---|
| \`better-auth.session_token\` | Cookie | Keeps you signed in | [7 days], renewed while you use the Service |
| \`better-auth.session_data\` | Cookie | A short-lived copy of your session, so pages load faster | 1 minute |
| \`better-auth.known_device\` | Cookie | Remembers that this browser has signed in to your account before, so other people’s wrong-password attempts can’t lock you out of it | 180 days |
| \`better-auth.two_factor\` | Cookie | Holds a sign-in open while you enter your two-factor code (only if you use two-factor sign-in) | 10 minutes |
| \`better-auth.trust_device\` | Cookie | Skips the two-factor code on a browser you chose to trust (only if you ask it to) | 30 days |
| \`theme\` | Local storage | Remembers light or dark mode | Until you clear it |

On HTTPS the cookie names start with \`__Secure-\`. [If you add analytics or other cookies, list them here and ask for consent before setting them where the law requires it.] You can block or delete cookies in your browser settings; the Service may not work properly without the essential ones.

## Children

The Service is not directed to children under [13 / 16], and we don’t knowingly collect their personal data. If you believe a child has given us data, contact us and we’ll delete it.

## Changes to this policy

We’ll post any changes on this page and update the effective date. If a change is significant, we’ll tell you by email or in the Service before it takes effect.

## Contact

- [Company name]
- [Registered address]
- [privacy@your-domain]
`;

const TERMS = `> **This is a template, not legal advice.** It was written as a starting point for a subscription SaaS built on OpenShipKit. Replace every \`[bracketed placeholder]\`, adapt it to how your product and pricing really work, and have a qualified lawyer review it before you rely on it.

**Effective date:** [Effective date]

These terms are an agreement between you and [Company name] (“we”, “us”), registered in [Jurisdiction] at [Registered address], for the use of [Product name] and [website URL] (the “Service”). By creating an account or using the Service, you agree to them. If you use the Service for an organisation, you agree on its behalf and confirm you have the authority to do so.

## 1. The Service

[Product name] is [one sentence describing what your product does]. We run it on servers we operate. We may improve, change or remove features over time. If we remove something material that you pay for, we’ll tell you in advance and, where it’s fair, offer a pro-rated refund.

## 2. Your account

- You must be at least [16 / 18] years old, or the age of digital consent where you live.
- Give accurate information and keep it up to date.
- Keep your sign-in details and any API or agent keys secret. You are responsible for what happens under your account, including actions taken by automated agents you connect with your keys.
- Tell us straight away at [security@your-domain] if you think your account has been compromised.

## 3. Acceptable use

You agree not to:

- break the law, or infringe anyone else’s rights, through the Service;
- upload malware, or try to probe, scan or break the Service’s security;
- access the Service by automated means except through the interfaces we provide for it (such as the API and MCP server), or overload it;
- resell or sublicense the Service without our written permission;
- use it to send spam or to harass, harm or deceive anyone.

We may suspend accounts that put the Service or other users at risk. Where we can, we’ll warn you first and give you a chance to fix the problem.

## 4. Your content

You keep all rights to the content you put into the Service. You give us a limited licence to host, copy, back up and display it only as needed to run the Service for you. You are responsible for having the rights to the content you upload. [If your product uses customer content for anything else — e.g. training models — say so here, plainly.]

## 5. Plans, payment and renewal

- **Prices** are shown on our [pricing page](/pricing) and at checkout, [exclusive / inclusive] of taxes.
- **Our reseller.** Purchases are processed by Polar, which sells to you as **merchant of record**: Polar is the seller on your invoice, charges your payment method and handles sales tax and VAT. Polar’s terms of sale also apply to the payment.
- **Subscriptions renew automatically** at the end of each billing period, monthly or yearly, until you cancel.
- **Free trials** last the number of days shown when you start one. If you add a payment method, the paid plan starts when the trial ends unless you cancel before then.
- **Cancelling** takes effect at the end of the current billing period; you keep access until then. You can cancel any time from your billing settings.
- **One-time purchases** (such as a lifetime plan) give access for the life of the Service, as described on the pricing page.
- **Price changes** apply from your next billing period, and we’ll give you at least [30] days’ notice.
- **Refunds:** [Describe your policy — e.g. “If you’re not happy within 14 days of your first payment, email us for a full refund.”] Nothing in these terms limits any right to a refund or cancellation that consumer law gives you.

[If you don’t charge for the Service, replace this section with one sentence saying it is free, and delete the references to Polar. With a payment provider that isn't a merchant of record, you are the seller: replace the reseller paragraph with your own seller details, refund terms and how tax is charged, and name the provider as your payment processor.]

## 6. Our intellectual property

The Service, including its software, design and branding, belongs to us or our licensors. These terms don’t give you any rights to it beyond using the Service as described. If you send us feedback or suggestions, we may use them without obligation to you.

## 7. Third-party services

A few parts of the Service rely on others: Polar for payments, Resend for delivering email, and — only if you choose them — GitHub or Google for signing in. Their own terms govern your use of them, and we are not responsible for them.

## 8. Availability, backups and support

We work to keep the Service available and secure, and we back up its data regularly, but we don’t promise it will be uninterrupted or error-free, and you should keep your own copies of anything you can’t afford to lose. [If you offer an uptime SLA on some plans, reference it here.] Support is available at [support@your-domain].

## 9. Ending the agreement

You can stop using the Service and delete your account at any time. We may end or suspend your access if you materially break these terms, or if we are required to by law. If we discontinue the Service entirely, we’ll give you at least [30] days’ notice and a way to export your data, and refund any prepaid fees for the period after it ends.

## 10. Disclaimers

Except as the law requires, the Service is provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose and non-infringement.

## 11. Limitation of liability

To the extent the law allows, neither party is liable for indirect, incidental or consequential losses, or for lost profits, revenue or data. Our total liability arising from these terms is limited to the amount you paid us in the [12] months before the claim. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited by law.

## 12. Indemnity

If you use the Service for business, you agree to defend and indemnify us against third-party claims arising from your content or from your breach of these terms.

## 13. Changes to these terms

We may update these terms. We’ll post the new version here and update the effective date; for material changes, we’ll tell you by email or in the Service at least [30] days before they take effect. If you keep using the Service after that, the new terms apply.

## 14. Governing law and disputes

These terms are governed by the laws of [Jurisdiction]. Disputes will be resolved in the courts of [City, Jurisdiction], unless the law where you live as a consumer gives you the right to bring a claim locally.

## 15. General

If any part of these terms is found unenforceable, the rest still applies. Not enforcing a right isn’t a waiver of it. You may not transfer these terms without our consent; we may transfer them as part of a merger or acquisition. These terms, together with our [privacy policy](/legal/privacy), are the whole agreement between us about the Service.

## Contact

- [Company name]
- [Registered address]
- [legal@your-domain]
`;

/** The starter posts, newest last. Slugs are stable: other posts and the tests link to them. */
export const SEED_POSTS: PostInput[] = [
  {
    kind: "post",
    slug: "welcome-to-openshipkit",
    title: "Welcome to OpenShipKit: what you get and how to make it yours",
    description: "A tour of the free, MIT-licensed SaaS starter that runs on your own server: what’s in the box, how the pieces fit, and the order to make it yours.",
    seoTitle: "Welcome to OpenShipKit: the open-source, self-hosted SaaS starter",
    seoDescription: "What OpenShipKit includes — Better Auth, Postgres, optional Polar billing, blog, admin, MCP server — how it fits together, and seven steps to make it yours.",
    body: WELCOME,
    tags: ["getting-started"],
    status: "published",
    publishedAt: "2026-10-01T09:00:00.000Z",
  },
  {
    kind: "post",
    slug: "self-hosting-openshipkit-on-a-vps",
    title: "Self-hosting OpenShipKit on your own VPS",
    description: "From a blank Linux server to a live site: Docker Compose, Caddy for automatic HTTPS, nightly pg_dump backups with a tested restore, safe updates and basic monitoring.",
    seoTitle: "Self-host a Next.js SaaS on a VPS: Docker, Caddy, backups",
    seoDescription: "Deploy OpenShipKit on your own server with Docker Compose and Caddy for automatic HTTPS, then set up pg_dump backups, a restore test, updates and uptime checks.",
    body: SELF_HOSTING,
    tags: ["self-hosting", "deployment"],
    status: "published",
    publishedAt: "2026-10-02T09:00:00.000Z",
  },
  {
    kind: "post",
    slug: "mcp-server-for-ai-agents",
    title: "Let AI agents run your site: OpenShipKit’s MCP server",
    description: "Claude, Cursor and any MCP client can edit content, publish posts and manage plans — with scoped keys, and every change logged and reversible.",
    seoTitle: "An MCP server for your SaaS: let AI agents run your site",
    seoDescription: "How OpenShipKit’s built-in MCP server lets AI agents edit content, publish posts and manage pricing, with scoped keys and an audit log you can undo.",
    body: MCP_SERVER,
    tags: ["mcp", "ai-agents"],
    status: "published",
    publishedAt: "2026-10-05T09:00:00.000Z",
  },
  {
    kind: "changelog",
    slug: "openshipkit-1-1",
    title: "OpenShipKit 1.1",
    description: "Teams, Stripe and Razorpay beside Polar, plan limits and usage billing, a job queue and production hardening. Everything new is opt-in.",
    body: CHANGELOG_1_1,
    tags: ["release"],
    status: "published",
    publishedAt: "2026-11-04T08:00:00.000Z",
  },
  {
    kind: "changelog",
    slug: "openshipkit-1-0",
    title: "OpenShipKit 1.0",
    description: "GetShipKit's self-hosted sibling: one stack (Next.js 16, Postgres, Better Auth), zero-config embedded Postgres, a built-in MCP server, an admin and SEO by default.",
    body: CHANGELOG_1_0,
    tags: ["release"],
    status: "published",
    publishedAt: "2026-10-01T08:00:00.000Z",
  },
  {
    kind: "page",
    slug: "privacy",
    title: "Privacy policy",
    description: "What personal data we collect, where it’s stored, who we share it with, and the rights you have.",
    body: PRIVACY,
    tags: [],
    status: "published",
    publishedAt: "2026-10-01T08:00:00.000Z",
  },
  {
    kind: "page",
    slug: "terms",
    title: "Terms of service",
    description: "The agreement for using the Service: accounts, acceptable use, plans and payment, and liability.",
    body: TERMS,
    tags: [],
    status: "published",
    publishedAt: "2026-10-01T08:00:00.000Z",
  },
];

/** Line endings and outer whitespace aside, the same Markdown. */
function sameBody(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
  return norm(a) === norm(b);
}

/**
 * True for a starter blog post or changelog entry that is still OpenShipKit's
 * own text: same kind and slug as a SEED_POSTS entry, and its title or its
 * body unchanged. Once a site is renamed (no longer the showcase; see
 * isShowcase in src/shared/seo.ts) these say things about
 * OpenShipKit, not your product, and every deployment of the template carries
 * the same words — so they're noindex and left out of the sitemap, the RSS
 * feeds and the llms files until you rewrite or delete them. Legal pages are
 * handled by their placeholders instead (isUnfinishedTemplate).
 */
export function isStarterContent(post: { kind: string; slug: string; title: string; body: string }): boolean {
  if (post.kind !== "post" && post.kind !== "changelog") return false;
  const seed = SEED_POSTS.find((s) => s.kind === post.kind && s.slug === post.slug);
  if (!seed) return false;
  return post.title.trim() === seed.title || sameBody(post.body, seed.body ?? "");
}
