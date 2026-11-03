# Upgrading

OpenShipKit is a template: you copy it and it becomes your code. There’s no
package to bump. This page covers pulling improvements from the template, the
upgrades you’ll do on any Next.js app, and Postgres major versions.

## Pulling template updates

The short way, once the template is a remote (below):

```bash
npm run upgrade             # what upgrading to the newest release involves: changes nothing
npm run upgrade -- --merge  # merge it on a new branch upgrade/<version>, not committed
```

The report lists every release you're crossing from the template's
CHANGELOG, each one's **Upgrade notes** first (what you must do: a variable to
set, a migration to run), the template's new migrations, and a warning when
your own migrations would make Drizzle skip the template's (below) or your
history isn't the template's. `--merge` needs a clean working tree. It creates
a branch, merges with `--no-commit` and lists the conflicts and next steps; you
review, run the checks and commit. It never commits, pushes or migrates.
`--to v1.2.0` picks a release; `--remote upstream` if you named the remote
differently. The template's release tags are fetched into their own namespace
(`refs/openshipkit/tags/…`), so they never mix with your own tags, and "your
version" is the template release your history last merged, not your
`package.json`.

The same by hand: keep the template as a second remote and merge its releases:

```bash
git remote add openshipkit https://github.com/DrisH31/openshipkit.git   # once
git fetch openshipkit --tags
git merge openshipkit/main            # or a release tag: git merge v1.0.0
```

If your repository was made with GitHub’s **Use this template** button, or
started with a fresh `git init`, it shares no history with the template and
git refuses with “refusing to merge unrelated histories”. Make the first merge
with `git merge --allow-unrelated-histories openshipkit/main` (expect conflicts
in every file you’ve changed; later merges are normal), or skip merging and
cherry-pick the release commits you want instead.

Read [CHANGELOG.md](../CHANGELOG.md) for the versions you’re crossing first.
Conflicts are usually in the files you’ve customized most (copy defaults,
landing-page sections, brand.css); keep yours. Then:

```bash
npm install
npm run check && npm run build
npm run db:migrate                   # new migrations, if any (stop `npm run dev` first)
```

Prefer smaller steps? Cherry-pick the commits you want: the template’s history
is kept readable for that.

### If you have your own migrations

Drizzle does **not** look for gaps. It reads the newest row in
`drizzle.__drizzle_migrations` and applies only the migrations whose `when` in
`drizzle/meta/_journal.json` is newer than that. A template migration that was
generated *before* your latest one is skipped without a word,
`npm run db:migrate` reports “Up to date”, and the app then fails on a missing
column or table.

The rule: **every template migration you merge must have a `when` newer than
the last migration already applied to your databases.** The reliable way is to
take the template’s schema change and regenerate the migration yourself, so it
gets a fresh timestamp:

```bash
git merge --no-commit openshipkit/main
git diff --stat HEAD...MERGE_HEAD -- drizzle/   # the template's new migrations
git restore --source=HEAD --staged --worktree -- drizzle/   # keep your migration history as it is
npm run db:generate -- --name openshipkit-v1-1    # schema.ts now has both sides
```

Read the generated SQL next to the template’s (`git show MERGE_HEAD:drizzle/<file>.sql`)
and copy over anything drizzle-kit can’t generate, such as a data backfill.
Then commit the merge, run `npm run db:migrate`, and run `npm run db:generate`
again — it should say “No schema changes”.

To check a database after migrating, count what it has applied; it must equal
the number of entries in `drizzle/meta/_journal.json`. Fewer means one was
skipped — find the journal `when` with no matching `created_at`:

```sql
select count(*) from drizzle.__drizzle_migrations;
select created_at from drizzle.__drizzle_migrations order by created_at;
```

## Next.js and dependencies

Next.js publishes security releases regularly; patch the same week.

```bash
npm install next@<version> eslint-config-next@<version>
npm run check && npm run build
```

Dependabot (`.github/dependabot.yml`) groups updates weekly; CI runs the full
suite, a build with no environment, Postgres tests and a smoke test on every PR.
Better Auth releases matter as much as Next’s: its version is pinned exactly in
`package.json` — upgrade it deliberately, read its changelog, and generate a
migration if it adds columns.

## Node.js

The Dockerfile pins an exact `node:24.x-alpineX` tag on its `FROM` line, and
Dependabot proposes new ones (keep it literal: Dependabot can’t follow a
`FROM ${ARG}`). Dependabot doesn’t see the same tag in the one-off
`docker run node:…` setup commands in `README.md` and `deploy/vps/README.md`:
bump those by hand when you merge its PR. Node 24 is LTS until April 2028.

## Postgres

- **Minor versions** (18.6 → 18.7) are drop-in: bump the tag in
  `docker-compose.yml`, `docker compose pull postgres && docker compose up -d`.
- **Major versions** (18 → 19) change the on-disk format. Dump and restore:

  ```bash
  ./deploy/backups/backup.sh                          # 1. fresh dump (ls /var/backups/openshipkit)
  ./deploy/backups/restore.sh --rehearse /var/backups/openshipkit/<project>-<stamp>.dump   # 2. prove it restores
  docker compose --profile https down                 # 3. stop (volumes stay)
  # 4. change the image tag to postgres:19.x-alpine…
  docker compose up -d postgres                       # 5. 19 starts an empty cluster beside 18’s
  ./deploy/backups/restore.sh --replace /var/backups/openshipkit/<project>-<stamp>.dump
  docker compose --profile https up -d --build
  ```

  `<project>` is the compose project name (`COMPOSE_PROJECT_NAME` in `.env`,
  else `openshipkit`). Since Postgres 18 the images keep their data in a
  directory per major version (`/var/lib/postgresql/18/docker`), and the
  volume is mounted one level up, so 19 initialises
  `/var/lib/postgresql/19/docker` next to the old cluster: nothing is deleted,
  and putting the 18 tag back is the way back. The app is down from step 3,
  so `restore.sh` leaves it alone and the last command starts it.

  Once the site has run on 19 for a while, reclaim the old cluster’s space:
  `docker compose exec postgres rm -rf /var/lib/postgresql/18`.

  If you’d rather start from an empty volume (or the new image refuses to
  start on the old one), remove **this site’s** volume between steps 3 and 4.
  It is named after the compose project, not always `openshipkit`, and on a
  server with two copies the other site’s volume sits right next to it:

  ```bash
  VOLUME="$(docker compose config | sed -n 's/^name: //p')_postgres_data"
  echo "$VOLUME"            # must be <COMPOSE_PROJECT_NAME>_postgres_data for THIS checkout
  docker volume rm "$VOLUME"   # ONLY after step 2 passed: the dump is then the only copy
  ```

## Coming from GetShipKit

[GetShipKit](https://github.com/DrisH31/GetShipKit) is OpenShipKit's
sibling built on hosted services (Clerk for auth, Supabase for data). It is
maintained separately; you don't have to move. If you want your users and
data on your own server instead, there is no automatic migration path, because
OpenShipKit keeps auth and data in your own Postgres:

- **Start a new copy** of OpenShipKit and move your product code over; the
  directory layout and rules are in [architecture.md](architecture.md).
- **Users**: export them from your old auth provider and import them as
  `auth_user` + `auth_account` rows (Better Auth’s
  [migration guides](https://better-auth.com/docs) cover common sources), or
  ask users to reset their password on first sign-in.
- **Data**: your old tables were already Postgres; `pg_dump --data-only` the
  ones you need and load them into new tables you define in `schema.ts`.
- **Payments**: OpenShipKit uses Polar. Re-create products there and connect
  them in `/admin/plans`.

The README's [comparison](../README.md#openshipkit-or-getshipkit) sets out
what changes.
