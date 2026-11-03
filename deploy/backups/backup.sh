#!/usr/bin/env bash
#
# Nightly backup for OpenShipKit, both halves of the site:
#   1. Postgres: pg_dump in the custom format (compressed, restorable table by
#      table) → <prefix>-<stamp>.dump
#   2. the uploaded images (UPLOADS_DIR, the `uploads` volume under compose) →
#      <prefix>-<stamp>.uploads.tar.gz
# → local retention → optional off-site copy with rclone (any S3-compatible
# storage, including self-hosted MinIO or Garage).
#
# Why both: the database stores only the images' URLs. A dump without the
# uploads restores every post and none of its pictures; the uploads without
# the dump restore pictures nothing points at.
#
#   ./deploy/backups/backup.sh                 one backup now
#   crontab -e →  17 3 * * * /opt/openshipkit/deploy/backups/backup.sh >> /var/log/openshipkit-backup.log 2>&1
#
# Where the database is:
#   - docker compose (default): runs pg_dump INSIDE the `postgres` service, so
#     the client always matches the server version. Run from anywhere; it cds
#     to the project root.
#   - DATABASE_URL set (plain Node, a managed Postgres): runs the local
#     pg_dump against it. Install a client at least as new as the server.
#
# Settings: the environment, or BACKUP_ENV_FILE (default /etc/openshipkit/backup.env,
# outside the repository so a `git pull` never touches it):
#   BACKUP_DIR        where dumps go            (default /var/backups/openshipkit)
#   KEEP_DAYS         delete local dumps older  (default 14)
#   RCLONE_REMOTE     e.g. offsite:openshipkit-backups — off-site copy when set
#   RCLONE_KEEP_DAYS  delete remote dumps older (default 60; 0 keeps everything)
#   COMPOSE_SERVICE   compose service name      (default postgres)
#   BACKUP_PREFIX     the dump's name prefix    (default: the compose project name —
#                     COMPOSE_PROJECT_NAME from the environment or the project's
#                     .env — else openshipkit)
#   BACKUP_UPLOADS    true (default) | false — false only when uploads live
#                     somewhere with its own backup (object storage)
#   COMPOSE_APP_SERVICE  the app's compose service (default app): the uploads
#                     are read through it, so its volume is found by compose —
#                     never by a hand-typed volume name (a wrong name archives an
#                     EMPTY folder and exits 0)
#   UPLOADS_DIR       with DATABASE_URL (plain Node): the uploads folder — the
#                     same value as the app's (default /opt/openshipkit/uploads)
#
# Files are named <prefix>-<UTC stamp>.dump and <prefix>-<UTC stamp>.uploads.tar.gz
# (one stamp for the pair: restore.sh finds the archive next to its dump), and
# retention only ever deletes its own prefix, so two copies of OpenShipKit on
# one server (each with its own COMPOSE_PROJECT_NAME, as docker-compose.yml
# requires) never overwrite or prune each other's backups, even in one BACKUP_DIR.
#
# Exits non-zero on any failure (cron mails it, or your monitor sees it) and
# never leaves a half-written file under its final name. A green run is still
# not proof: check the off-site copies themselves now and then
# (deploy/backups/README.md, "Check the destination, not the job").
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/openshipkit/backup.env}"
if [[ -f "$BACKUP_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/openshipkit}"
KEEP_DAYS="${KEEP_DAYS:-14}"
RCLONE_KEEP_DAYS="${RCLONE_KEEP_DAYS:-60}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
COMPOSE_APP_SERVICE="${COMPOSE_APP_SERVICE:-app}"
BACKUP_UPLOADS="${BACKUP_UPLOADS:-true}"
# The prefix: BACKUP_PREFIX, else this checkout's compose project name (the
# environment wins over .env, as it does for docker compose), else openshipkit.
project_name() {
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
    echo "$COMPOSE_PROJECT_NAME"
  elif [[ -f "$ROOT/.env" ]]; then
    sed -n "s/^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=[[:space:]]*[\"']\{0,1\}\([^\"'#[:space:]]*\).*/\1/p" "$ROOT/.env" | tail -n 1
  fi
}
PREFIX="${BACKUP_PREFIX:-$(project_name)}"
PREFIX="${PREFIX:-openshipkit}"
if [[ ! "$PREFIX" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "backup: '$PREFIX' isn't a usable prefix (lowercase letters, digits, - and _); set BACKUP_PREFIX" >&2
  exit 2
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/$PREFIX-$STAMP.dump"
UPLOADS_FILE="$BACKUP_DIR/$PREFIX-$STAMP.uploads.tar.gz"
# Matches this prefix's files only: the stamp starts with a digit, so the
# pattern for "example" never matches "example-com-20261007T….dump".
OWN_DUMPS="$PREFIX-[0-9]*.dump"
OWN_UPLOADS="$PREFIX-[0-9]*.uploads.tar.gz"

umask 077
mkdir -p "$BACKUP_DIR"
log() { echo "[$(date -u +%FT%TZ)] $*"; }

if [[ -n "${DATABASE_URL:-}" ]]; then
  log "pg_dump from DATABASE_URL → $FILE"
  pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$FILE.partial"
else
  cd "$ROOT"
  log "pg_dump inside compose service '$COMPOSE_SERVICE' → $FILE"
  # -T: no TTY, so the binary dump isn't mangled. The credentials are the
  # container's own POSTGRES_USER / POSTGRES_DB.
  docker compose exec -T "$COMPOSE_SERVICE" sh -c \
    'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$FILE.partial"
fi

# A dump that pg_restore can't list is not a backup.
if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_restore --list "$FILE.partial" > /dev/null
else
  docker compose exec -T "$COMPOSE_SERVICE" pg_restore --list < "$FILE.partial" > /dev/null
fi
mv "$FILE.partial" "$FILE"
log "ok: $(du -h "$FILE" | cut -f1)"

# The uploads. Under compose they are read THROUGH the app service (a one-off
# container with the app's volumes, as the app's user), so compose resolves
# the volume — the project-name prefix included — and nothing here can archive
# the wrong, empty volume and call it a success. `-C <dir> .` keeps the paths
# relative, so the archive restores into any folder.
count_files() { tar -tzf "$1" | grep -vc '/$' || true; }
if [[ "$BACKUP_UPLOADS" == "true" ]]; then
  if [[ -n "${DATABASE_URL:-}" ]]; then
    UPLOADS_DIR="${UPLOADS_DIR:-/opt/openshipkit/uploads}"
    if [[ ! -d "$UPLOADS_DIR" ]]; then
      echo "backup: no uploads folder at $UPLOADS_DIR — set UPLOADS_DIR (the app's value) in $BACKUP_ENV_FILE, or BACKUP_UPLOADS=false" >&2
      exit 1
    fi
    log "uploads from $UPLOADS_DIR → $UPLOADS_FILE"
    tar -czf "$UPLOADS_FILE.partial" -C "$UPLOADS_DIR" .
  else
    log "uploads through compose service '$COMPOSE_APP_SERVICE' (its uploads volume) → $UPLOADS_FILE"
    docker compose run --rm --no-deps -T --entrypoint tar "$COMPOSE_APP_SERVICE" -czf - -C /app/uploads . > "$UPLOADS_FILE.partial"
  fi
  # An archive gzip can't read is not a backup either.
  tar -tzf "$UPLOADS_FILE.partial" > /dev/null
  mv "$UPLOADS_FILE.partial" "$UPLOADS_FILE"
  FILES="$(count_files "$UPLOADS_FILE")"
  log "ok: $(du -h "$UPLOADS_FILE" | cut -f1), $FILES files"
  # The silent failure this guards: images that existed yesterday and none today.
  PREVIOUS="$(find "$BACKUP_DIR" -maxdepth 1 -name "$OWN_UPLOADS" -type f ! -name "$(basename "$UPLOADS_FILE")" | sort | tail -n 1)"
  if [[ "$FILES" == 0 && -n "$PREVIOUS" && "$(count_files "$PREVIOUS")" != 0 ]]; then
    log "WARNING: this archive has no files, but $(basename "$PREVIOUS") had some. Check the uploads volume before the old archives expire."
  fi
fi

# Local retention.
for own in "$OWN_DUMPS" "$OWN_UPLOADS"; do
  find "$BACKUP_DIR" -maxdepth 1 -name "$own" -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/deleted /'
  find "$BACKUP_DIR" -maxdepth 1 -name "$own.partial" -type f -mmin +120 -delete
done

# Off-site copy.
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  log "rclone copy → $RCLONE_REMOTE"
  rclone copy "$FILE" "$RCLONE_REMOTE" --immutable
  if [[ -f "$UPLOADS_FILE" ]]; then rclone copy "$UPLOADS_FILE" "$RCLONE_REMOTE" --immutable; fi
  if [[ "$RCLONE_KEEP_DAYS" != 0 ]]; then
    rclone delete "$RCLONE_REMOTE" --min-age "${RCLONE_KEEP_DAYS}d" --include "$OWN_DUMPS"
    rclone delete "$RCLONE_REMOTE" --min-age "${RCLONE_KEEP_DAYS}d" --include "$OWN_UPLOADS"
  fi
fi
log "done"
