# Contributing to OpenShipKit

Thanks for helping. OpenShipKit aims to be the clearest, most self-sufficient
SaaS starter there is, so contributions are judged on two things: does it work
for someone self-hosting it, and does it keep the codebase easy to understand?

## Before you start

- **Bugs**: open an issue with steps to reproduce (the template asks for what we need).
- **Features**: open an issue or discussion first for anything bigger than a
  small fix, so we can agree on the shape before you write it.
- **Security problems**: never in a public issue — see [SECURITY.md](SECURITY.md).

What we won’t merge: a dependency on a hosted auth, database, analytics or
backend service; tracking; anything that makes `npm run dev` need an account or
`next build` need a secret. Payments (Polar) and email (Resend) stay optional.

## Set up

```bash
git clone https://github.com/<you>/openshipkit.git && cd openshipkit
npm install
npm run dev        # embedded Postgres, no env needed
```

Node.js 24 LTS. `npm run setup` writes a `.env.local` with secrets and an
`MCP_DEV_KEY` if you want the admin (`--admin-email you@example.com`) or MCP.

## The rules

[AGENTS.md](AGENTS.md) is the short version and [SPEC.md](SPEC.md) the full
contract. The ones reviews check most:

- Every write goes through `src/server/services/*` — validated, then audited.
- SDKs and drivers are imported only in `src/adapters/*`.
- Env is read lazily through `src/server/env.ts`; the build needs nothing.
- Public pages are server-rendered with their content in the HTML; forms work
  without JavaScript.
- Accessible in light and dark: labels, focus, keyboard, contrast, 44 px targets.
- Each file starts with a short comment saying what it is and its non-obvious rules.

Code style: strict TypeScript, double quotes, semicolons, 2 spaces, named
exports, kebab-case file names. ESLint enforces most of it.

## Check your change

```bash
npm run check                  # typecheck (app + modules) + lint + unit tests
npm run build                  # with no env vars — this must pass
npm run smoke                  # with `npm run dev` running (read-only)
npm run e2e                    # with `npm run dev` running: signs up, publishes, cleans up
```

**Postgres tests.** The data-contract tests also run on a real Postgres when
`TEST_DATABASE_URL` is set (that database is truncated before every test — use
a throwaway one), and the Better Auth tests when `AUTH_TEST_DATABASE_URL`
points at a migrated database. With `TEST_DATABASE_URL` set, the example apps'
stores (`tests/examples/`) also run on that server, each in a database of its
own that the suite creates and drops, so the role needs `CREATEDB` (the
container's `postgres` superuser has it):

```bash
docker run -d --name ol-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:18-alpine
until docker exec ol-test pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
docker exec ol-test createdb -U postgres openshipkit_test
DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm run db:migrate
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/openshipkit_test \
AUTH_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres \
  npm test
docker rm -f ol-test
```

CI runs all of this on every pull request (`.github/workflows/ci.yml`),
including a production build started against Postgres and smoke-tested.

**Schema changes**: edit `src/adapters/data/postgres/schema.ts`, run
`npm run db:generate -- --name <change>`, commit the generated SQL, update the
memory adapter and the contract tests.

## Branches and versions

- **`dev`** is where work lands: branch from it, open pull requests against it.
- **`main`** holds finished work only. It moves when `dev` is merged into it
  for a release, never by a direct commit.
- **Tags `vX.Y.Z`** on `main` are the releases, each with its
  [CHANGELOG.md](CHANGELOG.md) entry. Sites start from a tag
  (`npx degit DrisH31/openshipkit#v1.0.0 my-site`), never from a branch.

[docs/releasing.md](docs/releasing.md) has the details: what a patch, minor
and major version mean for a site, and how a release is cut.

## Pull requests

- Against `dev`. One change per PR; small is good. Describe what and why, and how you checked it.
- Update the docs (`docs/`, `.env.example`, `AGENTS.md`) when you change
  behaviour, a variable or a command.
- Add an entry under “Unreleased” in [CHANGELOG.md](CHANGELOG.md) for anything
  a template user would notice.
- Commits: present tense, specific (“Verify Polar webhook before parsing the body”).

## Writing docs

The guides in `docs/` are also the website’s `/docs`, so they follow a few
rules the site relies on:

- Each page starts with one `# Title` line and then one paragraph that says
  what the page covers. That paragraph is the page’s description in search
  results, so put the claim in the first sentence.
- A new page gets an entry in [docs/nav.json](docs/nav.json), in reading
  order. Every page under `docs/` appears there once, except the folder
  index `docs/README.md`.
- Link to another guide as a plain relative file (`email.md`,
  `modules/ai.md`, `deployment.md#migrations`), and to code or deploy files
  as relative repository paths (`../src/server/env.ts`,
  `../deploy/vps/README.md`).
- Placeholders only: `example.com`, `you@example.com`, `203.0.113.10`. Never
  a real domain, address, account or local path.
- A prompt in [docs/ai-setup.md](docs/ai-setup.md) is a fenced `text` block
  and says what the agent must not do. When a command or a step changes,
  update the prompt that runs it.

## Releasing (maintainers)

1. **The repository is `DrisH31/openshipkit`.** Every clone command, badge,
   advisory and issue link (README, docs, SECURITY.md, `.github/`, the site’s
   footer and deploy section) points there. Create that repository *before*
   pushing a release that links to it, or those links 404. Check with
   `curl -sI https://github.com/DrisH31/openshipkit | head -1`. Do **not**
   rename `DrisH31/GetShipKit` for this: GetShipKit is a separate,
   maintained project.
2. `npm run check`, `npm run build` with no environment, and CI green on `dev`.
3. Move “Unreleased” in [CHANGELOG.md](CHANGELOG.md) under the new version and
   date. If the release adds a migration, say so in the entry and point at
   [docs/upgrading.md](docs/upgrading.md#if-you-have-your-own-migrations).
4. Merge `dev` into `main` through a pull request, then tag the merge commit
   (`git tag -a v1.1.0 -m v1.1.0 && git push origin v1.1.0`). Never move a
   tag: a mistake is a new patch release. [docs/releasing.md](docs/releasing.md).
5. Check the repository settings (description, website, topics, Discussions,
   private vulnerability reporting) against
   [docs/releasing.md → Repository settings](docs/releasing.md#repository-settings).

By contributing you agree your work is released under the [MIT License](LICENSE)
and you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
