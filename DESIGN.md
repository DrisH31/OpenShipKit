# DESIGN.md — OpenShipKit

Written in layer order: brief → transformation → path → emotion → sensory → test. Every layer-3 decision carries its *because*, and each *because* points at a line above it. The standards (contrast floors, spacing, type setting, motion durations, touch targets) come from the house "Neutral" design system, copied into `src/styles` and `src/components/{ui,marketing,product}`; the IDs that code comments cite (`COL-1`, `LAY-5` …) are defined at the end of this file, in [Standards IDs](#standards-ids). Everything else here is specific to OpenShipKit.

---

## Layer 1 — the brief

### The product's core

**OpenShipKit lets a founder run a complete SaaS (sign-in, billing, an admin, a blog and an MCP server) on a server they control, with no company in the middle that can raise the price, cap the users or switch it off.** Free, MIT licensed, one Next.js 16 codebase.

Product truth (what the code does today, and nothing more):
- **One stack:** Next.js 16 + Postgres (Drizzle) + Better Auth, self-hosted. No hosted auth, database or analytics service.
- **Zero-config demo:** with no `DATABASE_URL` the dev server runs on an embedded Postgres (PGlite) in `.data/pglite`, migrated and seeded at boot, kept across restarts.
- **Optional, off by default:** payments through Polar (on when `POLAR_ACCESS_TOKEN` is set), email through Resend (on with `RESEND_API_KEY`; otherwise emails print to the terminal in development, and in production only To and Subject are logged, so a live site needs Resend before its first sign-up). GitHub/Google sign-in turn on with their keys.
- Access comes only from signature-verified Polar webhooks. Every write goes through a service and is audited; content, posts and plans can be restored.
- An admin, a dashboard, a blog/changelog/legal pages, SEO (server-rendered, JSON-LD, sitemap, RSS, OG images, llms.txt), and an MCP server at `/api/mcp` with scoped keys.
- Deploys as a Docker image or `npm start`: docker compose on a VPS, Dokploy, Coolify, or any Node host with Postgres. The build needs no secrets and no database.

### ONE target user

**A solo developer-founder on a Friday night**, laptop open, a SaaS idea they want live by Sunday. They know React and Next.js and use Claude Code or Cursor every day. They have shipped on hosted auth and hosted databases before, and they remember the month the bill jumped with their user count, or the pricing page that changed under them, or the free tier that was retired. This time they want to own it: their server, their Postgres, their users table. They are deciding, in the first minute on this page, whether this is the starter that finally lets them do that without a week of plumbing.

**Not for:** non-technical founders looking for no-code (they need a hosted builder); teams that *want* a vendor contract and an SLA for their auth; agencies that want a CMS-first site. They get a line in the FAQ, not the design.

### What they want (their words, from the evidence pass)

The evidence pass: the category's own pages and READMEs (paid boilerplates, the official framework starters, self-hosting communities around Dokploy and Coolify), their issue trackers, and the threads where founders compare auth and database pricing. The repeated phrases are below; no figures are claimed from it.

- **Functional:** "auth that runs in my app", "just Postgres", "deploy on my own VPS", "webhooks I don't have to debug", "SEO out of the box".
- **Emotional:** relief at not having another monthly bill tied to user count; calm about the future of the thing they're building.
- **Identity:** "I own my stack." A builder who runs their own infrastructure, not a tenant of five dashboards.
- **Fears:** vendor lock-in; per-seat or per-MAU auth bills; "they changed the pricing again"; a service being acquired or shut down; an abandoned starter; code they can't read; self-hosting being a week of ops; a billing bug that gives the product away.
- **Expectations:** `git clone`, `npm run dev`, everything works with no accounts and no Docker; readable code; one command to deploy; a licence that lets them sell what they build.

### Beliefs, in order

1. **This is for someone like me** — a developer who wants their SaaS on their own server (the hero, in their words, with the real product under it).
2. **Nothing in it can be taken away** — every layer runs where I put it; the outside services are optional (Own every layer).
3. **It's complete and done properly** — the boring parts, specifically (features, the agent).
4. **I can start in minutes, not a week of ops** — one command, no accounts (the steps).
5. **I can run it wherever I already run things** — VPS, Dokploy, Coolify, Node (deploy).
6. **It's honest** — free means free, the plans are samples, nothing invented (pricing, FAQ).

### The insight and the big idea

**The insight:** founders don't fear *building* a SaaS — they fear *renting* one. Every hosted layer is a landlord: it sets the price, the limits and the terms, and it can change all three. The starters they find make the rental decision for them on line one, in the `package.json`.

**The big idea: "no landlord".** Every layer of OpenShipKit runs on the founder's own server, and the only outside services are switches they can leave off. The page shows the *architecture* as the argument: one frame labelled "Your server" with everything inside it, two dashed boxes outside it marked "off". And it lets them pick where the server is.

Angles tried and set aside (tested on a simulated target reader): *"Ship in a weekend"* (true, but every competitor says it — it survives only in the close); *"Let your AI agent run your SaaS"* (striking, but it reads as a gimmick to a sceptic when it leads — it's the second proof, in the hero preview and its own section); *"The five-stack starter"* (the previous direction: choice between vendors is still renting).

---

## The transformation

- **Current state:** a blank `create-next-app` and a week of plumbing ahead, or a starter wired to two or three hosted services whose bills scale with users. Wary of lock-in; tired of re-doing solved problems; slightly afraid that self-hosting means becoming an ops person.
- **Desired state:** by Sunday night the product is live with sign-in, checkout and a blog, on a server they chose, with every user and every row in their own Postgres — circumstance (*live*) → capability (*I can move it, back it up, keep it*) → identity (*I own what I ship*).
- **Gap type:** a capability gap (a missing tool) under a confidence gap (*is self-hosting really this simple?*). The peak is therefore the moment the visitor sees where it will run and how little that takes — the deploy picker.
- **Dominant blocking force:** **anxiety** (lock-in on one side, ops burden on the other) → proof, shown calmly: the architecture, the real commands, the licence, the honest plans. Secondary force: **habit** ("I'll just use the hosted thing I know") → less friction: one command, no accounts, an embedded database.
- **The real competitor:** the hosted-services starter they'd otherwise clone, and their own weekend of plumbing.

---

## Layer 2 — the path

### The landing page (`/`), as answered questions

| # | Section | The visitor's question | What answers it | Force moved |
|---|---|---|---|---|
| 1 | Hero (`hero`) | *Is this about me?* | "Your SaaS, on your server", the three fears named in their words, one action ("Get the code" → GitHub) and "Read the docs", the clone command as one copyable line (showcase), the three fears as checked highlights, and the real admin under it, whose sidebar says what it runs on | pull ↑ |
| 2 | Built on (`logos`) | *Is the foundation sound, and will it run where I run things?* | Two quiet groups: "Built on" (Next.js, React, Postgres, Drizzle, Better Auth, Tailwind CSS) and "Deploys to servers you control" (Docker, Dokploy, Coolify, Caddy, Traefik) — each a monochrome mark beside its name, linking to the project; not "trusted by" | anxiety ↓ |
| 3 | Own every layer (showcase, `#own`) | *Will it lock me in?* | The architecture: four layers inside "Your server", Polar and Resend outside it, dashed and off, each with the env line that turns it on; and what isn't there (no hosted sign-in, no database company, no tracking script) | anxiety ↓ (lock-in) |
| 4 | Features (`features`) | *What do I actually get?* | Six specific parts in a bento, each with a small real moment of the product beside its sentence: the sign-in form and the `auth_user` row it writes, the webhook log, the post editor, `backup.sh` and a migration, the dashboard's and the admin's nav, the files search engines read (showcase; a renamed site gets the plain grid) | pull ↑ |
| 5 | The agent (showcase, `#agents`) | *Is the MCP thing real or a gimmick?* | Scoped keys, the audit log, undo; the session drawn as the agent's transcript (the ask, `content_update` with the before and after, "Undo that", `audit_restore`), the two commands that connect it, and a link to the AI setup guide | anxiety ↓ |
| 6 | Steps (`steps`) | *What does it ask of me?* | Clone and run (embedded Postgres), make it yours, turn on only what you need — the real commands and env lines | habit ↓ |
| 7 | Deploy (showcase, `#deploy`) | *Can I run it where I already run things?* | **The peak.** Pick a VPS, Dokploy, Coolify or plain Node; see what it needs, the exact commands (first deploy and update, from deploy/ and docker-compose.yml), the dashboard's clicks in order, and that host's guide; "the same on every host" beneath | anxiety ↓ (ops) |
| 7b | AI setup (showcase, `#ai-setup`) | *Can my coding agent just do all of that?* | Three steps, a copyable starter prompt that stops before deploying, the MCP servers the guide recommends (GitHub, Dokploy, Cloudflare), and the link to the full prompt pack at /docs/ai-setup | habit ↓ |
| 8 | Stats / testimonials | *Do others use it?* | **Off by default** — nothing invented. They render only when enabled with sourced items | — |
| 9 | Pricing (`pricing` + plans) | *Is it worth it? What does billing look like?* | OpenShipKit is free; these are the sample plans your SaaS starts with, sold through Polar once you add a key | anxiety ↓ |
| 10 | FAQ (`faq`) | *The last fears* | Free? What do I pay for? Why Better Auth? Where can I deploy? Polar/Resend needed? Can a coding agent set it up? — answers in the HTML; on the showcase, the docs and GitHub issues under the heading for what isn't answered | anxiety ↓ |
| 11 | Close (`cta`) | *So what now?* | The one action again ("Get the code", then "Read the docs"), the clone command (showcase), and what they'll have: "Live this weekend, on a server you own" | pull ↑ |

The four showcase sections (and the hero's and close's clone command, the features' product moments, the footer's "A DRISH LABS project" credit, the FAQ's docs pointer) tell OpenShipKit's own story, so they render only while the site is still named OpenShipKit (`isShowcase`); a founder who renames the site gets their own product's sections in that order. Links into /docs (the default header, footer, hero and close) are dropped where the docs aren't published (a renamed site without `OPENSHIPKIT_PUBLIC_DOCS=true`), so a kept default never links to a 404.

**The fastest successful path:** the first value is *the app running on their machine*. From landing: read the hero → copy the clone command under the buttons, or "Get the code" (header or hero) → `git clone` → `npm install && npm run dev`. No account, no Docker, no database to install. One primary action per view ("Get the code"); the second action is an outline ("Read the docs" → /docs, changed 7 Oct 2026 from "See what runs where": the docs are where a developer checks the claims); the close repeats both and the clone command. A visitor who'd rather delegate takes the AI setup section's starter prompt.

**Proof beside the fear:** "MIT licensed. `npm run dev` starts it on an embedded Postgres, with no accounts to create" sits under the hero buttons; the env line beside each optional service; "Access comes only from signature-verified webhooks" in the billing feature; "every change is logged and can be undone" next to the agent; "moving later is a database dump and a restore" above the deploy picker.

**The ask after value:** pricing comes after the architecture, the product, the commands and the hosts.

**End on progress:** the close says what they'll have and offers the one action.

### Other pages

- **`/pricing`** — *Which plan, and what's in each?* Plans with a monthly/yearly switch (no JavaScript; one card per plan, so each plan is one heading — h2 here, h3 under the landing page's section), every plan's CTA (free → sign up, sales → contact, paid → `CheckoutButton`), a signed-in viewer's own plan marked "Your plan" with `PortalButton` (subscription) or "You own this plan" (purchase) — computed from the webhook-written rows; `?error=<code>` from checkout shows `billingErrorMessage` as an alert. **While payments are off**, a paid plan's button is a disabled outline "Not on sale yet" tied to a note that says why, and the one solid button moves to the free plan — nothing looks buyable that isn't (the landing page's plans do the same). The cards share rows (CSS subgrid), so every plan's button and feature list start on one line; the highlighted plan is raised with a ring (and the raised surface in dark), never the accent. A comparison table derived from the plans' own features: "Everything in <Plan>" expands, and lines that differ only in amount ("1 project" / "Unlimited projects") share one row of amounts, so no higher plan shows a dash for something a lower plan counts. On a phone the feature column narrows (8 rem) and each plan keeps 7 rem, so two plans show beside the labels with a soft right edge (`.scroll-shade`) while there are more; a free plan's price line says `$0`, not its name again. A pricing FAQ generated from the plans (no FAQPage markup on the showcase, where the plans are samples); the close.
- **`/contact`** — *Can I reach a person, and will it arrive?* One short form (name, email, topic, message) that posts without JavaScript (303 back with `?sent=1` / `?error=`), enhanced with fetch; what happens next (saved in this site's own database, answered by a person by email); a mailto fallback when an address is configured. `?topic=sales` preselects the topic.
- **`/docs`** (showcase, or `OPENSHIPKIT_PUBLIC_DOCS=true`) — *How do I do this, exactly?* The repository's own `docs/*.md`, rendered on the server so the site and GitHub say the same words: a sidebar in nav.json's order (Start · Build · Ship), "On this page", prev/next, "Edit this page on GitHub". The index answers *where do I start?*: Getting started and the AI setup prompt pack first. Every code block is highlighted and has Copy; a prompt is a `text` block that wraps. No motion (a high-intent page). The header's "Get the code" is the one solid button in view.
- **`/blog`** — *Is there anything here worth my time?* The H1 says what is here ("Guides and notes", the name "Blog" in the eyebrow and the `<title>`), then the newest posts with their dates, tags and reading time.
- **404 / error / global error** — *Where was I going?* The way back (home, pricing, blog, changelog, contact) in the site's own frame; the error pages offer "Try again" and a reference digest, never the message.

---

## The admin overview (8 Oct 2026)

The admin's home is read many times a day by the one person running the site (the target user, now as operator). Their first question is *is my site OK, and does anything need me?*, and they fear missing someone waiting on them or a site that silently broke. So, top-down (UI-5):

1. **The answer, in words, as the heaviest block** (`PageHeader emphasis`: lead size, semibold, full ink): "The site is up and nothing needs you" / "…and one thing needs you" / "The database isn't answering…". Under it, once for the whole screen, the provenance and freshness (UI-11): the database's health and response time, the site's address, "Checked <time> UTC". *Because* the old answer ("Everything is answering. Here's what the site runs on…") described the page instead of answering, and the health strip spent a full-width card on a green tick.
2. **Needs you**, ranked by consequence (someone waiting on feedback before unpublished drafts), the action on each row ("Triage", "Review"), finishable — it says "Nothing needs you right now" when empty (UI-10). Beside it, while any setup step is still to do, **Make it yours**: the progress, the next step and its action, a link to all steps on /dashboard. The steps are one module (`src/server/setup-steps.tsx`), so both places read the same facts. *Because* attention was a side card under the KPIs and, on a phone, below ten log rows.
3. **Key numbers**, each opening its list; Users and Subscribers carry a 30-day sparkline of the running total and "+N in the last 7 days" (absolute, not a percentage: two accounts growing to three isn't "50 %"), from `DataStore.growth()`; the basis is stated once ("Trends: the last 30 days, by UTC day"). *Because* the landing page's preview showed a trend the real overview didn't have.
4. **The detail**: the last six changes as `RecentChanges` — grouped under Today / Yesterday / a date, an avatar for who acted (person, agent, system), the time right-aligned, no rules between rows, the starter content's rows folded into its one "Added the starter content" line — beside **Running on**. *Because* the old list (ten tall ruled rows, a bold verb and a gear on each, half of them the seed's) was the heaviest thing on the screen while being the least urgent, and it made the right column look empty. The audit log keeps the full, ruled `ChangeList`.

The demo-mode and read-only-demo notes are **one strip** when both apply (read-only first, info tone), never two stacked bands above the answer.

## The bridge — one named emotion

> **A solo founder should feel _in control_ when they pick where their SaaS will run and see that it takes three commands, because their job is to build a product that is theirs — no one else's price list, limits or roadmap.**

- **Norman level:** **behavioural** — the feel of operating it: the deploy picker, the price switch, the press of every control, all instant and all working without JavaScript. The visceral first second supports it (calm, exact, no noise); the reflective layer (pride in owning the stack) is earned by the architecture section, not asserted.
- **The arc:** *wary, renting* → *in control*: acknowledged by the hero's words, evidenced by the architecture and the commands, earned at the deploy picker.
- **Signature moment (changed 7 Oct 2026, at the owner's direction): "Watch an agent edit" in the hero preview.** One press plays it once: an MCP tool-call card (`content_update · hero.title`, from the `claude-code` key), the mini-site's headline changes, a new entry arrives at the top of the audit log with its Undo highlighted, and the visitor presses Undo and gets the original back. *Because* "in control" is felt most sharply at the moment something changes your site without you and you put it back in one click: it answers the sceptic's question from the agent section ("is the MCP thing real, and is it safe?") with the product's own audit log, in the first screen, and it is a behavioural moment, the Norman level this page is built on. It sits where the product is, not at the peak, and it never plays on its own. **The deploy picker stays the peak** of the path (layer 2) and keeps the accent as its selected state; it is no longer called the signature, because a page has one.
- **Competitor feel-inventory:** paid boilerplates own *hustle* (countdowns, revenue screenshots); feature-wall starters own *complete*; vendor-made starters own *official* and *effortless* ("we'll host it"); most open-source starters own *DIY* (a README, no page). *In control* — calm, exact, nothing rented — is adjacent and unclaimed.
- **Adjective → motion:** *in control* = immediate response (press in 90 ms, switch with no wait), decelerating arrivals (quint-out), short distances, no bounce on anything with text, nothing that makes the visitor wait to read, nothing that moves on its own after the first second.

---

## Layer 3 — sensory decisions, each with its because

### Layout and hierarchy

- **One H1 per page; rank 1 is the claim** (`data-rank="1"`), rank 2 the primary action (`data-rank="2"`: the hero button, the highlighted plan's button on /pricing, "Send message" on /contact). *Because* belief 1 is decided in seconds.
- **Hero: centred — eyebrow, a two-line claim broken after its comma ("Your SaaS, / on your server"), the lead, the two buttons and the proof note on one axis, the product full-width beneath** (changed 7 Oct 2026 from left-aligned, at the owner's direction). *Because* at this point the page has one message and one action: on a single centre line the eye runs straight down claim → action → product, the convention the target user knows from the SaaS sites they compare against, and the product preview below reads as the answer to the claim above it. The lead and the note are `text-pretty`/`text-balance` so no line ends on an orphan. Buttons stay auto-width even on a phone: a full-width solid bar outweighed the claim in the squint test.
- **Hero refinement (7 Oct 2026, at the owner's direction):** the eyebrow is a quiet pill (`bg-card`, `line-strong` edge) with the mark's gradient as a dot, the one touch of brand colour above the claim; the claim's first half ("Your SaaS,") is set in `ink-3`, so the eye lands on the promise ("on your server"); the lead is cut to what it is and what it runs on (two lines), and the three fears moved into `hero.highlights`, a row of up to three short points with neutral checks (not green: status colour means a state, and these are claims). The sentence under the clone command ("MIT licensed. `npm run dev` starts it…") was removed, leaving air before the product; "MIT licensed" still sits in the footer's line. *Because* the old lead did three jobs in forty words and the fears, the reader's real questions, were buried at its end. Rejected: **floating labels around the claim** ("MIT licensed", "Embedded Postgres", tilted cards drifting in once) — built and removed the same day at the owner's call: they competed with the claim for the first look.
- **The hero preview is the admin, working (7 Oct 2026):** five of the admin's screens behind its real sidebar — Overview (the first frame), Content (the hero editor), Posts, Agent keys, Audit log — the other admin places drawn in the sidebar in `ink-3`, not focusable, so the nav still reads complete. Below 768 px the sidebar becomes a row of the five screens above the screen, scrolling sideways with the soft edge (`.scroll-shade`); 44 px targets on a coarse pointer. The Content screen puts the Title field and the agent's card left and a **mini-site of the landing hero** right; on a phone the order is field → mini-site → agent, so the picture you change sits under the field you type in. The screens share one grid cell, so the frame is as tall as the tallest screen at every width and never jumps when a tab changes or the agent's edit lands (measured at 390, 768, 1024 and 1440 px). *Because* the brief's fear is "code I can't read, a service I can't control": a working slice of the product — type a title and see your site change, undo an agent — proves it faster than a picture, and the "edit your whole site from the admin" moment is the product truth a hosted CMS can't show on its own server.
- **One gap between sections on the same tone:** two page-tone sections in a row share one `--space-section` (the second drops its top padding, `base.css`); a band or the inverse close keeps its own padding, because its edge marks the change. *Because* a doubled gap on one tone reads as a missing section.
- **Code panels never wrap a command:** a long line scrolls inside the panel (focusable and named, with a soft right edge while there is more), and the caption bar has Copy for the commands. *Because* a command broken mid-token reads as two commands, and the clone command is the page's main action. A long command is written over lines with a trailing ` \` (as the guides do), one prompt, copied as written.
- **Code panels are terminals (changed 7 Oct 2026):** window chrome (three dots, a mono title with a terminal or file icon), commands after a muted `$` that can't be selected or copied, output in `ink-2`, `# notes` as comments, a little air before a command that follows output; **syntax colour** from Shiki on the server (`highlightTokens`: bash for commands, ini for env files, json/sql/md in the feature moments), rendered as spans carrying `--shiki-light`/`--shiki-dark` and picked by scheme in `base.css` (`.code-tokens`) — no highlighter ships. **Copy everywhere:** the title bar's Copy takes every command (no prompts, no output; a trailing `…` placeholder is left off after its `=`), and with two or more commands each has its own icon button in a gutter that doesn't scroll with the code; on a touch screen the gutter is left out (28 px rows can't hold 44 px targets) and the title bar's Copy covers the block. *Because* the target user copies these commands into a real terminal: colour lets them read a command's parts at a glance (the user asked for colour), and copying exactly the command, nothing else, is the fastest successful path. The panel sits on `--card` in both schemes, so the colours are measured against one known background. Since 7 Oct 2026 `highlightTokens` itself raises every token to 4.5:1 on `--card` (`readableOn`, `src/shared/code-contrast.ts`), so the docs' Markdown code (on `--surface`, the same two values) has the same guarantee as the landing page's panels, from one place.
- **The features are a bento of product moments (showcase; changed 7 Oct 2026 from a hairline grid):** six cards on a 6-column grid, spans 4·2 / 2·4 / 3·3, so the eye zigzags; each card's words above, a small real moment of the product beneath in a well (`bg` inside the card), the wells' feet on the row's foot. The moments are decorative to assistive tech (the sentence says the same) and nothing in them takes focus. In the sign-in card the Postgres window sits lower than the form, under a small "↳ The row it writes" caption, so the stagger reads as cause and effect rather than a gap. *Because* DESIGN.md's own critique scored features the most generic section ("the feature grid could be any starter's"); showing the `auth_user` row, the webhook log and `backup.sh` is specific to this product, and the order puts the widest moments (sign-in, data) in the wide cells. A renamed site keeps the plain grid: its features have no pictures here.
- **The agent's session is drawn as a transcript, not a terminal:** your messages as right-aligned bubbles, each tool call as a small card (the tool's real name, its target, the before/after as − / + rows, a check and what happened), then the connect commands as a real copyable panel beneath. *Because* the sceptic's question is "what does the agent actually do?", and a diff with an undo answers it faster than log lines.
- **The AI setup section is words left, prompt right:** the three steps and the link on the left, the starter prompt in a window with Copy (prose that wraps, unlike a command) and the three MCP servers beneath on the right. *Because* it sits right after the peak for the visitor who'd rather delegate the commands they just saw; it links to the prompt pack in the docs instead of repeating it, so the two can't drift.
- **Section rhythm varies:** hero → quiet name strip → the architecture in a band (`tone="band"`) → feature grid → the agent (heading over facts and a transcript) → numbered steps with code → the deploy picker in a band → pricing cards → FAQ → the close in the inverse band. *Because* "a pattern left unchanged everywhere reads as a template" (craft-page §7). Two bands and one inverse band keep the page from being six grey sections in a row.
- **The architecture is drawn, not illustrated:** a solid frame in the page tone ("Your server") holding four tiles on cards, and a dashed frame ("Optional, off by default") holding two. *Because* the big idea is a boundary — inside vs outside — and a border is the most literal, cheapest way to draw one. Plain lists and headings underneath, so it reads as text to assistive tech and search.
- **The header's action is rank 2 on every page** (`data-rank="2"`, 7 Oct 2026). *Because* it is the site's one action: beside the hero's it repeats it, and on a docs page it is the only solid button, where the review script found it the darkest unranked thing on screen. Quietening it there would hide the action a docs reader came to check.
- **A list page's H1 says what is there, at the H1 step** (`/blog`: "Guides and notes", 7 Oct 2026; tag pages keep "Posts tagged …"). *Because* a one-word label at the section-head size ("Blog", 52 px) weighed less than the first post's two-line heading on a phone (the squint test), and `--text-display` is every page's one H1 (/pricing already used it). Past page 1 the date range is a quieter second line in `ink-3`, not more display type.
- **Inline code sits on the type scale:** in a docs table cell at the caption step (12 px), in a docs lead at the body step (16 px), not `0.875em` of its parent (which gave 12.25, 15.83 and 17.5 px). *Because* TYP-1: the review counted them as off-scale sizes.
- **One header action, with the GitHub mark when it links to GitHub** (changed 7 Oct 2026, at the owner's direction): "Get the code" carries the GitHub mark; no separate GitHub icon button. *Because* both went to the same place: two controls for one destination split the click and add noise to the chrome. Any header action pointing at github.com gets the mark.
- **One GitHub action, one look** (7 Oct 2026): the hero's and the close's primary carry the same GitHub mark before the label when they link to github.com (18 px on the large button, 16 px in the header), and drop the trailing arrow; a primary pointing anywhere else (a fork's `/sign-up`) keeps its arrow. `isGitHubUrl` lives once, in `src/lib/github.ts`, imported by the header, the hero and the close. *Because* the same action looked like three different buttons; the mark says "this is the code, on GitHub" before the word is read, and an arrow beside it would be a second icon saying less.
- **Navigation is neutral chrome, in three columns wider than the content (88rem against 72rem):** the mark pinned to the far left, the links centred on the page, the scheme switch, Sign in and the action pinned to the far right; the outer columns are equal (`1fr`), so the links stay centred whatever the logo's or the actions' width. *Because* the chrome frames the page rather than competing with it: the brand and the action sit at the edges where the eye looks for them, and the centred links line up with the centred hero below. Page tone, a hairline only once content scrolls under it, links in `ink-2` with the current page on a tonal pill. Inline links from 1024 px (five links, the GitHub button, the scheme switch and two actions need ~960 px), the menu below that. On the showcase a GitHub icon button (ghost, from 640 px) sits before the scheme switch — the repository is the product here; no live star count (a fetch would put a third party in every view). Sticky from 768 px, scrolling away on phones (PAGE-5). The menu is a native `<details>`: it opens and every link works with JavaScript off; Escape closes it and returns focus; from 640 px it doesn't repeat the header's two actions.

### Colour (60-30-10)

- **60 — the page:** the house Neutral grey (`--bg` #E6E6E6 light, #111111 dark). **30 — content surfaces:** white cards and bands (`--surface` #FFFFFF, 1.25:1 from the page; #181818 with hairlines in dark, COL-4). **10 — the accent, "ignition" vermilion:** the primary button, the focus ring, the selected deploy target and pricing interval, the mark's dot. Never a heading, a band, an icon set or the navigation.
- **Because:** the target user is wary and precise, so the 30 is a quiet secondary surface and the brand shows through the mark and the action. Developer tools are almost all black-and-white or purple/indigo; a warm signal reads as *go*, and as something held rather than rented. Vermilion rather than pure orange so it doesn't read as a warning.
- **Status colour carries meaning only:** the green check in the hero preview's "Database healthy" line, as on the real overview; the − / + lines of the agent's call on the danger and positive tints.
- **The accent in the preview marks only the action to take (7 Oct 2026):** the play glyph of "Watch an agent edit" (accent as text, `text-action-text`), the Save button, and the one Undo the agent's edit asks for (solid). The overview's "New post" fill is gone from the preview: the critique counted three accent fills in the first desktop screen, and in a working preview a button that does nothing would be a lie. A restore's own Undo stays an outline, so the page never urges you to undo an undo.
- **The theme contract** (`src/styles/brand.css`): only `--accent`, `--accent-ink`, `--accent-hover`, `--focus`, `--accent-text` and the mark's gradient, in both schemes. Measured below.

### Type

- **Anchor: Space Grotesk 700** (display, H1–H2, figures, the wordmark, the open-source names) — squared, engineered letterforms read as *built, not published*; **support: Inter** (text, labels, controls, card titles); **Geist Mono** for code, env lines and the "where it runs" captions in the architecture tiles. Loaded by the root layout; no new face.
- Specimened and rejected: **Geist Sans display** (correct, but it is one platform's house voice); **a serif display** (editorial warmth the target user doesn't ask for; it softens the *exact* half of the feel).
- The system's scale: one H1 (`text-display`), section heads `text-h2`, step titles `text-h3`, card and tile titles Inter 600 `text-body`. Landing page: seven sizes at 1440 px (88/52/28/20/16/14/12), all on the scale. Ink levels carry the reading order: claim in `ink`, lead in `ink-2`, meta in `ink-3`.

- **The footer, in the header's 88rem frame (7 Oct 2026):** the mark sits under the header's mark and the link columns reach the right edge the header's action does, so one frame brackets the page. *Because* a footer narrower than the header made the page look unfinished at both ends. The brand block is two groups — **who** (mark, one line, and on the showcase a "Star on GitHub" outline button with the GitHub mark; no live star count, which would put a third party in every page view) and **what you can do** (the signup as one card: a title, one line on what you'll get, ONE joined control with the field and a tonal Subscribe in a single pill, then the status line). *Because* four loosely stacked items with equal gaps read as a list of unrelated things; a joined field reads as one action, and a tonal button doesn't compete with the closing band's accent just above. The bottom row: copyright and licence on the left; on the showcase the maker's credit on the right, "A project by" and the **DRISH LABS signature** — the wordmark-in-a-pill from the top-left of drishlabs.com, embedded as SVG outlines of Caveat Brush (SIL OFL) so no font loads for it (`src/components/site/drish-labs-signature.tsx`). Social profiles show as marks with the network's name as the accessible name; the showcase doesn't repeat its repository there. The page ends on the product's name set edge to edge in faint ink, sized to the frame by its length (container query units), cut by the page's bottom; decorative (`aria-hidden`).
- **Sign-in, sign-up and reset (7 Oct 2026):** the auth header uses the same 88rem frame, so the mark doesn't jump between the site and sign-in. On the showcase a short note is spoken by the OpenShipKit mark as a **speech bubble** — beside the card from 1280 px (where there is room on the right; the card stays centred), above it on narrower screens — saying this is the template's real sign-in running as OpenShipKit's own demo, and that a clone gets the same flow fully working. *Because* visitors should know what they're signing in to before they type, without the note pushing the form down.

### Imagery

- **The hero's product sits on a faint warm glow** in the mark's gradient colour (16 % of `--brand-mark-to`, blurred, behind the frame; static). *Because* the frame read as pasted onto the grey page; the glow is the only decoration on the page and it is the brand's "ignition", at the product.
- **The real product, rendered and working, not photographed (7 Oct 2026):** the hero shows the admin inside a browser frame (`BrowserChrome`, its address bar showing this site's own host, "Watch an agent edit" at its right). Every screen is rendered on the server from the product's own sources — `ADMIN_NAV`/`groupNav`/`NAV_ICONS`, the overview's KPI labels and "Running on" pairs, `CONTENT_KEYS.hero`'s label and description, `POST_STATUS` through `StatusBadge`, the mint form's scope words, sentences from `describeAudit`/`actorWords` — with the product components (`KPI`, `Sparkline`, `Delta`, `DetailList`, `Table`, `StatusBadge`, `Badge`, `Button`, `Input`). Every screen says *Sample data*, and the samples agree across screens: 1,284 users everywhere; the `cursor` key "used 12 min ago" is the agent that published "Launch week, day 1" 12 min ago (undo that and the post is a Draft with no published date on Posts); `claude-code` was minted 3 h ago and is "never used" until its edit, then "used just now"; the restore is a new entry by you, as `/admin/audit/<id>` writes it. Undo sits on the entries that can be put back (content and posts here; feedback and keys are logged but not restorable, as in the product). The agent's new title is the agent section's ("Ship it this weekend"), so the two stories are one. When `hero.image` is set, that screenshot replaces it, static as before, in a 16:10 box reserved before it loads (no layout shift on the LCP element).
- **The preview's frame is lit, not pasted (7 Oct 2026):** a deeper shadow than a plain mockup (a hairline ring, a contact shadow and a long soft one, `--elev-hero` per scheme) and a 1 px top highlight on the toolbar (`--chrome-highlight`), on the existing warm glow. *Because* the frame is the page's one piece of product, and on #111 a shadow alone vanishes: in dark the highlight carries the edge, in light the ring does. No annotation chips outside it (rejected below).
- **More than one product moment down the page:** the architecture, the agent's transcript, the steps' commands and env lines, the deploy targets' commands.
- **No photographs, no illustrations, no stock faces, no logos we don't have the right to.** The "built on" strip shows each open-source tool's monochrome mark beside its name (changed 7 Oct 2026 from names alone): marks from Simple Icons (CC0), in `ink-2` like the names, darkening on hover, used only to say what the template is built on — nominative, not an endorsement. A name with no known mark shows as type alone (`src/components/sections/tool-marks.ts`). Dokploy, which isn't in Simple Icons, uses its own logo from its repository, cropped square (7 Oct 2026). *Because* a mark is recognised faster than a word when scanning, and the strip answers "is the foundation sound?" at a glance. One centred row per group on wide screens; two even columns on a phone. **Two groups (7 Oct 2026):** "Built on" and "Deploys to servers you control" (Docker, Dokploy, Coolify, Caddy, Traefik — the open-source hosting the deploy guides cover), each label in `ink-3` above its row; the section title stays the heading for screen readers. *Because* the second fear after lock-in is "will it run where I run things?", and the hosts' marks answer it before the deploy section does. **Dokploy shows as its name alone:** it isn't in Simple Icons, and its repository is Apache-2.0, whose §6 grants no trademark rights. The deploy picker's pills carry the same marks (Docker, Coolify, Node.js); the AI setup section shows GitHub's and Cloudflare's.

### The mark

An **open ring with a dot leaving through its opening** — *open* (source, and nothing closed around you) and *launch* (the payload leaving orbit). Two shapes; the ring in ink, the dot in the amber → vermilion mark gradient; it reads at 16 px. The wordmark is "OpenShipKit" in Space Grotesk 700 beside it. (`src/components/site/logo.tsx`; the favicon/OG owner reuses `MARK_GEOMETRY`.)

### Words

- Their words, specific over general: "on your server", "no per-seat auth bill", "no price change you didn't choose", "off until you add a key", "a database dump and a restore". No "revolutionary", no "supercharge", no numbers we can't source. Curly quotes and apostrophes.
- No company is named except the open-source tools it is built on or deploys with, the two optional services the code supports (Polar, Resend), and — in the AI setup section only, at the owner's request (7 Oct 2026) — the MCP servers the AI setup guide recommends (GitHub, Dokploy, Cloudflare) and the agents it names (Claude Code, Cursor). The fears are named generically ("a hosted sign-in service", "a database company").
- **The template's repository is linked only where it is gated:** the footer's social row (`isShowcase`) and the default "Get the code" (whose header button carries the GitHub mark). The footer's Resources column has no GitHub link (removed 7 Oct 2026): it was default content, so a renamed site keeping its links would have kept it, and it repeated the social row's link.
- **The maker is credited on the showcase only:** "A DRISH LABS project" in the footer's last line, linking drishlabs.com; a renamed site shows "Built with OpenShipKit" instead and never the maker.
- Every heading says something on its own ("Every layer runs on a server you control", "Move hosts without asking anyone"), not "Architecture" or "Deployment".

### Motion plan (within the budget: INP ≤ 200 ms, CLS ≤ 0.1, LCP never gated)

| Item | What | Spec | Reduced motion |
|---|---|---|---|
| Hero arrives | eyebrow → H1 → lead → actions → preview | `.arrive`: from 85 % opacity, 8 px, 720 ms quint-out, 70 ms stagger — readable from frame one | static |
| Preview screens | the open screen fades in and settles 4 px; the one leaving fades faster, then turns hidden; all five share one grid cell | `.hp-screen`: opacity + translate, 240 ms in / 160 ms out, quart-out (MOT-2, MOT-3, MOT-4); visibility flips after the exit | instant swap (MOT-8) |
| Agent edit (signature) | on a press only: the Content screen opens, the call card appears (`content_update · hero.title`, − / +), ~1.1 s later the mini-site headline changes, the new entry lands at the top of the log with its Undo solid | the card `.swap-in` (240 ms); the headline `.hp-pulse` (480 ms quint-out, from 35 % opacity and 5 px — only on save, agent or undo, never per keystroke, MOT-5); the row `.hp-arrived` (settles 6 px in 420 ms under a tonal wash that stays while it is newest). Plays once per press, never on load, never loops (WCAG 2.2.2, PAGE-4); can be watched again only after it is undone | same states, no movement: the wash is a state, so it shows; the spinner stops |
| Undo / Save | the pressed button answers in place: "Undo" → "Restored" with a check (same width, both labels in one cell), Save → "Saved"; the restore arrives as a new top entry | `.pop-in` on the check; Button press 90 ms; one polite `role="status"` line says what changed ("Restored. The title is “…” again.") | colour only |
| Deploy picker (the peak) | the selected pill fills with the accent; the panel swaps | native radios + CSS `:has()`; the panel settles 6 px in 240 ms quart-out (`.swap-in`, `@starting-style`) | instant swap |
| Price switch | monthly ↔ yearly prices swap | same mechanism, no JavaScript | instant |
| Everything pressable | press 90 ms `scale(0.98)`, hover 160 ms, icons dip on press | from the system (`Button`, `motion.css`) | colour only |
| Devices in view | the agent transcript, the AI setup prompt and the step panels rise in on entering view | `.reveal` (scroll-driven CSS; Firefox and reduced motion just show them) | shown |
| Copy | the icon turns into a check (pops in), "Copied" announced | `useFlash`, 1.8 s; the gutter buttons press at `scale(0.94)` in 90 ms | colour only |
| FAQ | native `<details>`, grid-rows height, icon turns 45° | 240 ms | instant |
| Scheme switch | the new scheme opens as a circle from the button | View Transition, 420 ms | instant |

Nothing on the page is server-rendered at `opacity: 0` except the preview's four hidden tab panels (`visibility: hidden` as well — a tab panel that isn't selected, not content held back); the overview, the first frame, is fully there. No headline, lead or body copy is behind a reveal. The architecture section has no motion: it is the argument, and it should be still.

**The hero preview, how it is built and what was rejected (7 Oct 2026).** The tabs follow the WAI-ARIA tabs pattern (`role="tablist"`, roving `tabindex`, arrows in both axes because the list is a column from 768 px and a row below, Home/End; each `role="tabpanel"` labelled by its tab; hidden panels `inert`), inside a region named "Interactive preview of the <site> admin, with sample data" — no longer one `role="img"`. Every control works by keyboard with the system's focus ring; "See it in the audit log" moves focus to the highlighted Undo; a used Undo stays in place as "Restored" (`aria-disabled`), so focus never falls to the page; one polite status line says what each press changed. The screens are Server Components; what changes is one client module (`hero-preview/demo.tsx`, about 6.7 KB gzipped with its reducer, `Table` and `relativeTime`; ~2 KB more for icons the page didn't already load; `Button`, `Input` and Base UI were already on the page through the newsletter form). No motion library: CSS transitions and keyframes only (MOT-10). With JavaScript off, the overview is still the whole first frame; the tabs don't switch.
Rejected: **autoplaying the agent's edit on load or on scroll** (WCAG 2.2.2, and it would move on its own after the first second, against the named emotion); **switching tabs with radio inputs and `:has()`** like the deploy picker (works without JavaScript, but the screens that matter — typing, Undo — need it anyway, and radios would announce a form, not screens); **re-rendering the screens on the client** (it would ship `KPI`, `DetailList` and the audit words — zod with them — for no gain); **annotation chips outside the frame** ("Every change is logged", "Undo in one click", "Your own Postgres"): at 1280 px the frame leaves under 100 px of margin, so the chips would sit on the frame's edge, and they point at the overview's layout, so on the other four screens they'd point at nothing; the screens' own words say the same; **a functional "Mint key"** (it would have to show a key once, and anything shaped like a key on a public page is a bad idea): the scope picker is real, and the button says honestly that the preview makes no keys. The feature moments and the hero's glow don't move either (7 Oct 2026: no new motion was added with them).

---

## Check results (6 Oct 2026; reviewer pass 7 Oct 2026; hero preview 7 Oct 2026)

**7 Oct 2026, the interactive hero preview (and one GitHub look):** `npx tsc --noEmit` clean; `npx eslint` on every changed file clean; `npx vitest run` 705 passed, 9 skipped (sections.test.ts: the preview's server HTML — the overview's words, figures and change sentences in the first byte, one selected tab, five tabs and panels, no `role="img"`, the agent's edit absent until pressed — and the reducer: tabs, typing and Save, the agent playing once and only on demand, Undo restoring the title and the post as new entries, nothing else restorable, the log bounded). `review.py http://localhost:3000 / --css src/styles/tokens.css`: squint pass at desktop and phone (rank 1 the claim, the darkest spot ranked; "Watch an agent edit" the strongest unranked element, mass 61 against the H1's 4562); type 7 sizes, all on the scale (88/52/28/20/16/14/12 at 1440); contrast 61 pairs per scheme, all pass. `scripts/smoke.mts` with the dev MCP key: 55/55. Driven in headless Chromium over the DevTools protocol (clicks, keys, typed text) at 390, 768, 1024 and 1440 px in light and dark, and with reduced motion: no horizontal scroll at 390; the frame's height identical on every screen and through the agent's run (671 px at 1440, 918 at 390); keyboard tabs (↓, End, Home, ← wraps); typing updates the mini-site, Save logs it; "See it in the audit log" focuses the solid Undo, which restores the title and announces it; undoing the post's publish shows Draft and "—" on Posts; reduced motion: transitions at 0.01 ms, no settle animation, the fresh-row wash still shown; no console errors. Screens reviewed: every tab and every step of the agent run at 1440 and 390, light and dark; the first screen at 1440×900 and 390×844 in both schemes; the full page at 1440 (light) and 390 (dark). Fixed in the loop: the phone toolbar's address overlapped the control (the address and dots now give way below 640 px); a restore's own Undo was solid (now outline); the mini-site shrank when a one-line title replaced a two-line one (two lines reserved); the posts table squeezed its titles on a phone (badges stack, paths and one row hidden there); the frame grew by 3–33 px when the agent's card finished at 390 and 768 (the card reserves its finished height); the overview's "·" dangled on a phone. Not re-run: the house balance check (not in this repository) and a fresh target-user review.

**7 Oct 2026 reviewer pass (the whole site after the landing, docs and terminal work):** `python3 ~/.claude/skills/web-design/scripts/review.py http://localhost:3000 / /docs /docs/getting-started /docs/ai-setup /pricing /blog /blog/<post> --css src/styles/tokens.css` (`--css globals.css` reads no tokens: they are in the files it imports):

| Route | Width | Squint | Type audit |
|---|---|---|---|
| / | desktop | pass | 7 sizes, all on the scale |
| /docs | desktop | pass | pass (6) |
| /docs/getting-started | desktop | pass | pass (6) |
| /docs/ai-setup | desktop | pass | pass (6) |
| /pricing | desktop | pass | pass (6) |
| /blog | desktop | pass | pass (6) |
| /blog/<post> | desktop | pass | pass (6) |
| / | phone | pass | 7 sizes, all on the scale |
| /docs, /docs/getting-started, /docs/ai-setup | phone | pass | pass (6) |
| /pricing | phone | pass | pass (6) |
| /blog, /blog/tag/mcp, /blog/<post> | phone | pass | pass (6) |

Contrast: 61 pairs in light and 61 in dark, all pass. Fixed in this loop: the docs' darkest spot was the unranked header action (now rank 2, above); /docs/ai-setup had three off-scale sizes from inline code (now on the scale, above); /blog's H1 lost the squint test on a phone and was unranked (now "Guides and notes" at the H1 step, ranked); a post's H1 was unranked. Screenshots: the first screen of /, /docs, /docs/getting-started, /docs/ai-setup, /pricing, /blog and a post at 1440 and 390 in light and dark (shot.sh), full pages of / at both widths and schemes (shot.mjs), and viewport captures of the bento, the close, the docs' prompts and code blocks. Links: every docs slug in nav.json and every internal link on /, the docs, /pricing, /blog, a post, /contact and /changelog answer 200 (49 paths); external links checked once with `curl -I`: all answer except the repository itself (not public yet, see Open decisions) and npmjs.com, which refuses scripted requests (403). Every repository path the docs link exists in the tree.

**Copy buttons, checked by reading every `value` in the landing page's server payload:** each panel's Copy takes its commands with no `$` and no output; `export OPENSHIPKIT_MCP_KEY=osk_…` copies as `export OPENSHIPKIT_MCP_KEY=` (the paste waits for the key); the env panel copies the three names with `=` and no `…`; multi-line commands copy as written with their ` \`; the docs' blocks copy their own text, and no docs block has a `$ ` prompt in it. The landing's starter prompt told the agent to rename the site in `src/content/defaults.ts`, which the prompt pack forbids ("stored content overrides it"), and ran `npm run setup` after the dev server: now it follows docs/ai-setup.md (setup first; step 2 of the pack renames the site through its MCP server), and `sections.test.ts` checks both.

**7 Oct 2026 pass (every landing section, the terminals, the bento, AI setup):** no horizontal scroll at 360, 390, 768, 1024 and 1440 px (measured in headless Chromium); every new section's copy, the starter prompt, the deploy commands and the transcript are in the server HTML; nothing at `opacity: 0`. Screenshots reviewed at 1440 and 390 in light and dark. Code colours: every token raised to 4.5:1 on `--card` by `readableOn` (sections.test.ts checks the backgrounds against tokens.css). Fixed in the loop: the bento's phone column sized to its code lines (now `grid-cols-1`, `min-w-0`); the close's clone command widened its column past the screen (its intrinsic width is now capped). The house balance check wasn't re-run (it isn't in this repository). The reviewer pass above ran the squint, type and contrast checks and the target-user review; its scores are in the critique below.

### Contrast — the brand tokens folded over the system's tokens

```bash
npx vitest run src/styles/contrast.test.ts   # also part of `npm test` / `npm run check`
```

`src/styles/contrast.test.ts` reads `tokens.css` with `brand.css` on top (as `globals.css` imports them) and computes WCAG 2 ratios in both schemes: every text role (`ink`, `ink-2`, `ink-3`, the four status inks, `accent-text`) at 4.5:1 and every control role (`field`, `focus`, `ink-faint`, `accent`) at 3:1 on `bg`, `surface`, `card` and `raised`, plus the label-on-fill pairs (`accent-ink` on `accent` and `accent-hover`, each badge ink on its tint). Anyone can re-run it; nothing outside the repository is needed. `accent-text` is the accent *as text on surfaces*; the label on the accent is `accent-ink` — the two are never paired.

| Pair | Light | Dark | Floor |
|---|---|---|---|
| `accent-ink` on `accent` (button label) | #FFFFFF on #C2410C **5.18** | #111111 on #FF7A3D **7.29** | 4.5 |
| `accent-ink` on `accent-hover` | on #A8360A **6.57** | on #FF9361 **8.63** | 4.5 |
| `accent` / `focus` on `bg` (control, ring) | #C2410C on #E6E6E6 **4.15** | #FF7A3D on #111111 **7.29** | 3 |
| `accent` / `focus` on `surface`/`card` | on #FFFFFF **5.18** | on #181818 **6.85** | 3 |
| `accent` on `raised` | on #FFFFFF **5.18** | on #222222 **6.14** | 3 |
| `accent-text` on `bg` | #B4380B **4.79** | #FF7A3D **7.29** | 4.5 |
| `accent-text` on `surface`/`card` | **5.98** | **6.85** | 4.5 |
| `accent-text` on `raised` | **5.98** | **6.14** | 4.5 |

The system's own pairs (inks, field, faint, status) are unchanged and pass in the same run.

### Colour split (landing page, full height, 1440 px; measured from screenshots by the house design system's balance check, which is not part of this repository)

| Scheme | 60 (page) | 30 (surfaces) | 10 (accent) | Ink |
|---|---|---|---|---|
| Light | 61.9 % | 29.0 % | 0.3 % | 8.8 % |
| Dark | 65.3 % | 30.7 % | 0.3 % | 3.7 % |

The accent is far under 10 % on purpose: it is the action colour only (COL-5), and the page has one primary per view. The 30 sits at COL-4's floors (1.25:1 light; a 1.06:1 lift carried by hairlines in dark).

### Page checks (squint and type audits from the house design system's review script, not part of this repository; re-check by eye against the rules above)

| Route | Width | Squint | Type audit |
|---|---|---|---|
| / | desktop | pass | 7 sizes, all on the scale |
| /pricing | desktop | pass | pass |
| /contact | desktop | pass | pass |
| / | phone | pass | 8 sizes (the lead's fluid 18 px is the eighth) |
| /pricing | phone | pass | pass |
| /contact | phone | pass | pass |

Fixed in this loop: the phone hero's full-width primary outweighed the H1 (now auto-width); /pricing and /contact had an unranked primary as the darkest spot (now ranked); an off-scale 20 px logo size; a 12.88 px code size in the hero note.

### Layout and behaviour checks (Playwright, headless Chromium)

- **No horizontal scroll** on /, /pricing, /contact and a 404 at 390, 768, 1024 and 1440 px. Fixed: the 768 px header (links now inline from 1024 px) and /pricing at 390 px (the comparison table's `sr-only` cell labels escaped its scroller; the scroller is now `relative`).
- **JavaScript off:** the phone menu opens and navigates; the pricing switch and deploy picker work (CSS `:has()`); the newsletter form posts and comes back with a 303 (`?newsletter=invalid#newsletter`); the contact form is a server action, so a failed send re-renders /contact with the error and everything typed (a 303 would lose the message); checkout buttons are plain forms.
- **Forms:** a foreign `Origin` is refused (403; Next refuses a cross-site server action itself), the honeypot is accepted, dropped and logged, JSON callers get JSON. The honeypot's name and label (`hp_7f3k`, “Leave this empty”) mean nothing to autofill, so a person's autofill can't trip it.
- **Forced colours:** selected states drawn as a fill (pricing interval, tabs, toggles, the current nav item) get a `Highlight` outline under `forced-colors: active` (base.css); the phone menu marks the current page with a bar, not colour alone, and closes when focus or a tap leaves it.
- **Content in the first byte:** every section's copy, the FAQ answers and the plans are in the server HTML (curl).
- Screenshots reviewed at 1440 and 390 px in light and dark: landing, pricing (with `?error=unavailable`), contact, 404, the phone menu.

### The great-design critique

Builder's scores (6 Oct) beside the target-user review of 7 Oct 2026. That review was done by the design reviewer reading as the brief's founder (Friday night, deciding in a minute whether this lets them own their SaaS), cold, across /, /docs, /docs/getting-started, /docs/ai-setup, /pricing, /blog and a post at both widths and in both schemes. It was not a separate person or a separate agent session, so treat it as a simulated reader. Everything that scored under 4 in the first read was fixed before the final scores. Where the two columns differ, the reader's scores lead.

| Criterion | Builder (6 Oct) | Reader (7 Oct) | Why, and what would raise it |
|---|---|---|---|
| Made for them | 4 | 4 | Their words, their hosts (VPS, Dokploy, Coolify, Node), their agents. A real founder's quote about leaving a hosted service would make it a 5 once one exists (testimonials stay off until then). |
| Understood | 5 | 5 | "Your SaaS, on your server", the three named fears, and the clone command right under the buttons. |
| One idea | 4 | 4 | "No landlord" runs from the hero to deploy. Two agent stories now share the page (the agent *runs* the site; the agent *sets it up*), each in its own section with its own question. A shorter agent section would sharpen it. |
| Felt, not told | 4 | 4 | Every command is copyable and the deploy picker is touchable; the bento and the transcript are pictures, not the product. |
| Specific | 4 | 5 | The bento shows `auth_user`, the webhook log, `backup.sh` and a real migration tag; the deploy panels quote deploy/ and docker-compose.yml word for word. No other starter's page could carry these. |
| Calm craft | 4 | 4 | First read 3: the hero's proof note broke into a long line and a two-word tail, the sign-in card's Postgres window floated under an unexplained gap, and the footer linked GitHub twice. All fixed. Left: the announcement bar takes three lines on a phone, and the first desktop screen has three accent fills (header, hero, the preview's "New post"). |
| Type and colour | 4 | 4 | First read 3: off-scale inline code in the docs, and a /blog H1 smaller than its first post's heading. Both fixed. Every route is on the scale; 122 token pairs pass; code tokens are at 4.5:1 or more everywhere. |
| True and consistent | 4 | 4 | First read 3: the landing's starter prompt contradicted the prompt pack (edit defaults.ts vs. "never"). Fixed and tested. Every claim maps to code. The repository must be public before launch, or every "Get the code" is a 404 (Open decisions). |

---

## Syncing with a design system

The shared look (`src/styles/{tokens,theme,base,motion,overlays}.css`, `src/components/ui/**`) can be synced from a design-system repository with `npm run ds:sync` ([docs/customization.md](docs/customization.md#staying-in-step-with-a-design-system)). What OpenShipKit has that the system doesn't is marked so a sync can't drop it:

- **CSS: keep blocks.** Each OpenShipKit-only rule sits between `/* ds-sync:keep start <name> */` and `/* ds-sync:keep end */`, as a self-contained top-level rule, because a sync carries the block to the end of the incoming file (where a later rule on the same selector still wins, and Tailwind merges a second `@theme`). Never write the start or end marker inside an explanatory comment: the sync reads any line that contains one. The blocks today:
  - `tokens.css`: `contrast-note` (how `contrast.test.ts` measures the tokens) and `brand-mark-defaults` (the amber → vermilion mark defaults, so no other product's mark colours ship here).
  - `theme.css`: `openshipkit-theme` (`--color-action-text`, `--color-mark-from/to`).
  - `base.css`: `app-shell-sticky-header` (`html:has([data-slot=sidebar-inset])`: the signed-in shell's bar counts at every width), `section-tone` (two page-tone sections share one gap), `forced-colors-selection` and `code-tokens` (syntax colour by scheme for every highlighted block, the CodePanel's and the docs').
  - `motion.css`: `header-edge` and `openshipkit-page-motion` (`.hp-screen`, `.hp-arrived`, `.hp-pulse` for the hero preview, and `.swap-in`; `.just-changed` was removed on 7 Oct 2026 with the preview's load-time arrival).
  - `base.css` also: `hero-preview` (`--elev-hero`, `--chrome-highlight`, `.hp-frame`, and the tab row's shade off from 768 px).
- **One rule, two names.** The system calls the sticky header's scroll hairline `.scroll-edge`; OpenShipKit calls it `.header-edge`, because `.scroll-shade` is the horizontal scroller's edge and the two read as one job. A sync brings `.scroll-edge` in, unused. Converge by upstreaming the name, or by switching `site-header.tsx` to `.scroll-edge` and deleting the `header-edge` block.
- **ui/ components: none pinned.** The fixes OpenShipKit carried in ten pinned components were upstreamed into the design system (its v2.2, 8 Oct 2026): 16 px field text on touch (`pointer-fine:text-small`), the 2 px danger edge on an invalid field, the input group's controls leaving the invalid state to the group, the command list's `data-[selected=true]` and its 3:1 field edge, the stronger `tonal-hover` wash on the highlighted row of a menu, select or command list (the system dropped the `ink-3` ring, `shadow-highlight`, in its v2.2.1: the owner read it as a glow), the done-label gap on Button, and the scrollable, named table with `.scroll-shade`. So `.ds-sync-keep` pins nothing, and every `ui/` file takes the system's updates. The `muted-wash` and `scroll-shade` keep blocks went with them (the system ships both), and so did `--shadow-highlight` in `openshipkit-theme`. Pin a file again only for a fix the system can't take, and say why here.

Before any `--apply`, put the design system's own brand, client and product names in a local, git-ignored `.ds-sync-deny`: the system can be private, this repository is public. The dry run's `−` lines that remain are comments (headers and notes the system words differently), not rules.

---

## Open decisions

- **Commands quoted on the page depend on files other areas own.** The agent transcript runs `npm run mcp:key -- --name claude --scope write` (mcp area: `scripts/mcp-key.mts`); the deploy picker quotes `node scripts/setup.mts --compose --domain …` in a throwaway Node container (the VPS has no Node.js; deploy/vps/README.md §5), the first `docker compose --profile https up -d --build`, the three-step update, `.env.example`, and `npm ci && npm run build`, `npm run db:migrate && npm run db:seed`, `npm start` for a Node host (`npm start` copies `.next/static/`, and `public/` only when it exists, into the standalone server, because `next start` doesn't support `output: "standalone"`), and links `deploy/` in the repository (infra-docs area). `sections.test.ts` fails when a quoted `npm run` script or `scripts/*.mts` file is missing. If any of them changes, update `src/components/sections/{agent,deploy}.tsx`.
- **The hero preview copies some of the admin's words.** Nav, icons, audit sentences, actor names, the hero section's label and the status words come from the shared modules, so they can't drift. Still typed twice: the overview's KPI labels and "Running on" pairs (`src/app/admin/(overview)/page.tsx`), the screens' one-line answers (the posts, agent keys and audit pages), and the scope descriptions (`mint-key-form.tsx`; `sections.test.ts` fails if they differ). The agent's title must equal the agent section's `AFTER` (tested). Change one, change the other.
- **The preview's state is one reducer** (`src/components/sections/hero-preview/demo-state.ts`, no React), and its client code is one module (`hero-preview/demo.tsx`). Words cross from the server as strings (`previewCopy()`), because `describeAudit` imports the content registry and with it zod, which must not ship to the browser.
- **The repository URL** is written once, `OPENSHIPKIT_REPO` in `src/shared/project.ts`; the default content, the footer, the deploy section and the showcase's structured data import it. It must resolve (the `openshipkit` repository created and public) before launch, or every "Get the code" is a 404.
- **The showcase links its own repository; a renamed site doesn't inherit it.** `site.social.github` defaults to empty (Invariant 8): while the site is still named OpenShipKit (`isShowcase`, `src/shared/seo.ts`) the footer shows the template's GitHub and the home page describes OpenShipKit as a free, MIT-licensed `SoftwareApplication` with its `SoftwareSourceCode`; rename it and only your own profiles and your plans' Offers appear.
- **Social links and contact email** are empty by default (Invariant 8): set them in `/admin/content/site`. Social links render only when set; the contact page's mailto fallback only when `contactEmail` is set.
- **Stats and testimonials** stay off until there are real, sourced ones.
- **The AI setup section links the docs owner's prompt pack** (`docs/ai-setup.md` at /docs/ai-setup) and names the MCP servers it recommends (GitHub, Dokploy, Cloudflare). If the guide drops one, change `SERVERS` in `src/components/sections/ai-setup.tsx`. The starter prompt there is checked by `sections.test.ts` (every script and file it names exists; it stops before deploying).
- **Feature moments quote real names:** the Drizzle tables (`auth_user.two_factor_enabled`), the webhook route, the latest migration tag (`0004_post_listed`), `deploy/backups/backup.sh`, the admin and dashboard nav (imported, so they can't drift). When a migration is added the tag shown is merely older, still true; a renamed table must be changed in `feature-moments.tsx`.
- **The code colours are guaranteed in one place** (7 Oct 2026): `highlightTokens` applies `readableOn` (`src/shared/code-contrast.ts`) to every token, for the landing's panels and the docs' Markdown alike. It measures against `--card`/`--surface` (#FFFFFF, #181818). Highlighted code placed on another surface (`raised`, `bg`) would need that colour passed in.
- **Before launch, the repository must be public** at `OPENSHIPKIT_REPO`. On 7 Oct 2026 every github.com/DrisH31/openshipkit link (the hero's and header's "Get the code", the clone command, "Edit this page on GitHub", the docs' links into the code) answers 404, because the repository isn't public yet. The paths they name all exist in the tree.

---

## Standards IDs

Code comments cite these as `Standards (web-design): COL-1 …` or `(LAY-5)`. Each is a rule of the house "Neutral" design system, stated here so a contributor can check a file against it without any outside tooling. The colour floors are measured by `src/styles/contrast.test.ts`.

| ID | Rule |
|---|---|
| **COL-1** Text contrast | Every text role is ≥ 4.5:1 on every surface it can sit on, in both schemes. |
| **COL-2** Controls, icons and focus at 3:1 | Field edges, the focus ring, meaningful icons and the accent as a control are ≥ 3:1 against what is behind them. So is the mark of a state: the highlighted menu, select or ⌘K item and the selected segment carry a 1 px ink-3 ring (`shadow-highlight`) over their wash, because the wash alone is 1.1–1.3:1; `bg-muted` is the tonal wash, never a surface (contrast.test.ts). |
| **COL-3** Never colour alone | State is carried by text, an icon or shape as well as colour. |
| **COL-4** The 30 is a different colour from the 60 | Content surfaces step off the page (1.25:1 light; a lift plus a hairline in dark). |
| **COL-5** One accent, for action only | The accent marks the one action, focus and a selected state — never a heading, band, icon set or navigation. |
| **COL-6** Navigation chrome is neutral | Header and sidebar sit on the page tone; a hairline appears only once content scrolls under. |
| **COL-8** Dark mode is designed, not inverted | Dark values are chosen and measured on their own, not flipped from light. |
| **COL-9** Status colours in one family | Positive, warning, danger and info share one lightness and chroma per tier, so none shouts. |
| **COL-10** Two hairlines, two jobs | `line` divides inside a card; `line-strong` is an edge that must be seen on the page. |
| **COL-11** Colours are roles, in one place | Components use role tokens (`ink-2`, `surface`) from `tokens.css`, never raw values. |
| **COL-12** The theme contract | A product changes only the accent roles and the mark's gradient (`brand.css`). |
| **COL-13** A categorical palette for charts | Series use `--chart-1…5` in order, never cycled; charts also carry labels or a table. |
| **TYP-1** A scale, not ad-hoc sizes | Only the tokens' sizes (`text-display` … `text-caption`). |
| **TYP-2** Every level steps clearly | Adjacent levels differ by ≥ 1.2×. |
| **TYP-3** One H1, and tags match the look | One `h1` per page; heading levels never skip; a heading's look follows its level. |
| **TYP-4** Leading by size | Large type sets tight, body text open. |
| **TYP-5** Letter spacing by job | Display tightens, caps labels track out, body is untouched. |
| **TYP-6** Line length | Running text stays near `--measure` (~70 characters). |
| **TYP-7** Ink levels make the reading order | `ink` → `ink-2` → `ink-3` carry what is read first, second, third. |
| **TYP-8** Real typography | Curly quotes and apostrophes, real dashes and ellipses, lining figures. |
| **TYP-9** The small stuff stays readable | Nothing a person must read is under 12 px or below `ink-3`. |
| **TYP-10** Dark mode type | Light-on-dark eases weight a notch and opens small text slightly. |
| **TYP-11** Organised type: fixed roles, one rhythm | Each role (eyebrow, title, lead, body, meta) has one fixed setting. |
| **LAY-1** One spacing scale | Spacing comes from the scale and `--space-section`, not one-off values. |
| **LAY-2** Proximity carries the grouping | Related things sit closer than unrelated ones; no box where space would do. |
| **LAY-3** Nothing clickable touches | Interactive targets keep a gap between them. |
| **LAY-4** Touch targets | 44 px on a coarse pointer (WCAG 2.5.8's 24 px is the floor, not the aim). |
| **LAY-5** One solid primary per view | One filled button per view; the rest are outline, tonal or quiet. |
| **LAY-8** Focus is visible and never hidden | Every focusable element shows a 3:1 ring and is never covered by a sticky bar. |
| **LAY-9** Content width per job | Reading, forms and dashboards each have their own max width. |
| **LAY-11** Layers and breakpoints are named | z-index and breakpoints come from tokens (`--z-header` …). |
| **LAY-12** One grid under every section | Sections align to one 12-column grid and gutter. |
| **MOT-1** Respond under 100 ms; INP within budget | Input is acknowledged at once (press in 90 ms); INP ≤ 200 ms. |
| **MOT-2** Animate transform and opacity only | Nothing animates layout properties. |
| **MOT-3** Durations by element | Press, hover, pop, UI, sheet and reveal each have one duration token. |
| **MOT-4** Easing with character | Arrivals decelerate (quint-out), responses quart-out; no bounce on text. |
| **MOT-5** The frequency gate | The more often something happens, the less it animates. |
| **MOT-6** Physicality | Pressables scale slightly on press; things move as if they had mass. |
| **MOT-7** Interruptible | A transition can be reversed mid-way without a jump. |
| **MOT-8** Reduced motion ships less | `prefers-reduced-motion` gets the final state or a fade, never movement. |
| **MOT-10** One motion library, lazy | Motion is CSS (`motion.css`); a JavaScript motion library, if ever added, loads only where used. |
| **MOT-11** Solid by default, glass as an enhancement | Blur and translucency only where supported, over a solid fallback. |
| **PAGE-1** Content in the first byte | Public copy is in the server HTML; nothing behind `useEffect` or `opacity: 0`. |
| **PAGE-2** The real product, shown | Show the product's own UI (rendered or captured), never a drawing of it. |
| **PAGE-3** Each device downloads only its own image | Hidden variants are lazy, so a device fetches one image. |
| **PAGE-4** Loops can be paused | Anything that moves for over 5 s has a pause (WCAG 2.2.2), or doesn't loop. |
| **PAGE-5** A sticky header that never covers | Sticky only where there is room; anchors and focus land below it. |
| **PAGE-9** Images are light, sized and described | Every image has dimensions (or a reserved box), a sensible weight and alt text. |
| **UI-1** One component base, restyled through tokens | shadcn on Base UI, styled only through tokens. |
| **UI-2** The sidebar collapses and remembers | The product sidebar collapses to an icon rail and keeps the choice. |
| **UI-5** Dashboards: the answer first | The figure that answers the screen's question comes first. |
| **UI-6** Every state is designed | Empty, loading, error, partial and full states all exist. |
| **UI-7** Lists and tables | Tables align numbers, keep headers, and scroll inside themselves. |
| **UI-8** Forms | Labels above fields, errors tied to their field, native controls where they work. |
| **UI-9** Undo over confirm | Prefer an undo after the fact to an "Are you sure?" before it. |
| **UI-12** Charts answer a question | A chart has a title that says what it shows and a non-visual equivalent. |
| **UI-14** Command menu | ⌘K opens one palette for navigation and actions, fully keyboard-driven. |
| **UI-17** Feedback where the action happened | A result shows at the control that caused it ("Copied", "Saved"), announced to screen readers. |
