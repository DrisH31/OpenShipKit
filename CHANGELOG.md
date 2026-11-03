# Changelog

All notable changes to the OpenShipKit template. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The site’s own `/changelog` page is
separate: it shows the entries you publish in `/admin/posts`.

## [Unreleased]

## [1.0.0] — not yet released

The first release of **OpenShipKit**: the self-hosted sibling of
[GetShipKit](https://github.com/DrisH31/GetShipKit), a ground-up rewrite of the same idea that runs
entirely on your own server. GetShipKit stays a maintained starter on hosted services; nothing
carries over between them ([docs/upgrading.md](docs/upgrading.md#coming-from-getshipkit)).

1.0.0 has not been tagged yet. Everything below, including the work listed under "Before the
first tag", ships in it.


### Before the first tag

Work done after the first draft (some of it was briefly numbered 1.1.0, never released):

#### Security

- **Next.js 16.3.8 → 16.4.4** (and React 19.3.1, Tailwind 4.3.4): closes GHSA-2464-fhr4-w9xw
  and GHSA-673q-mjm6-r5xr (remote code execution) and GHSA-p3m5-59mp-jv5r (Server Actions DoS).
- **zod → 4.6.7** (GHSA-mrhx-c7xc-m3w5), and an override that gives drizzle-kit's loader a patched
  esbuild (GHSA-67mh-4wv8-2f99). `npm audit` reports no vulnerabilities.

#### Changed

- **A link to GetShipKit for anyone who'd rather not run a server**: a card in the footer and an
  FAQ answer, on the showcase only (a renamed site never shows them).
- **Tests no longer time out under load**: Postgres (PGlite) and docs tests passed alone but a
  random one hit Vitest's 5 s default in a full run; the limit is now 20 s.

- **GetShipKit and OpenShipKit are separate projects.** GetShipKit (`DrisH31/GetShipKit`)
  stays a maintained starter on hosted services; the release steps no longer rename its repository.
- **Resend is described as what it is**: the app starts without it, but production
  sign-up needs it (email verification and password resets), so the README no
  longer calls it "optional and off by default".

#### Changed

- **The design system, 2.15.2 → 2.31.1** (`src/styles`, `src/components/ui`, synced with
  `npm run ds:sync`): the type scale of two even ramps, the 4 px spacing scale, the quiet-lift
  palette (a near-white page, `#171717` in dark), a chart set that holds 3:1 in both schemes,
  focus on a field's own edge, and every value now generated from one tokens file upstream.
- **One skip link everywhere**: the new shared `SkipLink` replaces three hand-written links
  (marketing, not-found, the app shell) and is added to the sign-in and sign-up layout, which
  had a `<main id="main">` but no way to reach it from the keyboard.
- **Only the system's weights**: three controls set in 500 (the pill select, the auth layout's
  link, the admin change list) are 600; the auth heading is Space Grotesk 700 at its role's
  tracking.
- The generated images' colours (`BRAND`) and the code panel's measured ground (`PANEL_BG`)
  follow the new tokens; the contrast test reads an alias (`--ink-faint: var(--ink-3)`).

#### Added

- `VERSION`: the template's version, which a site records in `.template-version`.
- **A read-only demo admin** for the OpenShipKit showcase (`DEMO_ADMIN_EMAIL` +
  `DEMO_ADMIN_PASSWORD`, both or neither; off by default — remove them on your
  own site). "Try the demo" in the note on the sign-in and sign-up pages
  posts to `/api/demo`, which signs the visitor in to `/admin` as one shared
  admin for a two-hour browser session; the password never leaves the server.
  Every write service refuses it (`assertNotDemo`, checked for every service by
  `tests/demo.test.ts`), as do media uploads, the subscriber export, billing
  and Better Auth's credential changes (password, email, two-factor, sessions,
  reset links). Other people's emails, names, messages and audit values are
  masked for it (`src/shared/privacy-mask.ts`), search is off, and every admin
  and dashboard page says it is read-only. docs/auth.md → "The read-only demo admin".

- **"Support the project"** on the OpenShipKit showcase: with
  `OPENSHIPKIT_SUPPORT_URL` set to a checkout link (a Polar pay-what-you-want
  product), the header's action becomes a heart-marked "Support the project"
  that opens the checkout in a new tab, and the footer shows it beside "Star on
  GitHub". Never shown on a renamed site.
- **Hero highlights** (`hero.highlights`): up to three short points with checks
  under the lead, editable in the admin and over MCP like the rest of the hero.
  The default lead is shorter, and its three "no …" fears moved here.
- **A rebuilt admin overview**, answer first: one sentence says whether the site
  is up and how many things need you, with when it was checked, the database's
  response time and the site's address under it; then **Needs you** (open
  feedback, unpublished drafts, each with its action) beside a **Make it yours**
  progress card (the setup steps, now one module shared with /dashboard); then
  the key numbers, where Users and Subscribers carry a 30-day trend and the last
  seven days; then the last six changes grouped by day, with the starter
  content's rows folded into one line.
- **`growth()` on the DataStore**: new accounts and subscribers per UTC day,
  on Postgres and in memory, with contract tests. `site_overview` returns it.
- The demo-mode and read-only-demo strips are **one combined strip** when both
  apply.
- **Set up with an AI agent** ([docs/ai-setup.md](docs/ai-setup.md)): a
  pack of copy-paste prompts for Claude Code, OpenCode, Cursor or Codex that
  takes a site from `git clone` to live, step by step. It covers the local run
  and checks, making it yours through the site’s MCP server, Resend and its
  DNS records, the domain, deploying on a VPS (compose + Caddy), Dokploy or
  Coolify, Polar in the sandbox, backups with a restore rehearsal, the
  go-live checklist and daily operation. Each prompt says what the agent must
  not do. The page also lists optional third-party MCP servers (Cloudflare,
  Dokploy, Coolify, GitHub, Polar, Resend) and the guardrails to use with them.
- **Docs reading order** in `docs/nav.json`, which the website’s `/docs` uses.
  [docs/deployment.md](docs/deployment.md#choose-where-it-runs) now compares
  the hosts, and getting started lists the prerequisites.

- **Media library** (`/admin/media`, and “Upload cover” in the post
  editor): PNG, JPEG, WebP, AVIF or GIF up to 5 MB, recognised by their bytes;
  SVG refused. Files live under `UPLOADS_DIR` with random names and are served
  at `/uploads/…` with long-lived caching, `nosniff` and a sandboxing CSP; a
  delete is refused while a post or content section still uses the image.
  Uploads and deletes are audited; MCP gets `media_list` and `media_upload`
  ([docs/content.md](docs/content.md#media-library)). The uploads folder is
  part of every backup (below).
- **Unlisted posts.** A published post or changelog entry can be taken off
  `/blog`, tag pages, the changelog list, “Keep reading”, the landing page and
  `llms.txt` while staying live at its URL and in the sitemap, RSS and
  `llms-full.txt` (migration `0004_post_listed`; `listed` in the editor and
  over MCP). Drafts are still public nowhere
  ([docs/seo.md](docs/seo.md#what-is-kept-out-of-search)).
- **Latest posts on the landing page**: a `latestPosts` content section (on by
  default: the 3 newest listed posts and a link to `/blog`), editable in
  `/admin/content/latestPosts`.
- **IndexNow (optional).** With `INDEXNOW_KEY` set and a public `https://`
  `NEXT_PUBLIC_SITE_URL`, publishing, editing, unpublishing or deleting a
  published post pings the IndexNow engines; the key file answers at
  `/<key>.txt` ([docs/seo.md](docs/seo.md#getting-crawled)).
- **Opt-in modules** in `modules/`: `ai` (chat and image generation behind
  spend controls), `rag` (per-person document search with pgvector) and
  `redis` (a cache and a rate limiter shared across replicas). Complete and
  tested, not imported by the app until you enable one; their providers are
  optional and replaceable by a self-hosted OpenAI-compatible endpoint
  ([docs/modules](docs/modules/README.md)). `npm run typecheck:modules`, part
  of `npm run check`, typechecks them on their own.
- Uploaded images in production: docker compose mounts a named `uploads`
  volume at `/app/uploads` (`UPLOADS_DIR`, pinned), and the image creates that
  folder owned by `node` so a new volume is writable. Plain Node: set
  `UPLOADS_DIR` to a folder outside the checkout (the systemd unit allows
  `/opt/openshipkit/uploads`) — `deploy/node/deploy.sh` warns when it isn’t set.
- `npm run e2e` (`scripts/e2e.mts`): against a running dev or staging server,
  signs up (reading the verification link from the server log when
  verification is on), becomes admin through `ADMIN_EMAILS`, mints an agent
  key, edits a content section and publishes a post through the admin forms
  **without JavaScript**, checks the post on `/blog`, its page, the sitemap,
  the feed and `llms.txt`, sends the contact form and finds it in
  `/admin/feedback`, calls MCP — then deletes what it made. CI runs it against
  the production build.
- `npm run ds:sync -- --from <design-system>`: a dry-run-first sync of
  `src/styles/{tokens,theme,base,motion,overlays}.css` and
  `src/components/ui/**` from a design-system repository, recording the source
  commit in `src/styles/DESIGN_SYSTEM_VERSION`; never touches `brand.css` or
  OpenShipKit-only files, keeps `ds-sync:keep` blocks, and refuses words listed
  in a git-ignored `.ds-sync-deny`
  ([docs/customization.md](docs/customization.md#staying-in-step-with-a-design-system)).
- **Content-site profile.** `OPENSHIPKIT_PROFILE=site` (or
  `npm run setup -- --profile site`) makes a landing page + blog with no SaaS:
  no `/pricing`, no billing routes or dashboard Billing page, no Plans in the
  admin or over MCP, and nothing about plans in the sitemap, `llms.txt` or
  JSON-LD. Set it back to `saas` and everything returns; no data changes
  ([docs/site-profile.md](docs/site-profile.md), which also lists what to
  delete by hand).
- `npm run smoke` also fails on two `<main>` elements, a cookie for an
  anonymous visitor, an `og:image` that doesn’t answer, a broken link on `/`,
  a 404 page that isn’t `noindex` or carries a canonical, and a made-up
  `/uploads/` path that doesn’t 404; it warns on a meta description past 160
  characters. With an MCP key it checks every unlisted post (live,
  indexable, in the sitemap, off `/blog` and the landing page); with
  `--indexnow-key <key>`, that `/<key>.txt` answers with the key.
- Docs: [scaling](docs/scaling.md), [releasing](docs/releasing.md) (branches,
  SemVer tags, starting a site with `npx degit DrisH31/openshipkit#vX.Y.Z`),
  the rules that cost search traffic ([AGENTS.md](AGENTS.md#rules-that-cost-traffic),
  [docs/seo.md](docs/seo.md#rules-that-cost-traffic)), and more of the
  security model ([docs/security.md](docs/security.md)).
- A browser that has proved an account’s password gets a known-device cookie
  with its own wrong-password counter, so strangers can’t lock the owner out;
  asks for reset, sign-in and confirmation links are capped at 5 per address
  per hour, and the form says so ([docs/auth.md](docs/auth.md#rate-limits-and-lockouts)).
- `npm run smoke` warns while a renamed site still serves starter posts.
- CI fails when `schema.ts` and the migrations in `drizzle/` disagree.
- `tests/brand-sync.test.ts`: the literal colours the generated icons and
  Open Graph cards use (`src/components/seo/brand-mark.tsx`) must match
  `brand.css` and `tokens.css`.
- Backups for the plain-Node layout, and for two sites on one server.
- Landing-page screenshots in the README.

#### Changed

- The Dokploy and Coolify guides generate the server’s variables with
  `npm run setup -- --compose --file .env.deploy --site-url https://…` and
  delete the file afterwards. Before, they wrote a `.env` into the development
  checkout, which `npm run dev` also reads, and set a `DOMAIN` that only the
  Caddy profile uses.
- **A failed content read throws** (SPEC invariant 3). During a database
  outage the landing page and every page built from editable content answer
  with the error page (500, `noindex`) instead of the default copy with a
  200 — on a renamed site those defaults are OpenShipKit’s name, tagline and
  JSON-LD, and would be indexed under your domain. Defaults now show only
  for a section nothing was saved to (or a stored value that fails its
  schema). Monitor `/api/health`, which answers 503
  ([docs/deployment.md](docs/deployment.md#health-and-checks)).
- **Backups cover the uploads.** `deploy/backups/backup.sh` archives the
  uploads (`<project>-<stamp>.uploads.tar.gz`, read through the `app` service
  so compose finds the volume) next to each dump, and warns when an archive
  is empty but the previous one wasn’t; `restore.sh --rehearse` unpacks and
  counts it, `--replace` restores it as the app’s user
  ([deploy/backups](deploy/backups/README.md)). `BACKUP_UPLOADS=false` opts out.
- Work lands on `dev`; `main` only takes releases, tagged `vX.Y.Z`
  ([CONTRIBUTING.md](CONTRIBUTING.md)). CI runs on both; Dependabot’s version
  updates target `dev`.
- `deploy/backups/backup.sh` names dumps after the compose project
  (`<COMPOSE_PROJECT_NAME>-<stamp>.dump`, else `openshipkit-…`; `BACKUP_PREFIX`
  overrides) and prunes only its own, so two sites on one server can share a
  backup directory. A site set up with `--domain` stops pruning its older
  `openshipkit-*.dump` files: delete them by hand, or set
  `BACKUP_PREFIX=openshipkit` ([deploy/backups](deploy/backups/README.md)).
- The Postgres major-upgrade recipe keeps the old cluster beside the new one
  instead of removing a hard-coded `openshipkit_postgres_data` volume
  ([docs/upgrading.md](docs/upgrading.md#postgres)).
- `npm run setup` runs on plain Node (`node scripts/setup.mts`), as the
  deploy guides already did; CI checks it.
- An MCP agent key belongs to the admin who minted it: demoting, banning or
  deleting that admin revokes their keys (audited). `agent_keys_list` shows
  `createdBy` ([docs/mcp.md](docs/mcp.md)).
- While email verification is required, a GitHub or Google sign-up whose
  email the provider hasn’t verified is refused
  (`/sign-in?error=SOCIAL_EMAIL_NOT_VERIFIED`).
- On a renamed site, starter posts and the changelog entry still in
  OpenShipKit’s words are `noindex` and left out of the sitemap, RSS feeds and
  llms files; blog and changelog pager pages (`?cursor=`) are
  `noindex, follow`; a tag page is indexed only with 3 or more posts and on
  less than 80% of them ([docs/seo.md](docs/seo.md#what-is-kept-out-of-search)).

### The stack

- Next.js 16 App Router (React 19, TypeScript 6) on Node.js 24 LTS.
- Postgres via Drizzle ORM, with committed SQL migrations (`drizzle/`).
- Better Auth in the app, its tables in the same Postgres: email + password,
  email verification, password reset, magic links, two-factor (TOTP + backup
  codes), session management, optional GitHub and Google sign-in.
- Zero-config development: with no `DATABASE_URL` the app runs on an embedded
  Postgres (PGlite) in `.data/pglite`, migrated and seeded on boot.
- Optional Polar billing (merchant of record): checkout, customer portal,
  signature-verified idempotent webhooks; access comes only from webhooks.
- Optional Resend email; in development emails print to the server log.

### Added

- Marketing site with editable sections (hero, features, steps, stats,
  testimonials, pricing, FAQ, CTA), pricing, contact and newsletter forms,
  legal pages.
- Blog and changelog with tags, RSS, table of contents and per-post Open Graph
  images.
- Dashboard: billing, profile, password, two-factor, sessions, account
  deletion, feedback.
- Admin: overview, users, content, posts, plans, feedback, subscribers,
  agent keys, and an audit log with restore for content, posts and plans.
- Built-in MCP server at `/api/mcp` (Streamable HTTP, scoped agent keys,
  every write audited) and `npm run mcp:key`.
- SEO: server-rendered pages, JSON-LD, sitemap, robots.txt open to search and
  AI crawlers, `llms.txt` and `llms-full.txt`.
- Design system: Tailwind 4 tokens, shadcn/ui on Base UI, CSS motion that
  honours `prefers-reduced-motion`; light and dark; WCAG 2.2 AA.
- Self-hosting: multi-stage `Dockerfile` (standalone runner + migrator),
  `docker-compose.yml` with Postgres 18 and an optional Caddy `https` profile,
  guides for a VPS, Dokploy, Coolify and plain Node, backup and restore scripts
  with a restore rehearsal, a hardening checklist.
- `npm run setup` (env file with generated secrets) and `npm run smoke`
  (post-deploy checks).
- CI: typecheck, lint, tests, a build with no environment, Postgres 18
  migrations and contract tests, a production smoke test, Docker image builds.
- Docs for people and agents: `docs/`, `AGENTS.md`, `CLAUDE.md`.

### Removed

- Everything from GetShipKit. The old template used Clerk for auth and Supabase
  for data; that code remains in the git history before this release.
