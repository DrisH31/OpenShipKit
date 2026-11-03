# Customization

The code you change to make OpenShipKit your product, in the order most
products need it: the brand colour, the name and icons, landing sections, new
pages, your product’s own screens, components, removing what you don’t need,
and staying in step with the design system. Copy and plans are data, not code
([content.md](content.md)).

## Brand colour

**`src/styles/brand.css`**, plus its literal copies for the generated images
(below). A product sets only its action colour —
everything else (greys, text, status colours, charts) stays the design
system’s, so changing it can’t break contrast elsewhere.

```css
:root, .light {
  --accent: #C2410C;        /* primary buttons, focus ring, the selected item */
  --accent-ink: #FFFFFF;    /* text on the accent */
  --accent-hover: #A8360A;
  --focus: #C2410C;
  --accent-text: #B4380B;   /* the accent used as text */
  --brand-mark-from: #F59E0B;  /* the logo's gradient */
  --brand-mark-to: #E5431A;
}
.dark { /* the same variables, for the dark scheme */ }
```

Set them for **both** schemes. Keep `--accent-ink` on `--accent` at 4.5:1 or
more and the accent against the page background at 3:1 or more (WCAG 2.2 AA).
[DESIGN.md](../DESIGN.md) explains the system and how to check contrast. Use
the accent for actions only — not headings, bands or navigation.

**Then the generated images.** The favicon, Apple icon and Open Graph cards
are drawn by Satori (`next/og`), which can’t read CSS variables, so
`src/components/seo/brand-mark.tsx` keeps literal copies in `BRAND`: set
`accent`, `markFrom` and `markTo` to your light-scheme `--accent` and
`--brand-mark-from/to`. `npm test` (`tests/brand-sync.test.ts`) fails until
every `BRAND` value matches its token.

## Name, logo and icons

- **Name, tagline, SEO defaults**: `/admin/content/site` (no code).
- **Logo**: `src/components/site/logo.tsx` (the header/footer mark and
  wordmark). The favicon (`src/app/icon.tsx`), Apple icon
  (`src/app/apple-icon.tsx`) and Open Graph image (`src/app/opengraph-image.tsx`)
  are generated from the mark in `src/components/seo/brand-mark.tsx` — change
  it there and every surface follows.
- **Fonts**: `src/app/layout.tsx` (via `next/font`, self-hosted at build — no
  request to a font service at runtime). The CSS variables they set are used by
  `src/styles/theme.css`.

## Landing page

Sections are in `src/components/sections/` and are placed in
`src/app/(marketing)/page.tsx`. Reorder, remove or add one there. To make a new
section editable, follow the recipe in [AGENTS.md](../AGENTS.md#make-a-new-landing-page-section-editable):
schema → default → component; the admin and MCP pick it up.

The OpenShipKit showcase sections (`OwnStack`, `Agent`, `Deploy`, `AiSetup`)
render only while the site name is “OpenShipKit”, and so do the other parts
that talk about the template itself: the clone command under the hero and in
the close, the features’ product pictures, the header’s GitHub button and the
footer’s credit. Delete them from the page and the `sections/` folder whenever
you like.

These guides are also served at `/docs` while the site is named OpenShipKit.
Rename it and `/docs` answers 404 (and leaves the sitemap and `llms.txt`), and
the default navigation drops its Docs links, because they describe the template,
not your product. Set `OPENSHIPKIT_PUBLIC_DOCS=true` to keep publishing them.

The showcase's header can also ask for support: with `OPENSHIPKIT_SUPPORT_URL`
set (an https checkout link, such as a Polar pay-what-you-want product), its
action becomes "Support the project". It only ever shows while the site is
named OpenShipKit, so your product can leave the variable empty and forget it.

## New pages

Public pages go in `src/app/(marketing)/<slug>/page.tsx` as Server Components,
with `generateMetadata` built by `pageMetadata()` (`src/shared/seo.ts`). Add the
path to `STATIC_PATHS` in `src/app/sitemap.ts` and a link via the
`navigation` content key. Long-form text is usually better as a `page` post at
`/legal/<slug>` — no code at all.

## Your product

The signed-in app lives in `src/app/dashboard/`. The shell (sidebar, command
menu ⌘K, breadcrumbs, user menu) is `src/components/product/`; the sidebar
items are in `src/lib/app-nav.ts`.

A new dashboard page:

```tsx
// src/app/dashboard/reports/page.tsx
import { requireUser } from "@/server/session";
import { PageHeader } from "@/components/product/page-header";

export default async function ReportsPage() {
  const user = await requireUser("/dashboard/reports");
  // read through a service; write through a server action that calls a service
  return <PageHeader title="Reports" />;
}
```

Then add `{ group: "Product", href: "/dashboard/reports", label: "Reports", icon: "home" }`
to the dashboard list in `src/lib/app-nav.ts` (`icon` is a `NavIcon` key; a new
icon gets a key there and in `src/components/product/nav-icons.tsx`). New data gets a table
([data.md](data.md#migrations)) and a service ([AGENTS.md](../AGENTS.md#add-a-service-a-new-write)).

## Components

- `src/components/ui/` — shadcn/ui on Base UI (button, input, dialog, table,
  select, tabs, sidebar…). Add more with `npx shadcn@latest add <name>`
  (`components.json` is configured).
- `src/components/marketing/` — layout and type for public pages.
- `src/components/product/` — the app shell, page headers, KPIs, empty and
  error states, forms that work without JavaScript.
- `cn()` from `@/lib/utils` merges classes. Use the token utilities from
  `src/styles/theme.css` (`bg-surface`, `text-ink-2`, `border-line`…) rather
  than raw colours, and the type-scale classes, so light and dark both work.

## Removing what you don’t need

- **A content site, no SaaS at all** (landing page + blog, no pricing,
  billing or plans): `npm run setup -- --profile site`
  ([site-profile.md](site-profile.md) — a switch, so template updates still
  merge; the same page lists what to delete if you want the code gone).
- **No billing**: leave `POLAR_ACCESS_TOKEN` unset. Free plans work; or hide
  the pricing section in `/admin/content/pricing` and remove `/pricing` from
  the navigation.
- **No blog/changelog**: remove the links from `navigation`; the routes stay
  harmless with no posts, or delete their folders under `src/app/(marketing)/`
  and their entries in `src/app/sitemap.ts`.
- **No MCP**: deleting `src/app/api/mcp/` turns the endpoint off, but a few
  things still point at it. Remove them too, or `npm run smoke` (and CI)
  fails and the admin offers keys for a dead endpoint:
  - `src/app/api/mcp/` and `src/server/mcp/`, except
    `src/server/mcp/server-info.ts` (`/api/health` reads the version from it;
    move it if you like), and `tests/mcp.test.ts`;
  - the “mcp refuses no key” check and `--mcp-key` in `scripts/smoke.mts`;
  - `/admin/agents` (`src/app/admin/agents/`) and its nav item in
    `src/lib/app-nav.ts`, plus `src/lib/mcp-snippets.ts`;
  - `scripts/mcp-key.mts` and the `mcp:key` script in `package.json`,
    `MCP_DEV_KEY` / `MCP_ALLOWED_ORIGINS` in `.env.example` and
    `scripts/setup.mts`, `.mcp.json`, and `docs/mcp.md`;
  - the copy that advertises it: the agent section on the landing page
    (`src/components/sections/agent.tsx`, used in `src/app/(marketing)/page.tsx`),
    the “Connect an AI agent” step on the dashboard, and the MCP lines in
    `src/components/seo/llms.ts`.

  Then run `npm run check` and
  `grep -rn --exclude-dir=node_modules --exclude-dir=.next "api/mcp\|mcp:key\|server/mcp" .`
  to catch the rest.
  The `agent_keys` table is harmless left in place.

## Staying in step with a design system

The look — tokens, theme, base styles, motion, overlays and the `ui/`
components — can come from a separate design-system repository with the same
layout (`src/styles/*.css`, `src/components/ui/`). OpenShipKit then stays in
step with it by **syncing**, never by hand-copying:

```bash
npm run ds:sync -- --from <design-system>           # dry run: a per-file summary, nothing written
npm run ds:sync -- --from <design-system> --apply   # write it; record the source commit
git diff && npm run check                            # review; contrast and import tests run here
```

(`DESIGN_SYSTEM_DIR` in your shell or `.env.local` saves typing `--from`;
nothing in the repository names your path.)

What moves: `src/styles/{tokens,theme,base,motion,overlays}.css` and
`src/components/ui/**`. What never does: `src/styles/brand.css` (your accent),
`prose.css`, everything outside those two places, and any file only OpenShipKit
has. `--apply` records the design system’s name, version, commit and
`git describe` in `src/styles/DESIGN_SYSTEM_VERSION` — which version you are
on is a file, not a memory.

The rules that keep a sync safe:

- **Change shared files upstream.** A fix to `button.tsx` or `tokens.css`
  belongs in the design system; sync it here. A local edit to a synced file is
  overwritten by the next sync — the dry run shows it as `−` lines (what
  OpenShipKit would lose), so read those before `--apply`.
- **OpenShipKit-only rules go in a keep block**, when they must live in a
  synced file:

  ```css
  /* ds-sync:keep start openshipkit-motion */
  .just-changed::before { … }
  /* ds-sync:keep end */
  ```

  A sync carries the block to the end of the new file (later CSS wins, so an
  override keeps working). Once the design system has the same rules, the
  block is dropped instead of doubled. Better still: a file of your own beside
  the synced ones (like `brand.css`).
- **Pin files that must not move** with `--keep <path>` or one path per line
  in `.ds-sync-keep` (committed).
- **Keep private words out.** A design system is often private and this
  repository may be public. List your own brand, client or product names in
  `.ds-sync-deny` (git-ignored, one per line): `--apply` refuses while any
  incoming file contains one, and says where.
- **New dependencies are reported, not installed.** If an incoming component
  imports a package `package.json` lacks, or an `@/` path that doesn’t exist,
  the dry run says so; add it deliberately.

After a sync: `npm run check` (the contrast test measures every token pair in
both schemes, with your `brand.css` folded in), `npm run smoke`, a look in both
schemes, and a commit that names the design-system version.
