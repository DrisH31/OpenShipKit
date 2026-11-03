# Content

Everything a visitor reads is data in your Postgres, editable in `/admin`
or by an agent over MCP — no redeploy to change a headline. Every change is in
the audit log with the value before and after, and can be undone.

## Landing-page sections

Each section is one JSON document under a content key, validated by a zod
schema in `src/core/content.ts` on every read and write:

| Key | Section |
|---|---|
| `site` | name, tagline, SEO defaults (title, description, OG image), contact email, social links |
| `navigation` | header links, header call-to-action, footer columns |
| `announcement` | the thin bar above the header |
| `hero` | the first screen |
| `logos` | “trusted by” names under the hero |
| `features` | the feature grid (icons are lucide names, e.g. `shield-check`) |
| `steps` | a short numbered sequence |
| `stats` | figures, each with its source |
| `testimonials` | quotes from real customers |
| `pricing` | the copy around the plan cards (plans themselves are in `/admin/plans`) |
| `latestPosts` | the newest blog posts, near the end of the page: on/off, eyebrow, title, subtitle, how many (1–6, default 3) and the label of the link to `/blog` (empty hides it). Published **listed** posts only |
| `faq` | questions and answers (also emitted as FAQPage JSON-LD) |
| `cta` | the closing call-to-action band |

Edit them at **`/admin/content`**. Sections with an `enabled` flag can be
switched off. `stats` and `testimonials` ship **off** — the template has no
invented numbers or quotes. `announcement`, `logos` (“Built entirely on open
source”) and `steps` ship **on** with OpenShipKit’s own copy: rewrite them for
your product or switch them off before launch.

**Defaults.** Until a key is saved, the site shows its default from
`src/content/defaults.ts`. A stored value always wins over the default, so to
change a running site use the admin (or MCP), not the file. A stored value
that no longer passes its schema (after an upgrade tightened a rule) shows the
default for just the failing fields, and the server log says which.
“Reset” in the admin deletes the stored value and returns to the default.

**When the database is down, pages fail; they don’t fall back.** A failed read
is an error page (HTTP 500, `noindex`), not the defaults: on a renamed site
the defaults are OpenShipKit’s own copy, and serving them with a 200 would put
another product’s name under your domain in search results. Crawlers retry a
500. Watch `/api/health` (503 during an outage)
([deployment.md](deployment.md#health-and-checks); SPEC invariant 3). The
“Latest posts” band is the one exception: if only the posts read fails, it
hides itself and the rest of the page renders.

While the site is still named “OpenShipKit”, the landing page also shows the
template’s own showcase sections (the stack, the agent demo, deploy targets).
Rename the site in `/admin/content/site` and they disappear.

## Posts, changelog and pages

One table, three kinds, edited at **`/admin/posts`**:

| Kind | Public URL | Feed |
|---|---|---|
| `post` | `/blog/<slug>`, tag pages at `/blog/tag/<tag>` | `/blog/rss.xml` |
| `changelog` | `/changelog/<slug>` | `/changelog/rss.xml` |
| `page` | `/legal/<slug>` (privacy, terms, about…) | — |

- Bodies are **Markdown** (GitHub-flavoured: tables, task lists, code blocks).
  Raw HTML is sanitized against an allowlist. A `#` heading in a body renders
  as `<h2>` — the title is the page’s only `<h1>`. `##`–`####` headings build
  the table of contents.
- **Draft, published, unlisted.** A draft is not public anywhere. Publishing
  sets `publishedAt` and makes it live. A published post can also be
  **unlisted** (“Show on the blog list” — or “Show on the changelog” —
  unchecked in the editor, or `listed: false` over MCP): it stays live at its URL and in everything
  that tells crawlers what exists, but is no longer promoted:

  | | Its URL | Sitemap, RSS, `llms-full.txt` | `/blog`, tag pages, the changelog list, “Keep reading”, the landing page, `llms.txt` |
  |---|---|---|---|
  | **Draft** | 404 | no | no |
  | **Published, unlisted** | 200, indexable | yes | no |
  | **Published** (listed) | 200, indexable | yes | yes |

  Unlist a post that has outlived its reason to be promoted (the feature it
  announced is gone, a newer guide replaces it); don’t unpublish it — that
  throws away its rankings and every link to it. The admin’s post list marks
  them “Unlisted”. [seo.md](seo.md#rules-that-cost-traffic) rule 9 says why the
  sitemap and feeds must keep them.
- Each post has a title, slug, description (the meta description — write it
  for search results), tags, an optional cover image URL with its description
  (`coverAlt` — the image’s alt text, also used as `og:image:alt`; describe what
  the picture shows) and an author name.
  Per-post Open Graph images are generated automatically.
- **Page through** with “Older” and “Newer”: pages after the first have a
  `?cursor=` URL, which is `noindex, follow` (it shifts as you publish).
  A tag page (`/blog/tag/<tag>`) is indexed only once the tag has 3 or more
  posts and is on less than 80% of them ([seo.md](seo.md#what-is-kept-out-of-search)).
- The starter posts and changelog entry are samples about OpenShipKit. Once you
  rename the site, any of them still in OpenShipKit’s words (same slug, and an
  unchanged title or body) is `noindex` and left out of the sitemap, the RSS
  feeds and the llms files; `npm run smoke` warns while one is live. Rewrite
  them or delete them.
- **The seed runs once per database.** The starter plans and posts are added
  on a database’s first seed; a marker in the audit log stops later runs, so
  what you delete stays deleted even though `db:seed` runs on every deploy.
  `npm run db:seed -- --force` adds back any starter row that is missing (it
  never overwrites one you kept).

## Media library

**`/admin/media`** stores images on your own disk: upload one (it works
without JavaScript), copy its address into a post’s cover or body, or use the
post editor’s “Upload cover”.

- **PNG, JPEG, WebP, AVIF or GIF, up to 5 MB.** The file’s *bytes* decide its
  type, not its name or what the browser claims; a claim that disagrees with
  the bytes is refused. **SVG is always refused**: an SVG is a document that
  can carry script, and served from your domain it would run with your
  admin’s session in reach. A logo that must be vector belongs in the code.
- Each image gets a random name, `/uploads/<yyyy>/<mm>/<32 hex>.<ext>`, so a
  URL never carries the uploader’s file name and never changes what it points
  at; it is served publicly with a year of caching, `nosniff` and a
  sandboxing CSP. Any other path under `/uploads/` is a 404.
- **Delete is refused while the image is in use** — by a post’s cover or
  body, or by a content section (the site’s social image, a hero image…). The
  refusal names where. A delete is in the audit log but can’t be undone from
  it: the bytes are gone.
- **Where the files live:** `UPLOADS_DIR` — `.data/uploads` in development,
  the `uploads` volume at `/app/uploads` under compose, a folder outside the
  checkout on plain Node. The database stores only the URLs, so **every
  backup must take the folder with the database** — `deploy/backups/backup.sh`
  does both, with one timestamp ([data.md](data.md#uploads)). A restore of one
  without the other leaves broken images or orphaned files.
- Agents: `media_list` and `media_upload` (up to 700 KB through MCP; no
  delete, no fetching from a URL) — [mcp.md](mcp.md).

## Legal pages

`privacy` and `terms` ship as **templates with `[bracketed placeholders]`**.
They are a starting point, not legal advice. Fill in every placeholder (your
legal name, address, the processors you actually use — Polar and Resend only if
you turned them on), then have someone qualified review them for your
jurisdiction. The footer links to them.

## Plans

`/admin/plans`: name, description, features, prices (amount, currency,
interval, Polar product id), trial days, “highlighted”, “contact sales” and
active. Free plans have no prices. Order is the `sortOrder`. See
[billing.md](billing.md).

## Forms

- **Contact** (`/contact`) and **feedback** (`/dashboard/feedback`) land in
  **`/admin/feedback`** — stored in your database, not a form service. Triage
  with statuses and a private note.
- **Newsletter** sign-ups land in **`/admin/subscribers`** (CSV export). OpenShipKit
  doesn’t send newsletters; export the list to whatever you send with.

All public forms work without JavaScript and are rate-limited per IP.

## Undo

**`/admin/audit`** lists every change: who (admin, agent key name, webhook,
seed), what, when, before and after. Content, posts and plans have a restore
button; agents have the `audit_restore` tool.

## With an agent

The MCP tools `content_get`/`content_update`, `post_*`, `plan_*`,
`media_list`/`media_upload` and `feedback_*` do all of the above. An agent reads the schemas with `guide`
first, and its changes appear in the audit log under its key’s name.
[mcp.md](mcp.md).
