# AGENTS.md — working on OpenShipKit

For coding agents (Claude Code, Codex, Cursor, Copilot…) and the people who
review their work. [SPEC.md](SPEC.md) is the contract; this file is the
working summary. Where a file’s header comment is more specific, it wins.

**What this is:** one Next.js 16 App Router app, self-hosted. Postgres via
Drizzle, auth via Better Auth (in the app, tables in the same Postgres).
Optional Polar billing and Resend email, both off until their keys are set.
A built-in MCP server at `/api/mcp`. No other services, and none to add — the
one exception is an opt-in module's AI or embeddings provider, off until you
enable the module and set its key (invariant 8).

## Commands

```bash
npm install
npm run dev            # :3000, embedded Postgres in .data/pglite when DATABASE_URL is unset
npm run check          # typecheck + typecheck:modules + lint + test — must pass before you're done
npm run build          # must pass with NO env vars set
npm run smoke          # against the running dev server, read-only: pages (canonical, noindex, one <main>, no cookies), feeds, og:images, links on /, /uploads 404s, unlisted posts (with an MCP key), health, MCP (MCP_DEV_KEY)
npm run e2e            # against the running dev server, WRITES then cleans up: sign-up → admin → edit content → publish → contact → MCP
npm run setup -- --profile site   # a landing page + blog with no SaaS (OPENSHIPKIT_PROFILE=site; docs/site-profile.md)
npm run ds:sync -- --from <design-system>   # dry run; --apply to copy tokens + ui/ from the design system (below)
npm run db:generate -- --name <change>   # after editing src/adapters/data/postgres/schema.ts
npm run db:migrate     # apply migrations (stop `npm run dev` first if on the embedded database)
```

The embedded database allows **one process at a time**. While `npm run dev`
runs, don’t run `db:migrate`, `db:seed` or `mcp:key` against it — the dev
server migrates and seeds on boot anyway. Unit tests use the memory store and
need no database.

## Map

| Path | What lives there | Rule |
|---|---|---|
| `src/app/` | Routes only, including `uploads/[...path]` (public media), `api/admin/media` (upload) and `api/indexnow/[key]` (the IndexNow key file) | Pages compose components; actions/handlers call services |
| `src/core/` | Domain types, contracts (`DataStore`, `BillingProvider`), zod schemas, `CONTENT_KEYS` | No I/O, imports nothing from the app |
| `src/server/` | `env.ts`, registries (`data`, `auth`, `billing`, `email`), `session.ts`, `rate-limit.ts` | `import "server-only"` |
| `src/server/services/` | **The write path**: validate (zod) → DataStore → `recordAudit` | Admin, forms and MCP all call these |
| `src/server/mcp/` | MCP protocol + tools (`tools/*.ts`) | Tools call services, never the DataStore |
| `src/adapters/` | `auth/better-auth`, `data/postgres` (+ `memory` for tests), `billing/polar`, `email/{resend,console}` | The ONLY place a driver/SDK is imported |
| `src/components/` | `ui/` (shadcn on Base UI), `marketing/`, `sections/`, `product/`, `blog/`, `seo/`, … | Client components never import `src/server` or `src/adapters` |
| `src/content/` | `defaults.ts` (default copy), `seed.ts`, `seed-posts.ts` | |
| `src/styles/` | `tokens.css` (palette), `brand.css` (accent), `theme.css`, `prose.css` | Use tokens, never raw colours |
| `drizzle/` | Generated SQL migrations | Generated, committed, never hand-edited after release |
| `tests/` | Vitest; `tests/contract/` runs on memory and on Postgres with `TEST_DATABASE_URL` | |
| `modules/` | Opt-in modules (AI, RAG, Redis), off until enabled per `modules/README.md` | Same rules as the core: services, store contracts and Drizzle custom migrations; `npm run typecheck:modules` checks them |
| `docs/`, `deploy/` | Guides (also the website’s `/docs`, in the order of `docs/nav.json`); `deploy/backups/` backs up the database **and** the uploads | Update them when behaviour changes; a new page goes in `docs/nav.json` (CONTRIBUTING.md → “Writing docs”) |
| `scripts/` | CLIs: setup, db-migrate, seed, mcp-key, smoke, e2e, ds-sync; `load-env.mts` (the shared .env loader) | `setup` and `ds-sync` run on plain Node (no `@/` imports) |

## Setting up a site (not changing the template)

Asked to set up, deploy or run someone’s OpenShipKit site rather than change
the code? Follow [docs/ai-setup.md](docs/ai-setup.md) step by step: each step
has its prompt, its checks and what not to do. The short version: content
goes through the site’s MCP server, not `src/content/defaults.ts`. Secrets
never go into the repository or the chat. And you ask before anything that
leaves the machine: a push, a deploy, a DNS record, a provider change.

## Invariants — don’t break these

1. **Content in the first byte.** Public pages are Server Components rendered at request time. No content behind `useEffect`, nothing at `opacity: 0` on first paint, JSON-LD as a plain `<script>`. Never `revalidate` a page that reads data.
2. **The build needs no secrets and no database.** Read env lazily through `src/server/env.ts` (`requireEnv`, `optionalEnv`), never at module scope.
3. **Every write goes through a service** and is audited with before/after. Pages, route handlers and tools never write through `getData()` directly.
4. **Access comes only from verified webhooks.** Entitlements are computed from `subscriptions`/`purchases` rows that a signature-verified, idempotent Polar webhook wrote. Never from a redirect, query string or the client.
5. **The proxy is optimistic.** `src/proxy.ts` checks cookie presence only. `requireUser()` / `requireAdmin()` in every page and action is the real check. `requireAdmin()` 404s.
6. **A failed read throws — content too.** A section shows its default only when nothing is stored (or the stored value fails its schema). When the database is down, content, posts, users and billing reads all throw: the error page (500, `noindex`), never a renamed site serving the template's copy with a 200. `/api/health` (503) is what monitors watch. The landing page's latest-posts band is the one part that hides itself instead (SPEC invariant 3).
7. **Never invent real-world identifiers** — domains, product ids, handles, testimonials, numbers. URLs come from `NEXT_PUBLIC_SITE_URL` (`siteUrl()`); unknown means empty and visibly TODO.
8. **Independent by default.** No hosted auth, database, analytics or tracking. Polar and Resend stay optional. An opt-in module may add an optional third party (an AI provider, an embeddings endpoint): off until its key is set, and replaceable by a self-hosted OpenAI-compatible endpoint (`AI_BASE_URL`, `EMBEDDING_BASE_URL`).
9. **Accessible**: WCAG 2.2 AA in light and dark, keyboard-complete, labels, visible focus, 44 px targets, `prefers-reduced-motion`. Forms on public pages work without JavaScript.

## Rules that cost traffic

Each looks like fussiness in a diff and is a real failure that cost a site
search traffic. Don’t “fix” them. [docs/seo.md](docs/seo.md#rules-that-cost-traffic)
has the full reasoning; `npm run smoke` checks the ones marked †.

1. **Data pages render at request time.** No `revalidate`, no `generateStaticParams` on a data route — the build has no database, so the page bakes in empty or default content (and a revalidate window caches a draft’s 404 past its publication).
2. **JSON-LD is a plain `<script type="application/ld+json">`** (`<JsonLd>`), never `next/script` — that ships it inside the React payload and the served HTML has none. †
3. **Entity `@id`s are stable and referenced** (`jsonLdIds`): an inline Organization without its `@id` mints a new entity per page and the brand has none to rank.
4. **The origin is written once**: `siteUrl()` from `NEXT_PUBLIC_SITE_URL`. A typed hostname gives canonicals that point at a redirect. †
5. **Meta descriptions: the claim first, under ~155 characters** — the rest is cut off in results. † (warning)
6. **Layouts set `title: { default, template }` and never a canonical** — a layout canonical makes the 404 and the admin “duplicates” of the page it names. †
7. **Nothing ships hidden**: no content at `opacity: 0` or behind `useEffect`; the LCP element never fades in from 0.
8. **robots.txt never blocks `/_next/` or the OG image routes, and every named group repeats the disallows** (a named group replaces `*`).
9. **Published and listed are different questions.** Never filter the sitemap, feeds or `llms-full.txt` on `listed` — unlisted posts are live; dropping them decays their rankings silently.
10. **A failed read throws (500).** Never an empty 200, a 404 or the default copy — a crawler acts on “the site shrank” or on another product's name under your domain, and retries a 500. Posts, the sitemap, feeds, llms files and marketing copy alike.
11. **Dates are `timestamptz`, formatted with `timeZone: "UTC"`** — local formatting shows the previous day east of UTC.
12. **`lastModified` comes from each row**, never one build date for every URL.
13. **Money is integer minor units**; parse `bigint`/`numeric` (strings from `pg`) at the adapter.
14. **One `<main>` per page** (the layout’s). †
15. **No cookies for anonymous visitors, no tracking by default.** † Adding analytics changes the privacy page in the same commit.
16. **Mark up only what’s true**: no ratings, reviews, testimonials, logos or offers you don’t have.
17. **Touch inputs are 16 px or more by *pointer*, not width** (`pointer-fine:text-small`, not `md:`) — iOS zooms the page on a smaller field, including a phone in landscape.
18. **Uploaded images: the database holds the URL, the volume holds the bytes, and a backup takes both** (`deploy/backups/backup.sh`); `/app/uploads` exists in the image owned by `node` before a volume mounts on it, or every upload fails with `EACCES`.
19. **Never a wildcard in `images.remotePatterns`** — an open optimiser is a bandwidth amplifier.

## When you change something

Ask, in this order:

1. **Is the content still in the first byte?** Prose, headings and JSON-LD in the server HTML, not after hydration.
2. **Does it work with JavaScript off?** Public pages and forms do today — `npm run e2e` submits the admin and contact forms without it. Check, don’t assume.
3. **Does it fail the right way?** A failed read throws (an error page, 500) — copy, blog, sitemap and feeds alike; defaults are only for “nothing stored yet”. A page that answers 200 with stand-in content during an outage is the bug.
4. **Is the fact stated once?** A hostname, a slug pattern, a limit or a duration written in a second place is the bug, whatever it says today.
5. **Will the next reader know why?** If a line exists because of a past failure, the comment names the failure.

## How the template stays in step with a design system

The look comes from a design-system repository with the same layout. `npm run ds:sync -- --from <path>`
(or `DESIGN_SYSTEM_DIR`) dry-runs a per-file summary; `--apply` copies
`src/styles/{tokens,theme,base,motion,overlays}.css` and `src/components/ui/**`,
and records the source commit in `src/styles/DESIGN_SYSTEM_VERSION`. It never
touches `brand.css`, `prose.css`, anything else, or files only OpenShipKit has;
`ds-sync:keep start/end` blocks survive; `.ds-sync-deny` (git-ignored) stops
private words from landing here. So: **change a shared token or `ui/` component
in the design system and sync it** — a local edit is overwritten by the next
sync (the dry run’s `−` lines). OpenShipKit-only styling goes in `brand.css`, a
file of its own, or a keep block. [docs/customization.md](docs/customization.md#staying-in-step-with-a-design-system).

## Recipes

### Make a new landing-page section editable
1. `src/core/content.ts` — a zod schema, and an entry in `CONTENT_KEYS` (`schema`, `label`, `description`).
2. `src/content/defaults.ts` — its default value (true, plain copy).
3. `src/components/sections/<name>.tsx` — an async Server Component (`import "server-only"`) that reads `await getContent("<key>")` itself (`src/server/services/content.ts`); place `<Name />` in `src/app/(marketing)/page.tsx`. Sections with an `enabled` flag render nothing when it’s off.
The admin editor (`/admin/content/<key>`) and the MCP `content_*` tools pick it up from the registry — nothing else to wire.

### Add a public page
1. `src/app/(marketing)/<slug>/page.tsx` — Server Component; `generateMetadata` returns `pageMetadata({ title, description, path, … })` from `src/shared/seo.ts` with `getSiteSeo()`.
2. Add the path to `STATIC_PATHS` in `src/app/sitemap.ts`, and a nav link through the `navigation` content key (admin or defaults), not hard-coded.
3. `npm run smoke` — it loads every page the sitemap lists outside the blog, changelog and legal collections (so your new page, once it’s in `STATIC_PATHS`) and checks its `<title>`, `<h1>`, meta description, JSON-LD validity, that it isn’t `noindex` and that its canonical names itself. Look for `page /<slug>` in its output.

### Add a service (a new write)
`src/server/services/<area>.ts`, starting with `import "server-only"`:
call `assertNotDemo(actor)` (`../demo`) first — `tests/demo.test.ts` fails without it — then validate with `parseInput(schema, input)` (`./errors`), read/write through
`await getData()`, then `await recordAudit(actor, "<entity>.<verb>", "<entity>", id, before, after)`.
Throw `ServiceError(code, message)` for refusals. Call it from a server action
(after `requireUser`/`requireAdmin`), a route handler, or an MCP tool.

### Add an MCP tool
1. In the matching `src/server/mcp/tools/<group>.ts`: `defineTool({ name: "noun_verb", title, description, scope, annotations, input: z.strictObject({…}), run })`, and add it to that file’s exported array.
2. `run` calls a service. Pick the least `scope` (`read` < `write` < `admin`) and the right annotation (`READ_ONLY`, `WRITE_IDEMPOTENT`, `WRITE_ADDITIVE`, `DESTRUCTIVE`).
3. Name it in `docs/mcp.md` — `tests/mcp.test.ts` fails otherwise.

### Add a database column
1. `src/adapters/data/postgres/schema.ts` — the column (nullable or with a default, so existing rows migrate).
2. `npm run db:generate -- --name add_<column>` → review and commit the SQL in `drizzle/`.
3. `src/core/types.ts` (+ `src/core/schemas.ts` if it’s input) — the domain field.
4. Map it in `src/adapters/data/postgres/index.ts` and in `src/adapters/data/memory/index.ts`.
5. Cover it in `tests/contract/` — the same tests run on memory and on Postgres.
6. `npm run db:migrate` (stop `npm run dev` first), `npm run check`.

### Change the brand colour
Edit `src/styles/brand.css`: `--accent`, `--accent-ink`, `--accent-hover`,
`--focus` (and optionally `--accent-text`, `--brand-mark-from/to`) for **both**
schemes. Then copy the light values of `--accent` and `--brand-mark-from/to`
into `BRAND` in `src/components/seo/brand-mark.tsx` — the favicon, Apple icon
and Open Graph cards are drawn by Satori, which can’t read CSS variables
(`tests/brand-sync.test.ts` fails until they match). Keep text on the accent at 4.5:1 and the accent against the page at
3:1 — DESIGN.md has the check. Everything else stays the system’s.

### Gate a feature behind a plan
Server side: `await hasPlan(user.id, ["pro"])` from `src/server/services/billing.ts`.
It reads webhook-written rows only. Never trust `?success=1` or the client.

## Environment

`.env.example` lists every variable the app and its npm scripts read (the
`deploy/` shell scripts document their own), and `tests/env-example.test.ts`
fails when code reads a variable it doesn’t list; `npm run setup` writes
`.env.local` (dev) or `.env` with `--compose`. Nothing is needed for the demo.
Production needs `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`,
and `UPLOADS_DIR` on persistent storage (compose pins it to the `uploads` volume).
`DEMO_ADMIN_EMAIL` + `DEMO_ADMIN_PASSWORD` are the OpenShipKit showcase's
read-only demo admin only (docs/auth.md): a new write service calls
`assertNotDemo()` first, and admin pages that show other people's details
render them through `src/shared/privacy-mask.ts` (`privacyLens(viewer)`).
Optional switches: `OPENSHIPKIT_PROFILE=site` (no pricing, billing or plans —
docs/site-profile.md), `INDEXNOW_KEY` (docs/seo.md#getting-crawled),
`PGLITE_DIR` (where the embedded development database lives; `memory://` for
a throwaway one).

## Don’ts

- Don’t add a hosted auth, database, analytics or backend service, or a tracking SDK — the stack is fixed (SPEC §1).
- Don’t import an SDK or driver outside `src/adapters/`.
- Don’t write through the DataStore from a page, handler or tool; don’t skip `recordAudit`.
- Don’t read `process.env` directly in app code; use `src/server/env.ts`.
- Don’t use `"use client"` for content; don’t fetch page content in effects.
- Don’t hand-edit an applied migration; generate a new one.
- Don’t build a filesystem path from env or user input without `/*turbopackIgnore: true*/` on the `resolve`/`join` and the `fs` call (see `src/server/services/media-storage.ts`): the build tracer would copy the whole repo — and a local `.data` database — into `.next/standalone`. CI fails the build if it does.
- Don’t use `drizzle-kit push` against a real database; generate + migrate.
- Don’t hard-code a domain, a Polar product id, a price or a social handle.
- Don’t run two processes on the embedded database.
- Don’t guess Next.js 16 or library APIs — read `node_modules/next/dist/docs/` and the library’s types.
- Don’t hand-edit a synced design-system file (`src/styles/{tokens,theme,base,motion,overlays}.css`, `src/components/ui/**`) without upstreaming it or wrapping it in a `ds-sync:keep` block.
- Don’t store uploaded bytes in Postgres, or back up the database without the uploads (or the reverse).
- Don’t copy anything personal into this repository — real domains, server addresses, hosting accounts, emails, names, local paths. Use `example.com` and placeholders. The only real names are the project’s own credit (“A DRISH LABS project” with drishlabs.com, where it is listed under /apps, and the DrisH31 GitHub owner; OpenShipKit has no website of its own), and on the site they render only while `isShowcase` (`src/shared/seo.ts`) is true, so a renamed fork never shows them.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
