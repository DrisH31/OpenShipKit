# Getting started

This page takes you from `git clone` to a product that’s yours: run it with no setup, make yourself the admin, look around, then replace the defaults in the right order. It takes about an hour, most of it writing your own copy.

Would you rather have a coding agent do the steps? [Set up with an AI agent](ai-setup.md) has the same path as copy-paste prompts.

## Before you start

| You need | Why | Check |
|---|---|---|
| **Node.js 24 LTS** (22.18+ works) | Runs the app and the scripts | `node -v` |
| **git** | Gets the code; your copy becomes a repository | `git --version` |
| A terminal and an editor | | |

You don’t need Docker, a database, or any account to start: development runs
on an embedded Postgres, and emails print to the terminal. Install Node 24 from
[nodejs.org](https://nodejs.org/en/download), or with the version manager you
already use (fnm, nvm, mise, Volta).

For going live later you will also want a domain, a Linux server (a VPS with
2 GB of RAM, or one that already runs Dokploy or Coolify:
[deployment.md](deployment.md#choose-where-it-runs)), a Resend account or an
SMTP server for email ([email.md](email.md)) and, only if you charge, a Polar,
Stripe or Razorpay account ([billing.md](billing.md)).

Starting a real site? Start from a **release tag** rather than `main`, and
write down which one, so you know which later changes you already have
([releasing.md](releasing.md#starting-a-site-from-a-release)):

```bash
npx degit DrisH31/openshipkit#v1.1.0 my-saas    # the files at that release, no history
cd my-saas && git init && git add -A && git commit -m "Start from OpenShipKit v1.1.0"
```

Just looking? Cloning `main` is fine, and that is what the next step does.

## 1. Run it

```bash
git clone https://github.com/DrisH31/openshipkit.git my-saas
cd my-saas
npm install
npm run dev
```

Open <http://localhost:3000>. You need Node.js 24 LTS and nothing else: no
`.env`, no Docker, no accounts.

With no `DATABASE_URL`, OpenShipKit starts an **embedded Postgres** (PGlite —
real Postgres compiled to WebAssembly, running inside the dev server) in
`.data/pglite`. It applies the migrations from `drizzle/` and seeds starter
plans and posts on the first boot. Your data survives restarts; delete
`.data/pglite` to start over.

In development, emails print to the terminal and billing is off.

## 2. Make yourself the admin

```bash
npm run setup -- --admin-email you@example.com
```

That writes `.env.local` with a generated `BETTER_AUTH_SECRET`, an
`MCP_DEV_KEY` for local agents, and `ADMIN_EMAILS=you@example.com`. It never
overwrites a value you’ve set, and backs up the old file to `.env.local.bak`.

Run `npm run setup` with nothing after it, in a terminal, and it asks instead,
one question at a time: a SaaS or a content site, which billing provider, teams
or not, how email is sent, and your email. Enter takes the default. It never
asks for a key: at the end it lists the ones your choices need, to paste into
the file. The same choices are flags, for scripts:

```bash
npm run setup -- --billing stripe --email smtp --tenancy org --admin-email you@example.com
```

`--without blog,mcp` switches off features you don’t use
([site-profile.md](site-profile.md#switching-features-off)), and
`npm run setup -- --help` lists every flag.

Restart `npm run dev`, sign up with that email at `/sign-up`, and open
`/admin`. (Email verification is off in development; the welcome email is in
the terminal.)

## 3. Look around

| Where | What |
|---|---|
| `/` | The landing page — every section comes from `/admin/content` |
| `/pricing` | Plans from `/admin/plans` |
| `/blog`, `/changelog` | Posts from `/admin/posts` |
| `/dashboard` | What a signed-in customer sees: home, billing, settings, feedback (an admin’s home adds the setup checklist; with teams on, a Team page too) |
| `/admin` | Overview, users, content, posts, media, plans, feedback, subscribers, agent keys, background jobs, audit log (and organisations, with teams on) |

## 4. Make it yours, in this order

1. **Name and origin.** `/admin/content/site`: the name, tagline and SEO
   defaults. Set `NEXT_PUBLIC_SITE_URL` in production — it’s the only place
   your domain is written. Renaming the site also hides the OpenShipKit-specific
   showcase sections on the landing page.
2. **Copy.** Hero, features, steps, FAQ, CTA, navigation and footer in
   `/admin/content`. Defaults live in `src/content/defaults.ts` if you prefer
   code. [content.md](content.md).
3. **Brand colour.** `src/styles/brand.css`, plus its literal copies for the generated icons and cards in `src/components/seo/brand-mark.tsx` (`npm test` checks they match). [customization.md](customization.md).
4. **Plans.** `/admin/plans`: names, prices, features and limits
   ([usage.md](usage.md)). Free plans work without billing; connect Polar,
   Stripe or Razorpay when you’re ready to charge ([billing.md](billing.md)).
5. **Legal pages.** Privacy and terms ship as templates with `[bracketed
   placeholders]` in `/admin/posts`. Fill them in and have someone qualified
   review them.
6. **Email.** Before real users: Resend and a verified domain, or your own SMTP server ([email.md](email.md)).
7. **Your product.** Build it under `src/app/dashboard/` — the shell, auth
   checks, billing state and design system are ready ([architecture.md](architecture.md)).
8. **Ship it.** [deployment.md](deployment.md#choose-where-it-runs) — a VPS
   with docker compose + Caddy (about fifteen minutes), Dokploy, Coolify or
   plain Node. Then backups, the same day ([deploy/backups/](../deploy/backups/README.md)).

## 5. Connect an agent (optional)

The site is an MCP server at `/api/mcp`. In development the `MCP_DEV_KEY` from
`.env.local` works as an admin key:

```bash
export OPENSHIPKIT_MCP_KEY=<MCP_DEV_KEY from .env.local>
claude            # this repo's .mcp.json connects to http://localhost:3000/api/mcp
```

Then ask it to rewrite the hero or draft a post. [mcp.md](mcp.md) covers other
clients and real keys.

## Everyday commands

```bash
npm run dev          # develop
npm run check        # typecheck (app + modules) + lint + tests, before every commit
npm run smoke        # check the running site like a crawler would
npm run build        # production build (no env needed)
```

The embedded database is **one process at a time**: stop `npm run dev` before
running `npm run db:migrate`, `db:seed` or `mcp:key` against it. To work
against a real Postgres locally instead, use the compose file’s Postgres
(it listens on `127.0.0.1:5433`). Compose needs a `.env` with `POSTGRES_PASSWORD`
and the app’s required values, which `npm run setup -- --compose` writes:

```bash
npm run setup -- --compose --site-url http://localhost:3000   # writes .env (POSTGRES_PASSWORD…); .env.local is untouched
docker compose up -d postgres
echo "DATABASE_URL=postgres://openshipkit:$(grep ^POSTGRES_PASSWORD= .env | cut -d= -f2)@127.0.0.1:5433/openshipkit" >> .env.local
npm run db:migrate && npm run db:seed && npm run dev
```

More in [data.md](data.md#a-real-postgres-locally).
