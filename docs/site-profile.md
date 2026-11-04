# A content site: landing page + blog, no SaaS

OpenShipKit is a SaaS starter, but the same code makes a fast, self-hosted
**marketing site with a blog**: the landing page, posts, changelog, legal pages,
the contact form, the admin and the MCP server — without plans, pricing or
checkout. Two ways to get there:

| | The profile switch (recommended) | Deleting the code |
|---|---|---|
| How | `OPENSHIPKIT_PROFILE=site` | the steps [below](#deleting-the-saas-code-for-good) |
| Undo | set it back to `saas` (or empty) and restart | git |
| Template updates | merge as usual | conflict in every file you edited |
| What’s left in the repository | the billing code, switched off | less code |

## The switch

```bash
npm run setup -- --profile site                      # development: .env.local
npm run setup -- --compose --profile site            # production: .env
```

That sets `OPENSHIPKIT_PROFILE=site` and `BILLING_PROVIDER=none` (a value you
already set is never changed — edit the file for that) and prints what the
profile switches off. Or set the variable yourself and restart.

With `OPENSHIPKIT_PROFILE=site`:

- **No pricing.** `/pricing` is a 404; the landing page has no pricing
  section or plan cards; the header and footer leave out every link to a
  SaaS-only page (`/pricing`, the dashboard’s Billing, the admin’s Plans),
  whether it is a default or one you saved.
- **No billing.** No checkout or customer portal (`/api/billing/*` answer
  404), billing is off whatever billing keys (Polar, Stripe or Razorpay) are
  set, and the dashboard has no
  Billing page or link.
- **No plans in the admin**: no Plans page or link in `/admin`, and no plan
  tools over MCP.
- **Nothing about plans in what crawlers read**: no `/pricing` in the sitemap
  or `llms.txt`, no `Offer` in the JSON-LD.

Everything else stays: sign-up and sign-in (the dashboard is a place for
accounts, feedback and settings), the blog and changelog with their feeds,
legal pages, the contact and newsletter forms, the admin (content, posts,
media, users, feedback, subscribers, agent keys, audit), MCP and every SEO
surface.

Nothing is deleted, and stored data is untouched: switching back to `saas`
brings the pricing page and plans back as they were.

The starter legal pages are your content, so the profile doesn’t edit them.
The Terms (`/legal/terms`) are written for a subscription SaaS: section 5
covers plans, payment and Polar and links to `/pricing`, which is a 404 here.
Rewrite or remove that section in `/admin/posts` along with the rest of the
placeholders ([content.md](content.md)).

**Check it** after a restart:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/pricing        # 404
curl -s http://localhost:3000/sitemap.xml | grep -c '/pricing'                # 0
curl -s http://localhost:3000/api/health | grep -o '"profile":"[a-z]*"'      # "profile":"site"
npm run smoke                                                                  # still green
```

Smoke reads the profile from `/api/health` and, under `site`, checks that
`/pricing` is a 404 and missing from the sitemap instead of loading it.

Navigation you saved in `/admin/content/navigation` is never rewritten: a
Pricing link in it is left out when the page renders, and comes back if you
switch to `saas`. Remove it there if you want the stored copy clean.

## Switching features off

Whatever the profile, two features can be switched off on their own:

```bash
npm run setup -- --without blog,mcp     # or set OPENSHIPKIT_WITHOUT=blog,mcp
```

| Feature | What goes |
|---|---|
| `blog` | `/blog`, its posts, tag pages, feed and post images (404); the Blog links in the navigation, the latest-posts section, the blog in the sitemap and `llms.txt`, and the feed link in every page's head. In the admin and MCP, new blog posts and publishing one are refused; existing ones can still be edited, unpublished or deleted, and the posts list opens on the changelog. The changelog and the legal pages are posts too, and stay. |
| `mcp` | The MCP server at `/api/mcp` (404, every method), the admin's agent keys page, the setup checklist's agent step, and `npm run setup`'s local agent key. |

It's a switch, like the profile, not a deletion: the code and the stored
posts and keys stay, so emptying `OPENSHIPKIT_WITHOUT` brings everything back,
and template updates still merge without conflicts in files you'd otherwise
have deleted. A name the app doesn't know refuses to start the server, so a
typo can't leave on a feature you meant to turn off. The list of each
feature's paths is `FEATURE_PATHS` in `src/core/profile.ts`, the same place the
profile's are listed.

## Deleting the SaaS code for good

Only if you want the code gone, and accept that template updates will
conflict. Do it on a branch, in this order, and let the type checker find the
stragglers. (This list was checked on a copy of the template: after steps 1–2,
`npx tsc --noEmit` passes.)

**1. Delete the SaaS routes and components:**

```bash
rm -r "src/app/(marketing)/pricing" src/app/api/billing src/app/dashboard/billing \
      src/app/admin/plans src/components/billing \
      src/components/sections/pricing.tsx src/components/sections/pricing-plans.tsx \
      src/server/mcp/tools/plans.ts tests/billing.test.ts
```

**2. Fix the imports the type checker now names** (`npx tsc --noEmit`):

- `src/app/(marketing)/page.tsx` — remove the `Pricing` import and `<Pricing />`.
- `src/server/mcp/tools/index.ts` — remove the `PLAN_TOOLS` import and its
  spread in `TOOLS`, and make `SAAS_ONLY_TOOLS` an empty set
  (`new Set<string>()`).
- `src/components/sections/sections.test.ts` — remove the `pricing-plans`
  import and the `describe` blocks that use `PricingPlans` or `isCurrentPlan`.
- `tests/profile.test.ts` — remove the tests that import what’s gone: the
  `/pricing`, `/dashboard/billing` + `/admin/plans` and `/api/billing/*` route
  tests, “the home page has no pricing section”, and “the registry offers no
  plan tools”.

**3. Remove the links to what’s gone.** The type checker can’t see a URL in a
string. Find them all:

```bash
grep -rn '"/pricing\|/dashboard/billing\|/admin/plans\|/api/billing' src --include='*.ts' --include='*.tsx'
```

and change each: the `/pricing` entry in `STATIC_PATHS` (`src/app/sitemap.ts`)
and in the 404 page’s list (`src/app/not-found.tsx`); the Pricing links in
`navigation` (`src/content/defaults.ts`); the Billing and Plans entries in
`src/lib/app-nav.ts`; the “New plan” command (`src/components/product/product-shell.tsx`);
the plan and billing cards on `src/app/dashboard/page.tsx` and the admin
overview’s “Paying now” link (`src/app/admin/(overview)/page.tsx`); the
`pricing` entry in `LIVE_AT` (`src/app/admin/content/[key]/page.tsx`); the
pricing lines in `src/components/seo/llms.ts` and the `Offer` nodes in
`src/shared/jsonld.ts`. Comments and the starter posts
(`src/content/seed-posts.ts`) mention `/admin/plans` too — rewrite or delete
those posts anyway.

**4. Tests and docs:** in `tests/mcp.test.ts` remove the `plans` tests, the
plan tool names from “covers the whole site”, the plan calls in the
refusal test and the free-plan test under “admin tools”; in
`tests/profile.test.ts` remove “tools/list leaves them out and tools/call
doesn't know them”. The deleted route handlers are listed where a file that’s
gone fails a test: remove their `ROUTES` entries in `tests/authz.test.ts` (whose
self-tests also use the checkout and portal paths as their signed-in examples:
remove or rewrite those), their `ENDPOINTS` entries and the
`checkoutInputSchema` import in `src/server/api-reference.ts`, and the
`/api/billing/checkout` assertion in `tests/api-reference.test.ts`; then
`npm run docs:api` regenerates `docs/api.md`. In `tests/provider-copy.test.ts`, remove the `ALLOWED` entries
for `src/components/billing/` files. In `docs/mcp.md` remove the plan tools
(no test needs them there any more). Remove the pricing parts of `docs/` you
no longer need. `npm test` then passes.

**5. Content:** in `/admin/content`, turn off or reset the `pricing` section,
and remove Pricing from `navigation` if you saved it.

**6. Leave the data layer.** The `plans`, `subscriptions` and `purchases`
tables, `src/server/services/{billing,plans}.ts`, `src/adapters/billing/` and
the `DataStore` methods behind them are part of the core contract (both
adapters, the contract tests, the audit log’s restore). Removing them means a
migration that drops tables and edits across `src/core`, both data adapters
and `tests/contract`; empty tables cost nothing. If you do it anyway, follow
[AGENTS.md](../AGENTS.md) “Add a database column” in reverse, one table per
migration.

Then: `npm run check`, `npm run build` with no environment, `npm run smoke`.
