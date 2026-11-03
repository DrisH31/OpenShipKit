# Backups

An OpenShipKit site is two things on disk, and a backup is both:

| What | Where it lives | Covered by |
|---|---|---|
| Users, sessions, content, posts, plans, subscriptions, feedback, the audit log | Postgres (`postgres_data` volume under compose) | `pg_dump` — `backup.sh` |
| Uploaded images (covers, images in posts) | `UPLOADS_DIR` — the `uploads` volume under compose, `/opt/openshipkit/uploads` on plain Node | a tar of the folder — `backup.sh` |
| Code, migrations, default copy, configuration | git | git |
| `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, `RESEND_API_KEY`, `POLAR_*` | `.env` (or your platform’s environment tab) | **your password manager** |

The database stores only each image’s URL. A dump without the uploads
restores every post and none of its pictures — and nothing looks wrong until
someone opens a post. `backup.sh` therefore takes both, with one timestamp, and
`restore.sh` puts both back.

Secrets are set by you, not generated at runtime, and aren’t in either
archive: losing `.env` with the server is losing `BETTER_AUTH_SECRET`, which
signs everyone out and makes stored two-factor secrets unreadable. Keep a copy
somewhere that isn’t the server.

Four rules:

1. **Nightly, automatic.** `backup.sh` from cron.
2. **Off the server.** A backup on the same disk dies with it. `rclone` copies
   both files to any S3-compatible storage — including one you run yourself
   (MinIO, Garage) on another machine.
3. **Checked at the destination**, not by the job’s own exit status
   ([below](#check-the-destination-not-the-job)).
4. **Rehearsed.** `restore.sh --rehearse` restores into a scratch database,
   unpacks the uploads into a scratch folder, and counts both. Do it once now,
   then monthly.

## Nightly backup

`backup.sh`:

1. runs `pg_dump --format=custom` (compressed; restore one table or all) and
   checks the dump with `pg_restore --list`;
2. archives the uploads (`tar.gz`, paths relative to the folder) and checks
   that the archive reads back, printing its file count — and a **warning**
   when it has no files but the previous archive had some;
3. keeps 14 days locally and optionally copies both off-site.

With docker compose it runs `pg_dump` inside the `postgres` container (the
client always matches the server), and reads the uploads through a one-off
container of the `app` service — so compose finds the volume, and the script
can never archive a mistyped, empty volume and call it a success. With
`DATABASE_URL` set (plain Node, a managed Postgres) it uses your local
`pg_dump` and the folder in `UPLOADS_DIR` — see
[Plain Node or a managed Postgres](#plain-node-or-a-managed-postgres).

Files are named `<project>-<UTC stamp>.dump` and
`<project>-<UTC stamp>.uploads.tar.gz`, where `<project>` is the compose
project name (`COMPOSE_PROJECT_NAME` in `.env` — `example-com` if you ran
setup with `--domain example.com` — else `openshipkit`). `ls /var/backups/openshipkit`
shows yours; the commands below write it as `<project>`.

```bash
cd /opt/openshipkit                  # your checkout
sudo mkdir -p /var/backups/openshipkit && sudo chown "$USER" /var/backups/openshipkit
./deploy/backups/backup.sh          # once by hand: check it works
ls -lh /var/backups/openshipkit
```

Schedule it (`crontab -e` as the deploy user — it needs to run `docker`):

```cron
17 3 * * * /opt/openshipkit/deploy/backups/backup.sh >> /var/log/openshipkit-backup.log 2>&1
```

(Create the log file first: `sudo touch /var/log/openshipkit-backup.log && sudo chown "$USER" /var/log/openshipkit-backup.log`.)

Settings come from the environment or from `/etc/openshipkit/backup.env`
(`BACKUP_ENV_FILE` moves it) — outside the repository, so `git pull` never
touches it:

| Variable | Default | What |
|---|---|---|
| `BACKUP_DIR` | `/var/backups/openshipkit` | where backups go (created mode 700, files 600) |
| `KEEP_DAYS` | `14` | local files older than this are deleted |
| `RCLONE_REMOTE` | — | e.g. `offsite:openshipkit-backups`; off-site copy when set |
| `RCLONE_KEEP_DAYS` | `60` | remote files older than this are deleted (`0` keeps all) |
| `COMPOSE_SERVICE` | `postgres` | the database’s compose service |
| `COMPOSE_APP_SERVICE` | `app` | the app’s compose service (the uploads are read through it) |
| `BACKUP_UPLOADS` | `true` | `false` only when uploads are stored somewhere with its own backup |
| `UPLOADS_DIR` | `/opt/openshipkit/uploads` | with `DATABASE_URL`: the uploads folder (the app’s value) |
| `DATABASE_URL` | — | set it to dump a Postgres server directly instead of the compose service |
| `BACKUP_PREFIX` | the compose project name, else `openshipkit` | the files’ name prefix; retention only deletes its own |

**Fourteen days is a floor, not a target.** The window that matters isn’t
“how long ago did the disk die” but how long a silent mistake can go
unnoticed: a deleted post is noticed in minutes (and `/admin/audit` can bring
it back); a bad migration that emptied a column is noticed when someone reads
the page it fed, which can be weeks. Keep more off-site (`RCLONE_KEEP_DAYS`).

**Large media libraries.** The uploads archive is a full copy every night.
Fine for a few hundred megabytes; past a few gigabytes, set
`BACKUP_UPLOADS=false` and copy the folder incrementally instead
(`rclone sync` of the volume’s folder, or your platform’s volume backup with
versioning on) — and include that copy in your restore rehearsal.

**Upgrading from an earlier `backup.sh`** that named every dump
`openshipkit-<stamp>.dump`: on a site whose `COMPOSE_PROJECT_NAME` isn’t
`openshipkit`, new dumps take the project’s name and the old ones are no longer
pruned. Delete them by hand once you have two weeks of new ones, or set
`BACKUP_PREFIX=openshipkit` in `backup.env` to keep the old name.

## Plain Node or a managed Postgres

With the [plain-Node guide](../node/README.md) the checkout is
`/opt/openshipkit/app`, there is no Docker, `DATABASE_URL` lives in
`/opt/openshipkit/openshipkit.env` (which only the `openshipkit` user can read),
and the images in `/opt/openshipkit/uploads`. Give the backup its own copy of
the URL, readable by whoever runs the cron job (here the `openshipkit` user,
which already owns the app and its uploads):

```bash
sudo apt -y install postgresql-client        # pg_dump, pg_restore, psql
sudo mkdir -p /etc/openshipkit /var/backups/openshipkit
sudo chown openshipkit /var/backups/openshipkit
sudo install -m 600 -o openshipkit /dev/null /etc/openshipkit/backup.env      # private before it holds the password
sudo grep -E '^(DATABASE_URL|UPLOADS_DIR)=' /opt/openshipkit/openshipkit.env | sudo tee -a /etc/openshipkit/backup.env > /dev/null
sudo install -m 640 -o openshipkit /dev/null /var/log/openshipkit-backup.log
sudo -u openshipkit /opt/openshipkit/app/deploy/backups/backup.sh     # once by hand
```

(Change the password or `UPLOADS_DIR` in `openshipkit.env` later? Change it here too.)

`pg_dump` must be at least as new as the server: for a managed Postgres newer
than your distribution’s client, install the matching `postgresql-client-<major>`
from the PostgreSQL apt repository (apt.postgresql.org). Schedule it as that
user (`sudo crontab -u openshipkit -e`), with the log file owned by `openshipkit`:

```cron
17 3 * * * /opt/openshipkit/app/deploy/backups/backup.sh >> /var/log/openshipkit-backup.log 2>&1
```

`restore.sh` takes `DATABASE_URL` and `UPLOADS_DIR` from the environment, not
from `backup.env`, so load the file for it:

```bash
sudo -u openshipkit bash -c 'set -a; . /etc/openshipkit/backup.env; /opt/openshipkit/app/deploy/backups/restore.sh --rehearse /var/backups/openshipkit/openshipkit-<stamp>.dump'
```

## Two sites on one server

Each copy of OpenShipKit has its own `COMPOSE_PROJECT_NAME`, so its files get
their own prefix and retention never touches the other site’s. Give each site
its own settings file (an off-site remote or `KEEP_DAYS` per site) and its own
cron minute, so the two backups don’t run at once:

```cron
17 3 * * * BACKUP_ENV_FILE=/etc/openshipkit/site-a.env /opt/site-a/deploy/backups/backup.sh >> /var/log/site-a-backup.log 2>&1
47 3 * * * BACKUP_ENV_FILE=/etc/openshipkit/site-b.env /opt/site-b/deploy/backups/backup.sh >> /var/log/site-b-backup.log 2>&1
```

With `DATABASE_URL` (no compose project to name the files), set
`BACKUP_PREFIX` and `UPLOADS_DIR` in each file, or a separate `BACKUP_DIR`.

## Off-site copy with rclone

Install rclone (`sudo apt -y install rclone`, or the current release from
rclone.org) and add a remote for your storage. Any S3-compatible service
works — a bucket at a storage provider, or MinIO / Garage on a machine you
control in another location:

```bash
rclone config create offsite s3 \
  provider=Other \
  endpoint=https://s3.your-storage.example \
  access_key_id=… secret_access_key=… \
  acl=private
rclone mkdir offsite:openshipkit-backups
```

For MinIO use `provider=Minio`; for Garage `provider=Other` with
`region=garage` (or whatever `s3_region` your Garage sets). Then:

```bash
sudo mkdir -p /etc/openshipkit
echo 'RCLONE_REMOTE=offsite:openshipkit-backups' | sudo tee -a /etc/openshipkit/backup.env
./deploy/backups/backup.sh
rclone ls offsite:openshipkit-backups
```

**A backup is personal data.** The dump holds every user’s email, every
session and every contact message. Treat the bucket accordingly:

- Give the storage key access to that one bucket only — and, if the provider
  allows it, permission to write objects but not to list, read or delete them.
  A leaked write-only key costs nothing; a leaked read-write key is your whole
  user table. (`backup.sh` prunes old remote files with `rclone delete`; with a
  write-only key, set `RCLONE_KEEP_DAYS=0` and let a bucket lifecycle rule
  expire them instead.)
- Turn on object lock or versioning if the provider supports it: an attacker
  who reaches the server reaches its backup credentials, and only a
  destination those credentials can’t overwrite survives that.
- Want the files encrypted at rest on storage you don’t control? Wrap the
  remote in an rclone `crypt` remote and point `RCLONE_REMOTE` at that.
- If your privacy policy promises a retention period, backups are part of it:
  deleting a row doesn’t delete it from sixty days of dumps.
- `.gitignore` and `.dockerignore` exclude `*.dump`, `*.sql.gz`,
  `*.uploads.tar.gz` and `backups/` so a stray copy never lands in git or an
  image. Don’t narrow those entries.

## Check the destination, not the job

A backup job’s exit status, and the tool’s own “last run: success”, are
evidence of very little. Each of these produces a green run and no usable
backup:

- The storage credentials expired. Some tools log the failed upload at a
  level nobody reads and still mark the run complete.
- The upload went to a different prefix or bucket than the one you check (a
  platform default, a typo), so the files are somewhere — just not where a
  restore will look.
- The destination is full, and the object is truncated at the bytes that fit.
- The uploads were read from the wrong place: an empty folder archives
  cleanly and exits 0. (`backup.sh` prints the file count and warns when it
  drops to zero; a hand-rolled job won’t.)

And two failures of the *reporting*, worse because they teach you to distrust
the wrong thing: a backup tool’s “list backups” screen can show nothing for a
job that did upload (it lists by the prefix it believes it wrote to), and some
backup types write no log at all — so “no log” reads the same as “never ran”.

So look at the bucket with a client that isn’t the backup job, on a schedule
you keep:

```bash
rclone lsl offsite:openshipkit-backups | sort -k2,3 | tail -n 6   # newest files, with sizes
```

Is there a `.dump` **and** an `.uploads.tar.gz` from last night, and are they
plausible sizes? Watch the trend more than the number: a dump that was 400 KB
yesterday and 12 KB today is a partial dump; a size that hasn’t moved in a
month while you’ve been publishing is a job pointed at nothing.

## What `pg_dump` doesn’t include

`pg_dump` dumps one database. Roles, their passwords and settings, and
tablespaces are cluster-level and not in it. As OpenShipKit ships that costs
nothing — there is one role, created by the Postgres image (or by you, in the
plain-Node guide), recreated identically on a new server.

It starts to matter the day you add a second role (a read-only role for a
database GUI or a reporting tool): after a rebuild the dump restores
perfectly, and every connection using that role fails to log in. Either keep
the `CREATE ROLE` statements in a checked-in SQL file and make “recreate the
roles” a step of your rebuild, or dump the globals too, on the same schedule:

```bash
docker compose exec -T postgres sh -c 'pg_dumpall --globals-only -U "$POSTGRES_USER"' | gzip > globals-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
```

(It contains password hashes: same care as the dumps.)

## Restore rehearsal (do this now)

```bash
./deploy/backups/restore.sh --rehearse /var/backups/openshipkit/<project>-<stamp>.dump
```

It creates a scratch database `openshipkit_restore_check` next to the live one,
restores the dump into it, prints row counts (users, posts, plans,
subscriptions, audit log) and the number of applied migrations, then drops it.
It unpacks the uploads archive taken with that dump into a temporary folder
and counts the files, then deletes it. The live database and uploads are never
touched. With `DATABASE_URL`, its role needs `CREATEDB` to make the scratch
database (the [plain-Node guide](../node/README.md) creates it that way;
otherwise `sudo -u postgres psql -c 'ALTER ROLE openshipkit CREATEDB'`, or run
the rehearsal with a superuser’s URL). To rehearse an off-site copy:

```bash
rclone copy offsite:openshipkit-backups/ /tmp/rehearse/ --include '<project>-<stamp>.*'
./deploy/backups/restore.sh --rehearse /tmp/rehearse/<project>-<stamp>.dump
```

The counts are the assertion — a restore that “completed” without them proves
nothing. Compare them with the live site: users and posts against `/admin`,
the file count against the live folder
(`docker compose exec app sh -c 'find /app/uploads -type f | wc -l'`). Write
down the date and the counts. If the rehearsal fails, your backups don’t work
— fix that before anything else.

## Restoring for real

```bash
./deploy/backups/restore.sh --replace /var/backups/openshipkit/<project>-<stamp>.dump
```

It asks you to type the database name, stops the app, drops the `public` and
`drizzle` schemas, restores the dump, empties the uploads and unpacks the
archive taken with that dump, and starts the app again. (If the app wasn’t
running — a new server, or a Postgres major upgrade — it stays stopped and the
script tells you to start it.) Everything written since that backup is lost —
take a fresh `backup.sh` first if the site is still readable.

Under compose the uploads are unpacked by a one-off container of the `app`
service, as the app’s own user, so the files belong to it. (Unpacked as root,
they’d leave the app unable to replace them: every image would show, and the
next upload would fail with `EACCES`.) No uploads archive next to the dump —
an older backup, or `BACKUP_UPLOADS=false`? The script says so and restores
the database only; `--uploads <archive>` names one explicitly, `--no-uploads`
skips them.

On a **new server**: follow the [VPS guide](../vps/README.md) up to
`docker compose up -d postgres`, copy your old `.env` (same
`BETTER_AUTH_SECRET`, or everyone is signed out and two-factor stops working),
build the app image (`docker compose build app` — the uploads restore runs in
it), restore with `--replace`, then `docker compose --profile https up -d --build`.
The `migrate` step applies any migrations newer than the dump. Restore before
the app first starts against the empty database: it would migrate and seed it,
only for the restore to drop and recreate everything underneath — harmless,
but confusing to read afterwards.

### After any restore

- `docker compose logs migrate` — “Up to date” means the dump and the code
  agree; otherwise it lists the migrations it applied on top of the dump.
- Open a post with a cover image. That one page exercises both halves: the
  row came from the dump, the image from the uploads archive.
- Sign in to `/admin`. With the same `BETTER_AUTH_SECRET` sessions survive; a
  new one signs everyone out, which is correct and the only symptom.
- Send the contact form once and check it reaches `/admin/feedback` — the one
  write path a stranger has, and the one a restore can break unnoticed.
- `npm run smoke -- https://example.com` from your machine.

## Also worth backing up

- `.env` — in a password manager, not next to the dumps.
- The `caddy_data` volume is optional: Caddy re-issues certificates on a new
  server (mind Let’s Encrypt’s rate limits if you rebuild often).

## Deliberately not here

- **Point-in-time recovery** (WAL archiving): “restore to 14:32” is a real
  operational commitment — an archive command that can fail quietly and fill
  the disk, a longer restore procedure, a second thing to monitor. A nightly
  dump loses at most a day; add PITR when a day of data is worth that machinery.
- **The build output and `node_modules`**: both come back from git and
  `package-lock.json`, which is why the lockfile is committed.
- **Automated restores**: a restore that runs without a human can run by
  accident. `--replace` asks you to type the database name.
