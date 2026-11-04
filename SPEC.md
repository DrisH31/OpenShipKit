# OpenShipKit — SPEC

The contract. Read this before writing a file. Where this document and a code
comment disagree, the code comment is more specific and wins; fix whichever is
wrong.

OpenShipKit is **one Next.js 16 App Router app, fully self-hosted**: your
Postgres, your auth (Better Auth), your server. No auth company, no database
company. The only outside services are optional and off by default: a billing
provider — **Polar**, **Stripe** or **Razorpay**, one at a time — for payments
(someone has to process cards) and **Resend** for email, or your own mail
server over SMTP (and, only if you enable an opt-in module, an AI or embeddings
provider — invariant 9). An S3-compatible bucket for uploads and an error
tracker (`ERROR_TRACKING_DSN`) are optional too, and either can be one you host.

---

## 1. The stack

| Layer | What | Where it runs |
|---|---|---|
| App | Next.js 16 (App Router, Server Components), React 19, TypeScript 6 | your server (Docker image, or the standalone `node .next/standalone/server.js`, which `npm start` runs after a build) |
| Data | Postgres via Drizzle ORM | your Postgres (`DATABASE_URL`) — docker compose ships one |
| Dev data | Embedded Postgres (PGlite) in `.data/pglite` (`PGLITE_DIR`) when `DATABASE_URL` is unset | in the dev server process |
| Uploads | The media library (`/admin/media`): PNG, JPEG, WebP, AVIF or GIF up to 5 MB, SVG refused; files under `UPLOADS_DIR` (default `.data/uploads`), served at `/uploads/…`; the database stores only their URLs. Or any S3-compatible bucket (`MEDIA_STORAGE=s3`, `S3_*`), still served at `/uploads/…` — docs/content.md#media-library | a named volume at `/app/uploads` under compose; backed up with the database, every time (a bucket you back up yourself) |
| Auth | Better Auth: email + password, verification, reset, magic link, 2FA, optional GitHub/Google | in the app, tables in your Postgres |
| Payments (optional) | Polar (merchant of record), Stripe or Razorpay, behind one `BillingProvider` contract (`src/core/billing.ts`) — docs/billing.md | `BILLING_PROVIDER` / `POLAR_ACCESS_TOKEN`, `STRIPE_SECRET_KEY` or `RAZORPAY_KEY_ID` |
| Email (optional) | Resend or SMTP; console (server log) otherwise — docs/email.md | `RESEND_API_KEY` / `SMTP_URL` |
| Background jobs | A queue in the app's own Postgres (`jobs` table), run by every app process; `/admin/jobs` — docs/jobs.md | in the app (`JOBS_RUNNER=off` skips a process) |
| UI | Tailwind 4 tokens, shadcn/ui on Base UI; motion is CSS (`src/styles/motion.css`), no JavaScript motion library | — |
| Agents | Built-in MCP server at `/api/mcp` | in the app |

Environment (`src/server/env.ts`): `DATABASE_URL`, `DATA_PROVIDER`
(`postgres` default | `memory` for unit tests), `BILLING_PROVIDER`
(`polar` | `stripe` | `razorpay` | `none`; unset: the first whose key is set),
`EMAIL_PROVIDER` (`resend` | `smtp` | `console`),
`OPENSHIPKIT_PROFILE` (`saas` default | `site`: a landing page + blog with no
pricing, billing or plans — docs/site-profile.md), `OPENSHIPKIT_TENANCY`
(`personal` default | `org`: teams — docs/teams.md), `OPENSHIPKIT_WITHOUT`
(features switched off: `blog`, `mcp`), `MEDIA_STORAGE` (`disk` default |
`s3`), `UPLOADS_DIR`, `PGLITE_DIR`
(the embedded database's folder, or `memory://`), `INDEXNOW_KEY` (optional:
pings IndexNow engines when a published post changes). Everything else is
in `.env.example`. `npm run setup` writes `.env.local` (or `.env` for compose)
with generated secrets; in a terminal with no options it asks, or it takes
`--billing`, `--email`, `--tenancy`, `--without` and `--profile`.

**Demo / development:** `npm install && npm run dev` with no env runs on the
embedded Postgres — migrated and seeded at boot by `src/instrumentation.ts`,
persisted across restarts, one process at a time. Production refuses to start
without `DATABASE_URL`, with `DATA_PROVIDER=memory`, with a missing or weak
`BETTER_AUTH_SECRET` (under 32 characters, or placeholder text), with
`EMAIL_PROVIDER=resend` and no `RESEND_API_KEY` (or SMTP without a valid
`SMTP_URL` and an `EMAIL_FROM`), with a billing provider missing its key or
webhook secret, or with `MEDIA_STORAGE=s3` missing an `S3_*` variable; it warns at boot when
`NEXT_PUBLIC_SITE_URL` is unset or local and when email goes to the log
(`src/server/boot-check.ts` via `src/instrumentation.ts`, using the same provider rules as the server:
`src/server/env-rules.ts`).

**Seed:** the starter plans and posts (`src/content/seed.ts`) are added once,
on a database's first seed; a marker in the audit log stops later runs, so what
you delete stays deleted even though the migrator runs `db:seed` on every
deploy. `npm run db:seed -- --force` adds back missing starter rows.

---

## 2. Directory contract

```
src/app/          Routes ONLY. Pages compose components; actions/handlers call src/server/services.
  (marketing)/    Public site: /, /pricing, /blog, /changelog, /legal/[slug], /contact
  (auth)/         /sign-in, /sign-up, /auth/[page] (forgot/reset password, verify email, two-factor), /invite/[token] (teams)
  dashboard/      Signed-in product: home, billing, settings, feedback, team (OPENSHIPKIT_TENANCY=org)
  admin/          role=admin: overview, users, orgs, content, posts, media, plans, feedback, subscribers, agent keys, jobs, audit
  api/            auth/[...auth], billing/{checkout,portal,webhook}, mcp, forms/*, health (readiness) + health/live (liveness), demo ("Try the demo": the showcase's read-only demo admin),
                  admin/media (image upload), indexnow/[key] (the IndexNow key file; next.config.ts rewrites /<key>.txt to it)
  uploads/[...path]   Public media: serves files under UPLOADS_DIR or from the bucket (allow-listed image types, nosniff, sandboxed CSP)
src/core/         Contracts, domain types, zod schemas. NO I/O. Safe anywhere.
src/content/      Default content (defaults.ts) and seed data (seed.ts, seed-posts.ts).
src/server/       server-only. env (+ env-rules.ts, the pure provider rules), registries (data/auth/billing/email, media-store),
                  session, orgs.ts (the current organisation), rate-limit, seed, log.ts (+ scrub.ts, error-reporting.ts),
                  schema-version.ts (the migration /api/health expects), api-reference.ts (source of docs/api.md), http.ts (request helpers for every form/billing route),
                  markdown.ts (render + sanitise), email-templates.ts,
                  auth-ui.ts (the auth forms' registry, imported only by the routes that show them),
  services/       THE write path: validate (zod) → DataStore → audit log. Admin, forms and MCP all call these.
  mcp/            The MCP server: protocol + tools over services.
  jobs/           The Postgres job queue and its runner (email retries, usage reports) — docs/jobs.md.
src/adapters/     The ONLY place a driver or SDK is imported.
  auth/better-auth/   instance.ts (config + hooks) · server.ts (the AuthAdapter) · ui.tsx (forms) · proxy.ts (cookie check)
                      · route.ts (handler) · actions.ts (account-security actions) · errors.ts (codes → sentences)
                      · throttle.ts (per-account limits) · device.ts (session labels)
  data/postgres/      schema.ts · db.ts (server or embedded) · embedded.ts (boot) · lock.ts (embedded process lock)
                      · index.ts (the DataStore)
  data/memory/        the reference DataStore, for unit tests
  billing/            {polar,stripe,razorpay}/ (createPolarProvider() …: BillingProvider) · shared.ts (status mapping, the webhook sink port)
                      · webhook-sink.ts (the webhook write path)
  email/{resend,smtp,console}/
  media/s3/           the S3-compatible upload store (MEDIA_STORAGE=s3)
src/components/   ui/ (shadcn on Base UI) · marketing/ · product/ · site/ · sections/ · blog/ · seo/ · auth/ · billing/ · dashboard/ · admin/ · theme/ · layout/
src/lib/          Client-safe helpers (cn, format, form state, site-url). cn-config.ts compiles to cn-tables.ts (generated: never edit).
src/hooks/        Client hooks (use-mobile, use-mod-key).
src/shared/       Pure helpers safe on client and server (slug, seo, meta-description, jsonld, money, project).
src/styles/       Design tokens and global CSS (tokens.css the palette; brand.css the product accent; prose.css long-form).
src/proxy.ts      Pages only: the optimistic auth redirect and a per-request CSP nonce (policy: src/core/csp.ts).
src/instrumentation.ts   Boot hook: production env check (src/server/boot-check.ts); readies the embedded database in development; starts the job runner.
drizzle/          Generated SQL migrations.
deploy/           Deployment guides and files: VPS (docker compose + Caddy), Dokploy, Coolify, plain Node, backups (database + uploads), hardening.
modules/          Opt-in modules (ai, rag, redis): complete and tested, not imported by the app until enabled — modules/README.md.
examples/         Example apps on the kit (projects, usage-api): not imported by the app — examples/README.md.
scripts/          CLIs: setup, upgrade and ds-sync (plain Node), db-migrate, seed, mcp-key, smoke, e2e (tsx); load-env.mts, the .env loader they share.
tests/            Vitest. Unit tests may also sit next to code as *.test.ts.
docs/             Guides for humans and agents.
```

Import rules:
- `src/core` imports nothing from the app.
- Only `src/server/*` registries (and `src/proxy.ts`, `src/instrumentation.ts`) import `src/adapters/*`; adapters import `src/core`, `src/content`, `src/server/env` and their driver/SDK.
  An adapter that must call back into the app (the auth adapter sending email, reading copy or asking `isBanned()` in `src/server/services/bans.ts`; the embedded database seeding itself) imports a `src/server` module that never imports that adapter back — never `src/server/auth.ts` or `session.ts`.
- Client components (`"use client"`) never import `src/server`, `src/adapters` or anything marked `server-only`.
- One sanctioned exception to the adapter rule: account-security server actions (`src/adapters/auth/better-auth/actions.ts` — sessions, password, two-factor, sign-out) may be imported by `src/app/dashboard/**` and `src/components/dashboard/**`; they are `"use server"` functions, safe to pass to client forms.
- Pages and route handlers never write through the DataStore directly — always a service, so every change is validated and audited.
- Public pages never import `src/server/auth-ui.ts` (directly, through a shared component, or with a lazy `import()`): it carries every auth form into the route's client bundle. Asking who is signed in goes through `src/server/auth.ts` / `session.ts`, which never reach the UI.

Enforced: `npm run lint` fails on the folder rules (`no-restricted-imports` in `eslint.config.mjs`), and `npm test` fails when a client component reaches `src/server`, `src/adapters` or a `server-only` module, when a public page (`src/app/(marketing)/**`, the root layout, `src/components/site/**`) reaches `src/server/auth-ui.ts`, or when anything imports `cn` past `src/lib/utils.ts` (`tests/foundation.test.ts` → "import boundaries"; `npm run check:cn` runs just that).

---

## 3. Invariants

1. **Content in the first byte.** Public pages are Server Components that read at request time (`dynamic = "force-dynamic"` in the root layout). Never `revalidate` a page that reads data: the build has no database. No content behind `useEffect`, no `opacity: 0` on server-rendered content, JSON-LD as a plain `<script type="application/ld+json">`.
2. **The build needs no secrets and no database.** Env is read lazily (`src/server/env.ts`), never at module scope.
3. **A failed read throws; defaults are for “nothing stored”.** A content section renders its default from `src/content/defaults.ts` only when nothing is stored for it, or the stored value no longer passes its schema (field by field, logged). A *failed* read — the database is down — throws, for content exactly as for posts, users and billing: the page shows the error boundary (HTTP 500, `noindex`) and `/api/health` answers 503 for monitors. On a renamed site the defaults are another product’s copy (OpenShipKit’s name, tagline and Organization JSON-LD); served with a 200 during an outage they would be indexed under your domain. A coherent false page — that, an empty blog, a free user who paid — is worse than a 500, which crawlers retry. One section degrades instead of failing: the landing page’s latest posts hide themselves (logged) if the posts read fails while the content reads succeed — nothing on the page claims there are no posts, and `/blog`, the sitemap and the feeds still throw. Tests: `tests/foundation.test.ts` (“content outage”).
4. **Access comes only from verified webhooks.** Entitlements are computed from `subscriptions`/`purchases` rows a signature-verified, idempotent webhook from the billing provider (Polar, Stripe or Razorpay) wrote, after the object was re-fetched from that provider. Never from a redirect, a query string or the client. A row whose product no plan sells (planKey null) grants nothing; a plan that says "Everything in <Plan>" includes that plan (`src/core/plans.ts`), for gates (`requirePlan`) and for what checkout refuses to sell twice. With teams on (`OPENSHIPKIT_TENANCY=org`), `requirePlan` reads the current organisation's plan, and a personal plan still counts (docs/teams.md). That line names the plan by its display name, so the plan service keeps it pointing true: plan names are unique, a rename rewrites the lines that name it (audited), and a plan another plan includes can't be deleted. Pages that offer checkout ask `getCheckoutGuard()` first and show its `label` instead of a button the server would refuse.
5. **The proxy is optimistic** (cookie presence). `requireUser()`/`requireAdmin()` in every page and action is the real check. The proxy never runs on `/api/*`.
6. **Every write is audited** with before/after through `src/server/services/*`. Content, posts and plans can be restored from `/admin/audit` or the MCP `audit_restore` tool.
7. **Admin rights live in the app**: `users.role`, promoted by `ADMIN_EMAILS` (in production only once the address is verified) or by another admin. The last admin who isn't banned can't be demoted, banned or deleted; an `ADMIN_EMAILS` address can't be demoted until it is removed there. A ban ends the person's sessions and refuses them new ones (the auth adapter asks `isBanned()` before it creates a session); the sign-in page says the account is suspended. An MCP agent key belongs to the admin who minted it (`agent_keys.created_by`; keys minted by a key inherit its owner): demoting, banning or deleting that admin revokes their keys, audited.
8. **Never invent real-world identifiers** (domains, product ids, handles). URLs come from `NEXT_PUBLIC_SITE_URL`; provider product, price and plan ids from `/admin/plans`; anything unknown is empty and visibly TODO.
9. **Independent by default.** No hosted auth, database or analytics service is added. The billing provider (Polar, Stripe or Razorpay), email (Resend or SMTP), an S3 bucket and error tracking stay optional and off until their keys are set. An opt-in module (`modules/`, docs/modules) may add an optional third party — an AI provider or an embeddings endpoint (`modules/ai`, `modules/rag`) — on the same terms: not imported until you enable the module, off until its key is set, and replaceable by a self-hosted OpenAI-compatible endpoint (`AI_BASE_URL`, `EMBEDDING_BASE_URL`), so nothing outside your servers is ever required.
10. **Accessible and fast**: WCAG 2.2 AA in both colour schemes, keyboard-complete, `prefers-reduced-motion` honoured, LCP < 2.5 s and INP < 200 ms on a mid phone.

---

## 4. Versions (as installed for 1.1.0, 4 Nov 2026)

Next 16.4.4 · React 19.3.1 · TypeScript ~6.0.3 (not 7: typescript-eslint caps at <6.1) · ESLint 9 (eslint-config-next 16 caps at 9) · Tailwind 4.3.4 · Base UI 1.8 + shadcn 4.21 · Better Auth 1.7.7 (security floor) · Drizzle 0.45.3 / drizzle-kit 0.31.11 · Postgres 18 (compose) / PGlite 0.5 (dev) · Polar SDK 1.0.2 (API 2026-10) · Stripe 23.1 · Razorpay 2.9 · Resend 6.32 · Nodemailer 10.3 (SMTP) · aws4fetch 1.0 (S3) · Zod 4.6 · Node 24 LTS (22.18+ works: `node scripts/setup.mts` needs built-in type stripping; `engines` says so).

Next.js publishes security releases monthly; patch the same week (`npm run check` + `npm run build`).

---

## 5. Code map by area

Which files belong together. Change an area's files together, and keep its
tests next to it.

| Area | Paths |
|---|---|
| Core: contracts, services, session, config | `src/core/**`, `src/server/{env,env-rules,boot-check,data,auth,auth-ui,billing,email,session,rate-limit,seed,http}.ts`, `src/server/http.test.ts`, `src/shared/{money,slug}.ts`, `tests/server-only-stub.ts`, `src/server/services/**`, `src/proxy.ts`, `src/instrumentation.ts`, `src/app/layout.tsx`, `src/app/api/auth/**`, `src/adapters/data/memory/**`, `src/adapters/email/console/**`, `src/content/seed.ts`, `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `tests/foundation.test.ts`, `SPEC.md`, `.gitignore`, `components.json`, `postcss.config.mjs` |
| Database (Postgres, migrations, seed script) | `src/adapters/data/postgres/**`, `drizzle.config.ts`, `drizzle/**`, `scripts/db-migrate.mts`, `scripts/seed.mts`, `scripts/load-env.mts` (the shared .env loader), `tests/data-contract.test.ts`, `tests/contract/**` |
| Auth (Better Auth, sign-in pages) | `src/adapters/auth/**`, `src/app/(auth)/**`, `src/components/auth/**`, `src/server/email-templates.ts`, `tests/secret-rotation.test.ts` |
| Billing (Polar, Stripe, Razorpay), usage and email (Resend, SMTP) | `src/adapters/billing/**`, `src/adapters/email/{resend,smtp}/**`, `src/app/api/billing/**`, `src/components/billing/**`, `src/server/jobs/usage-report.ts`, `tests/{billing,billing-adapters,billing-providers,usage,email,email-queue,smtp}.test.ts` |
| Teams | `src/server/orgs.ts`, `src/app/dashboard/team/**`, `src/app/admin/orgs/**`, `src/app/(auth)/invite/**`, `tests/{orgs,orgs-billing}.test.ts` |
| Design and the marketing site | `DESIGN.md`, `src/styles/{brand,tokens,theme,base,motion,overlays}.css`, `src/components/{site,sections,marketing,theme}/**`, `src/lib/utils.ts`, `src/app/(marketing)/{layout,page}.tsx`, `src/app/(marketing)/{pricing,contact}/**`, `src/app/{not-found,error,global-error}.tsx`, `src/app/api/forms/**`, `src/content/defaults.ts` (copy) |
| Blog, legal pages and SEO | `src/app/(marketing)/{blog,changelog,legal}/**`, `src/app/api/indexnow/**`, `src/server/services/indexnow.ts`, `src/server/markdown.ts`, `src/styles/prose.css`, `src/components/{blog,seo}/**`, `src/shared/{seo,meta-description,jsonld}.ts`, `src/app/{sitemap,robots,manifest}.ts`, `src/app/{opengraph-image,icon,apple-icon}.tsx`, `src/app/favicon.ico/**`, `src/app/llms.txt/**`, `src/app/llms-full.txt/**`, `src/content/seed-posts.ts` |
| Dashboard and admin | `src/app/dashboard/**`, `src/app/admin/**`, media (`src/core/media.ts`, `src/server/services/{media,media-storage}.ts`, `src/server/media-store.ts`, `src/adapters/media/**`, `src/app/api/admin/media/**`, `src/app/uploads/**`, `tests/media-s3.test.ts`), `src/components/{dashboard,admin,product,layout}/**`, `src/lib/**` (except `utils.ts`), `src/hooks/**` |
| Jobs, logs and health | `src/server/jobs/**`, `src/server/{log,scrub,error-reporting,request-error,schema-version}.ts`, `src/app/admin/jobs/**`, `src/app/api/health/**`, `tests/{jobs,observability,health}.test.ts` |
| MCP server | `src/server/mcp/**`, `src/app/api/mcp/**`, `scripts/mcp-key.mts`, `.mcp.json`, `opencode.json`, `docs/mcp.md`, `tests/mcp.test.ts` |
| Opt-in modules | `modules/**`, `docs/modules/**`, `tests/modules/**`, `tsconfig.modules.json` |
| Example apps | `examples/**`, `tests/examples/**` |
| Deploy, CI and docs | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `deploy/**`, `scripts/{setup,upgrade,smoke,e2e,ds-sync}.mts`, `.ds-sync-keep`, `.env.example`, `tests/{env-example,setup,upgrade}.test.ts`, `src/server/api-reference.ts` + `tests/api-reference.test.ts` (`npm run docs:api` → `docs/api.md`), `src/shared/project.ts`, `.github/**`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `LICENSE`, `docs/**` (except `docs/mcp.md`) |
