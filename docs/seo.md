# SEO

OpenShipKit is built so search engines and AI answer engines can read every
public page on the first request, and so you never have to remember the
plumbing. What it does, and what’s left to you.

## What’s built in

| | Where | Notes |
|---|---|---|
| **Server-rendered content** | every public page | Server Components at request time: the words, links and structured data are in the first byte of HTML. No content behind JavaScript, nothing hidden at first paint |
| **Titles, descriptions, canonicals** | `pageMetadata()` in `src/shared/seo.ts` | defaults from `/admin/content/site`; each post’s description is its meta description |
| **Open Graph + Twitter cards** | `src/app/opengraph-image.tsx` (the site card); per post and per changelog entry `src/app/(marketing)/{blog,changelog}/[slug]/og/route.ts` (served at `/blog/<slug>/og`, drawn by `src/components/seo/post-card.tsx` on `og-card.tsx`) | generated 1200×630 PNGs; a site-wide OG image URL can be set in `site` |
| **JSON-LD** | `src/shared/jsonld.ts`, rendered as plain `<script type="application/ld+json">` | Organization + WebSite on every public page; on `/`, SoftwareApplication + SoftwareSourceCode while it’s the OpenShipKit showcase, or WebApplication + Offers (on `/` and `/pricing`) once you rename the site (no Offers under `OPENSHIPKIT_PROFILE=site`, [site-profile.md](site-profile.md)); FAQPage where an FAQ shows; BlogPosting + BreadcrumbList on posts, Article + BreadcrumbList on changelog entries; WebPage + BreadcrumbList on legal pages; CollectionPage on indexes |
| **Sitemap** | `/sitemap.xml` (`src/app/sitemap.ts`) | marketing pages, published posts (listed **and** unlisted), changelog entries, legal pages once their placeholders are filled, indexable tag pages (below); `lastModified` only from real edits. On a renamed site, starter posts still in OpenShipKit’s words are left out (below) |
| **robots.txt** | `/robots.txt` (`src/app/robots.ts`) | open to search **and AI crawlers** by name (Googlebot, Bingbot, OAI-SearchBot, ClaudeBot, PerplexityBot…); `/admin`, `/dashboard` and `/api/` disallowed. Auth pages (`/sign-in`, `/sign-up`, `/auth/*`) stay crawlable on purpose so crawlers read their `noindex`: a blocked URL can still be indexed from links alone |
| **llms.txt** | `/llms.txt`, `/llms-full.txt` | the [llmstxt.org](https://llmstxt.org) map of the site, and the full text of posts and pages, for LLMs (starter posts left out on a renamed site) |
| **RSS** | `/blog/rss.xml`, `/changelog/rss.xml` | the blog feed is linked from every page’s `<head>` (with the blog switched off, `OPENSHIPKIT_WITHOUT=blog`, there is no blog feed and no link to it); the changelog feed from `/changelog`’s (starter posts left out on a renamed site) |
| **Images** | `/uploads/…` (`src/app/uploads/[...path]/route.ts`), uploaded in `/admin/media` | served from your own origin with a year of caching (names are random and never reused); crawlable, so image search can find them. Write each cover’s `coverAlt` |
| **IndexNow (optional)** | `src/server/services/indexnow.ts`, the key file at `/<INDEXNOW_KEY>.txt` | pings Bing and the other IndexNow engines when a published post changes ([below](#getting-crawled)) |
| **Web app manifest, icons** | `src/app/manifest.ts`, `icon.tsx`, `apple-icon.tsx` | |
| **Performance** | — | self-hosted fonts, AVIF/WebP images, no client-side data fetching for content: LCP < 2.5 s, INP < 200 ms on a mid phone is the target |

Everything that prints a URL reads **`NEXT_PUBLIC_SITE_URL`**. Set it to your
`https://` origin in production; otherwise canonicals and the sitemap point at
`http://localhost:3000`.

## What is kept out of search

Some public pages render for visitors but tell crawlers `noindex` (and stay
out of the sitemap), on purpose:

| Page | Why | Rule |
|---|---|---|
| **Starter posts on a renamed site** | Once you rename the site in `/admin/content/site`, the seeded blog posts and changelog entry are OpenShipKit’s words, not yours, and every copy of the template carries the same text | A published post or changelog entry whose slug is a starter one and whose title or body is unchanged (`isStarterContent` in `src/content/seed-posts.ts`) is `noindex` and left out of the sitemap, both RSS feeds and the llms files. Rewrite or delete them; `npm run smoke` warns while any is still live |
| **Pager pages** (`/blog?cursor=…`, `/changelog?cursor=…`, a tag’s later pages) | A cursor URL’s contents shift every time you publish | `noindex, follow`: crawlers follow the pager to every post, and every post is in the sitemap |
| **Thin or catch-all tag pages** (`/blog/tag/<tag>`) | A tag on one or two posts is thin; a tag on nearly every post repeats `/blog` | Indexed (and in the sitemap) only with **3 or more** posts and on **less than 80%** of all published posts (`isIndexableTag` in `src/components/blog/format.ts`); otherwise `noindex, follow` |
| **Unfinished legal pages** | `privacy` and `terms` still carrying `[bracketed placeholders]` | `noindex` and out of the sitemap until every placeholder is filled |
| **Auth pages** | `/sign-in`, `/sign-up`, `/auth/*` | always `noindex` |

While the site is still named “OpenShipKit” it is the showcase, and the starter
posts are its own: they are indexed.

**Unlisted is not hidden.** Draft and unlisted answer different questions —
*is it public?* and *is it promoted?*:

| | Its URL | Sitemap, RSS, `llms-full.txt`, IndexNow | `/blog`, tag pages, the changelog list, “Keep reading”, the landing page’s latest posts, `llms.txt` |
|---|---|---|---|
| **Draft** | 404 | no | no |
| **Published, unlisted** (`listed: false`) | 200, indexable | yes | no |
| **Published** | 200, indexable | yes | yes |

Unlist (the post editor’s “Show on the blog list”, or `post_update` over
MCP) when a post outlives its reason to be promoted — the feature it announced
is gone, a newer guide replaces it. Unpublishing it instead throws away its
rankings and every link pointing at it. Tag pages count only listed posts, so
an unlisted post never makes a tag indexable on its own. Rule 9 below is the
code-side half.

## Your checklist

1. **`NEXT_PUBLIC_SITE_URL`** = your exact origin (`https://example.com`, no
   trailing slash, the www or non-www you actually serve; redirect the other).
2. **Site settings** (`/admin/content/site`): a name, a tagline, a default
   title and a 150–160 character description that says what the product does
   for whom.
3. **Real copy.** One clear `h1` on the landing page (the hero title), specific
   feature text, an FAQ answering what buyers actually ask.
4. **Each post**: a descriptive slug, a title that matches the query you want,
   a description written for the results page, two or three tags.
5. **Search consoles.** Verify the domain in Google Search Console and Bing
   Webmaster Tools (a DNS `TXT` record is easiest) and submit
   `https://example.com/sitemap.xml`.
6. **Check what crawlers see:**

   ```bash
   npm run smoke -- https://example.com            # titles, h1, descriptions, JSON-LD, canonicals, noindex, sitemap, robots, llms.txt
   curl -s https://example.com/ | grep -o '<title>[^<]*'
   ```

   Smoke fails on a public page marked `noindex`, a canonical that is
   missing, relative, on another origin or naming another page, and on
   sitemap or canonical URLs still on `localhost` (`NEXT_PUBLIC_SITE_URL`
   unset); `/sign-in` and `/sign-up` must be `noindex`. It also fails on two
   `<main>` elements on a page, a cookie set for an anonymous visitor, an
   `og:image` that doesn’t answer with an image, a link on `/` that 404s, and
   a 404 page that isn’t `noindex` or carries a canonical. It warns (without
   failing) on a meta description past 160 characters and while a renamed site
   still serves starter posts. It also checks that a made-up file under
   `/uploads/` is a 404; with `--mcp-key`, that every unlisted post answers
   200 without `noindex`, is in the sitemap, and is absent from `/blog` and
   the landing page’s latest posts; and with `--indexnow-key <key>`, that
   `/<key>.txt` answers with exactly the key. Then run Google’s Rich Results
   Test on `/` and a post.
7. **The same by hand**, when you want to see it rather than trust a script
   (each line is one rule below):

   ```bash
   SITE=https://example.com
   curl -s $SITE/ | grep -o '<link rel="canonical"[^>]*>'                  # names $SITE itself, not localhost or www
   curl -sI https://www.example.com/ | grep -i '^location'                  # the other host 308s to $SITE
   curl -s $SITE/ | grep -c 'application/ld+json'                           # NOT 0: JSON-LD is in the served HTML
   curl -s $SITE/sitemap.xml | grep -c '<loc>'                              # your posts, not only the static pages
   curl -s $SITE/robots.txt | grep -c '^Disallow: /admin'                   # one per group: every named group repeats them
   curl -s -o /dev/null -w '%{http_code}\n' $SITE/no-such-page              # 404 …
   curl -s $SITE/no-such-page | grep -o 'noindex\|rel="canonical"'          # … noindex, and no canonical
   curl -sI $SITE/ | grep -ci '^set-cookie'                                 # 0: nothing for an anonymous visitor
   curl -s $SITE/llms.txt | head -n 20                                      # generated from your posts
   ```

8. **Tell the engines.** Submit `https://example.com/sitemap.xml` once in each
   console; after that they re-read it on their own. Optionally set
   `INDEXNOW_KEY` (below) so Bing and the engines that share IndexNow hear
   about each publish within minutes.

## AI crawlers

`robots.txt` allows AI search and training crawlers by name, on purpose: for a
new product the problem is not being known, and AI answers cite pages they
can read. To opt a bot out, edit `NAMED_BOTS` in `src/app/robots.ts` and give
it `disallow: "/"` — the file explains each name. robots.txt is a request, not
access control; private pages are protected by auth regardless.

## Getting crawled

- **One host.** Serve either `example.com` or `www.example.com` and redirect
  the other with a 308 (Caddy: a second site block with `redir`). Set
  `NEXT_PUBLIC_SITE_URL` to the one you serve. A canonical that names the host
  which redirects tells search engines your pages live at a redirect.
- **Submit the sitemap once** in Google Search Console and Bing Webmaster
  Tools. Don’t resubmit it on every deploy; it changes nothing.
- **IndexNow (optional).** With `INDEXNOW_KEY` set, publishing, editing,
  unpublishing or deleting a published post (listed or not; never a draft)
  asks the IndexNow engines (Bing, Yandex, Seznam, Naver…) to recrawl that
  URL — minutes instead of days. Google doesn’t take part; the sitemap covers
  it. The key is 8–128 characters of letters, digits and `-`
  (`openssl rand -hex 16`); a malformed one turns IndexNow off with a warning
  in the log. It is public by design: the engines verify it by fetching
  `https://example.com/<key>.txt`, which a rewrite in `next.config.ts` serves
  from `src/app/api/indexnow/[key]` (any other name is a 404). After you set
  it, run `npm run smoke -- https://example.com --indexnow-key <key>`, or
  `curl https://example.com/<key>.txt`. If the key and that file drift, every
  submission is refused with a 403 and the server log is the only place that
  says so. Nothing is sent unless `NEXT_PUBLIC_SITE_URL` is a public
  `https://` origin (not local, a private address or an example domain), and a
  ping never slows or fails the save.
- **A stale result under the other host** (`www.` after you moved to the bare
  domain, or the reverse): request a recrawl of the URL with Search Console’s
  URL Inspection, and wait. **Never** use the Removals tool for it — Google
  treats the www and non-www variants as one, so removing one hides the other
  too, for about six months.

## Rules that cost traffic

Each of these is a mistake that looks harmless in a diff and costs search
traffic quietly, weeks later. The rule, then the failure it prevents.
[AGENTS.md](../AGENTS.md#rules-that-cost-traffic) has the one-line version.

1. **A page that reads the database renders at request time — never
   `revalidate`, never `generateStaticParams` on a data route.** The build has
   no database, so a prerendered page bakes in whatever the read returned at
   build time (the defaults, an empty list) and serves it as the real page.
   ISR then “fixes” it after the first request and every deploy breaks it
   again, so it looks intermittent. A revalidation window also caches
   `notFound()`: a URL crawled while its post was a draft keeps answering 404
   after you publish. The root layout sets `dynamic = "force-dynamic"`; keep it.
   If rendering a post ever shows up in a profile, cache the rendered body
   keyed on the post’s `updatedAt` — never by time.
2. **JSON-LD is a plain `<script type="application/ld+json">`** (`<JsonLd>`
   in `src/components/seo/json-ld.tsx`), never `next/script`. `next/script`
   sends its children through the client runtime: the tag ships inside the
   React payload and is inserted after hydration, so the served HTML holds
   **zero** structured data — and a crawler that doesn’t run JavaScript (most
   AI crawlers) never sees it. Smoke counts the real tags.
3. **Entity `@id`s are stable and shared.** The Organization and WebSite are
   `<origin>/#organization` and `<origin>/#website` (`jsonLdIds` in
   `src/shared/jsonld.ts`); every other node points at them by that `@id`.
   An inline Organization without the `@id`, on each article, mints a new
   entity per page — and a search for your brand then has no single entity to
   rank. Keep one description per `@id`, and no live counts in it: the same
   entity described two ways is two claims.
4. **The origin is written once: `NEXT_PUBLIC_SITE_URL`** (`siteUrl()`).
   Never type a hostname into a route. A hard-coded host that differs from the
   one you serve gives every page a canonical pointing at a redirect, and turns
   the sitemap into a list of redirects; nothing looks broken, the only symptom
   is the hostname in search results. Smoke fails on canonicals still on
   `localhost` when checking a real origin.
5. **Meta descriptions: the claim first, and under about 155 characters.**
   Results pages cut the rest, mid-word. Write the sentence so it *ends*
   inside the budget instead of being cut mid-list; the brand in title case,
   as in the `<title>`. Smoke warns past 160.
6. **Layouts set `title: { default, template }` and never a canonical.** A
   bare-string title in a layout strips the brand from every page below it. A
   canonical in a layout is inherited by every page that doesn’t set its own —
   including the 404 page and the admin — and declares them duplicates of the
   page it names. Each page sets its own with `pageMetadata()`; the 404 page
   has `noindex, follow` and no canonical. Smoke checks the 404.
7. **Nothing ships hidden.** No content at `opacity: 0` in the server HTML
   waiting for JavaScript to reveal it; no content behind `useEffect`. Without
   JavaScript (or before it runs) the page is blank, and a fade-in from `0` on
   the largest element pushes LCP out by the whole delay. Entrance motion
   starts from *nearly* there (`.arrive` in `src/styles/motion.css`);
   scroll reveals are for devices and pictures, never text.
8. **robots.txt never blocks `/_next/` or the image routes, and every named
   group repeats the disallows.** The CSS lives under `/_next/static`; Google
   renders pages with it. Open Graph images are page routes
   (`/opengraph-image`, `/blog/<slug>/og`) — keep them out of disallowed
   prefixes, or every shared link unfurls without a card. A named group
   *replaces* the `*` group for that crawler, so a group that says only
   `Allow: /` inherits none of the disallows; `src/app/robots.ts` builds every
   group from one list for that reason.
9. **Published and listed are different questions.** A draft is a 404 and in
   no list. An unlisted published post is live and in the sitemap, the feeds
   and `llms-full.txt` — only not promoted. Never filter the sitemap, a feed or
   `llms-full.txt` on `listed`: nothing errors, no test fails, the URLs just
   stop being advertised and decay out of the index over the following weeks.
10. **A failed database read is a 500, never an empty 200, a 404 or the
    default copy.** An empty sitemap or feed tells a crawler the site shrank,
    and a 404 tells it to drop the URL and every link to it — both outlive a
    ten-minute outage by weeks. The default copy is worse on a renamed site:
    it is the template’s name, tagline and Organization JSON-LD, and a 200
    carrying it gets another product indexed under your domain. A 500 says
    “come back later”, which is true. So posts, the sitemap, the feeds, the
    llms files *and* the editable content never catch a read error (SPEC
    invariant 3); the error page is `noindex`, and monitors watch
    `/api/health` ([deployment.md](deployment.md#health-and-checks)).
    Defaults are for a section nothing was ever saved to. The landing page’s
    latest-posts band hides itself if only its posts read fails — it claims
    nothing, and `/blog` still throws.
11. **Dates are `timestamptz`, shown in UTC.** Formatting a date with the
    server’s local timezone shows the previous day for half the world (and a
    different day than the sitemap’s `lastmod`). `src/lib/format.ts` and
    `src/components/blog/format.ts` pass `timeZone: "UTC"`; do the same.
12. **`lastModified` comes from the data.** Each sitemap entry carries its own
    row’s `updatedAt`; static pages carry none. One build date stamped on every
    URL reads as freshness-gaming, and search engines learn to ignore your
    `lastmod` altogether.
13. **Money is integer minor units** (`amountCents`). `pg` returns `bigint` and
    `numeric` as strings, and `"100" + "250"` is `"100250"`, which looks like a
    plausible price. Parse at the adapter.
14. **One `<main>` per page.** The layouts own the landmark; a page renders
    inside it. A page that adds its own ships two landmarks, invalid HTML and
    two targets for the skip link. Smoke counts them.
15. **No cookies for anonymous visitors, no tracking by default.** Public pages
    set nothing; the only cookies are the session’s, after sign-in. Adding
    analytics or ads changes what your privacy page must say, in the same
    commit — and at small scale the revenue is a rounding error while the
    trust cost lands on every visitor. Smoke fails on a `Set-Cookie` there.
16. **Mark up only what the page shows.** No `Review` or `AggregateRating`
    you didn’t collect, no `Product`/`Offer` for plans you don’t sell, no
    organization `sameAs` you don’t own, no testimonial or logo that isn’t real
    (the sections render nothing while their lists are empty). A fabricated
    record is a manual action waiting to happen, and a lie to the reader first.
