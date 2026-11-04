# Releasing and versions

How OpenShipKit moves from work in progress to a version you can start a site
from. No promotion script: branches say what’s finished, tags say what’s
released, and [CHANGELOG.md](../CHANGELOG.md) says what changed.

## Branches

| Branch | Holds | Rule |
|---|---|---|
| `dev` | work in progress | every change lands here first, through a pull request; CI runs on every push |
| `main` | finished work only | updated only by merging `dev` when CI is green and the changelog is written; never committed to directly |
| `vX.Y.Z` tags on `main` | releases | immutable: a mistake gets a new patch version, never a moved tag |

A site should never start from `dev`, and only exceptionally from `main`
between releases: start from a tag.

## Versions

[Semantic Versioning](https://semver.org/), read for a template:

- **Patch** (`v1.0.1`): fixes and security updates. Safe to merge into a site
  as is.
- **Minor** (`v1.1.0`): new features, new optional variables, additive
  migrations. Read the changelog entry; usually a plain merge.
- **Major** (`v2.0.0`): something a site must change by hand — a renamed
  variable, a removed feature, a migration that rewrites data. The changelog
  entry says exactly what.

## Cutting a release

1. On `dev`: `npm run check`, `npm run build` with no environment, and against
   a running server `npm run smoke` and `npm run e2e` (CI runs all of them).
2. In [CHANGELOG.md](../CHANGELOG.md), move “Unreleased” under the new version
   and today’s date. Say what a site owner must do, if anything — new
   variables, a migration (link
   [upgrading.md](upgrading.md#if-you-have-your-own-migrations)), a breaking
   change — under a `### Upgrade notes` heading in that version's section:
   `npm run upgrade` shows it first to everyone crossing that version.
3. Merge `dev` into `main` (a pull request, so CI runs on the result), then tag
   the merge commit and push the tag:

   ```bash
   git switch main && git pull
   git tag -a v1.1.0 -m "v1.1.0"
   git push origin v1.1.0
   ```

4. Optionally publish a GitHub release from the tag with the changelog entry
   as its text.

## Starting a site from a release

```bash
npx degit DrisH31/openshipkit#v1.1.0 my-site     # the files at that tag, no history
cd my-site
git init && git add -A && git commit -m "Start from OpenShipKit v1.1.0"
npm install
npm run setup                                   # or: npm run setup -- --profile site
npm run dev
```

Write the version down — the first commit message above does it — so you know
which changelog entries you’ve already got. `degit` copies files without
history, so the first time you pull a later release, merge with
`--allow-unrelated-histories` ([upgrading.md](upgrading.md#pulling-template-updates));
after that, merges are normal. Want the history from day one instead?
`git clone --branch v1.1.0 https://github.com/DrisH31/openshipkit.git my-site`,
then rename the `origin` remote to `openshipkit` and add your own.

## Repository settings

These are the settings of the public repository, `github.com/DrisH31/openshipkit`.
They live in GitHub, not in any file here, so the owner sets them by hand
(or with `gh repo edit`) and checks them again before each release.

**About** (the gear next to “About” on the repository page):

| Field | Value |
|---|---|
| Description | `The free, open-source SaaS starter you run on your own server: Next.js 16, Postgres, Better Auth, optional Polar billing and Resend email, and a built-in MCP server so AI agents can run the site. MIT.` |
| Website | `https://drishlabs.com/apps` (OpenShipKit has no site of its own) |
| Topics | `nextjs` `saas` `saas-starter` `saas-boilerplate` `starter-kit` `self-hosted` `open-source` `typescript` `postgres` `drizzle-orm` `better-auth` `mcp` `mcp-server` `polar` `resend` `tailwindcss` `shadcn-ui` `docker` `dokploy` `coolify` |
| Releases, Packages, Deployments | Releases on; the other two off |

GitHub allows at most 20 topics, and that is 20. The same values with the CLI:

```bash
gh repo edit DrisH31/openshipkit \
  --description "The free, open-source SaaS starter you run on your own server: Next.js 16, Postgres, Better Auth, optional Polar billing and Resend email, and a built-in MCP server so AI agents can run the site. MIT." \
  --homepage "https://drishlabs.com/apps" \
  --add-topic nextjs,saas,saas-starter,saas-boilerplate,starter-kit,self-hosted,open-source,typescript,postgres,drizzle-orm,better-auth,mcp,mcp-server,polar,resend,tailwindcss,shadcn-ui,docker,dokploy,coolify
```

**Settings → General**

- Repository name: `openshipkit`, a repository of its own. GetShipKit
  (`DrisH31/GetShipKit`) is a separate, maintained project: never
  rename or archive it to make room for this one.
- Default branch: `main`, so visitors and `degit` see finished work. Pull
  requests target `dev` (the pull-request template says so).
- Features: **Issues** on. **Discussions** on: the issue chooser
  (`.github/ISSUE_TEMPLATE/config.yml`) sends questions there, and the link is
  a 404 until Discussions is enabled. Wiki and Projects off: the docs live in
  `docs/` and on the website.
- Social preview: upload a 1280 × 640 image of the landing page. The site’s
  own Open Graph image works (`/opengraph-image` on the live site).
- Pull requests: allow squash merging. Turn on “Automatically delete head
  branches”.
- Labels: `bug`, `enhancement` and `docs` must exist. The issue forms apply
  them, and GitHub skips a label that doesn’t exist.

**Settings → Rules** (a ruleset for `main` and one for `dev`): require a pull
request, require the CI workflow (`.github/workflows/ci.yml`) to pass, and
block force pushes and deletions. On `main`, also restrict tag creation for
`v*` to maintainers, because a release tag is never moved.

**Settings → Code security**

- **Private vulnerability reporting** on. [SECURITY.md](../SECURITY.md) and the
  issue chooser link to `security/advisories/new`, which only works when this
  is enabled.
- Dependabot alerts and Dependabot security updates on
  (`.github/dependabot.yml` already schedules version updates).
- Secret scanning and push protection on.

**Before announcing a release:** the README’s badges answer (CI passing on
`main`), the website and `/docs` load, `docs/images/landing-*.webp` match the
current landing page, and the GitHub release for the tag has its changelog
entry as its text.

## What a release is checked against

Every release has passed, in CI: typecheck, lint and unit tests; the build
with no environment; migrations applied twice and the seed run twice on a real
Postgres; the contract tests on Postgres; the production build smoke-tested
and driven end to end (`scripts/e2e.mts`: sign-up with verification, admin
via `ADMIN_EMAILS`, publishing, the contact form, MCP, clean-up); and both
Docker targets built.
