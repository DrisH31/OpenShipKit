#!/usr/bin/env bash
#
# Restore an OpenShipKit backup made by backup.sh: the database dump and the
# uploads archive taken with it.
#
#   ./deploy/backups/restore.sh --rehearse <file.dump> [--uploads <archive> | --no-uploads]
#       restore into a scratch database, count rows, drop it; unpack the uploads into a temp folder, count files
#   ./deploy/backups/restore.sh --replace  <file.dump> [--uploads <archive> | --no-uploads]
#       REPLACE the live database and uploads (stops the app first)
#
# The uploads archive defaults to the one taken with the dump:
# <prefix>-<stamp>.uploads.tar.gz next to <prefix>-<stamp>.dump. Without one
# (an older backup, or BACKUP_UPLOADS=false) the script says so and restores
# the database only — the images then stay as they are.
#
# --rehearse is safe to run any time, on the live server: it never touches the
# app's database or its uploads. Do it monthly — a backup you haven't restored
# is a hope.
#
# --replace drops every object in the database and restores the dump into it,
# then empties the uploads and unpacks the archive. A running app is stopped
# for the duration and started again after; when no app container is running
# (say, after `docker compose down` during a Postgres major upgrade) it is left
# alone, and you start it yourself. Under compose the uploads are written
# through a one-off container of the app service, AS the app's user, so the
# restored files are owned by it (unpacking as root leaves files the app can't
# replace: uploads then fail with EACCES while every image still shows).
#
# Same two modes as backup.sh: docker compose (default) or DATABASE_URL (then
# UPLOADS_DIR, default /opt/openshipkit/uploads, names the uploads folder).
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
COMPOSE_APP_SERVICE="${COMPOSE_APP_SERVICE:-app}"
MODE="${1:-}"
DUMP="${2:-}"
UPLOADS_ARCHIVE="${DUMP%.dump}.uploads.tar.gz"
UPLOADS_GIVEN=0
case "${3:-}" in
  "") ;;
  --uploads) UPLOADS_ARCHIVE="${4:-}"; UPLOADS_GIVEN=1 ;;
  --no-uploads) UPLOADS_ARCHIVE="" ;;
  *) MODE="" ;;
esac

usage() { sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[[ "$MODE" == "--rehearse" || "$MODE" == "--replace" ]] || usage
[[ -f "$DUMP" ]] || { echo "restore: no such file: $DUMP" >&2; exit 2; }
log() { echo "[$(date -u +%FT%TZ)] $*"; }
if [[ -n "$UPLOADS_ARCHIVE" && ! -f "$UPLOADS_ARCHIVE" ]]; then
  if [[ "$UPLOADS_GIVEN" == 1 ]]; then echo "restore: no such file: $UPLOADS_ARCHIVE" >&2; exit 2; fi
  log "no uploads archive next to the dump ($(basename "$UPLOADS_ARCHIVE")): database only — images are left as they are"
  UPLOADS_ARCHIVE=""
fi
count_files() { tar -tzf "$1" | grep -vc '/$' || true; }

# psql / pg_restore against a named database, in whichever mode applies.
if [[ -n "${DATABASE_URL:-}" ]]; then
  base_url() { echo "${DATABASE_URL%/*}/$1"; }
  sql() { psql --no-psqlrc -v ON_ERROR_STOP=1 -At --dbname="$(base_url "$1")" -c "$2"; }
  restore_into() { pg_restore --no-owner --no-privileges --exit-on-error --dbname="$(base_url "$1")" "$DUMP"; }
  LIVE_DB="${DATABASE_URL##*/}"; LIVE_DB="${LIVE_DB%%\?*}"
  stop_app() { log "stop the app yourself (e.g. sudo systemctl stop openshipkit), then press Enter"; read -r; }
  start_app() { log "start the app again (e.g. sudo systemctl start openshipkit)"; }
  UPLOADS_DIR="${UPLOADS_DIR:-/opt/openshipkit/uploads}"
  replace_uploads() {
    mkdir -p "$UPLOADS_DIR"
    find "$UPLOADS_DIR" -mindepth 1 -delete
    tar -xzf "$UPLOADS_ARCHIVE" -C "$UPLOADS_DIR"
  }
else
  cd "$ROOT"
  sql() { docker compose exec -T "$COMPOSE_SERVICE" sh -c "psql --no-psqlrc -v ON_ERROR_STOP=1 -At -U \"\$POSTGRES_USER\" -d '$1' -c \"$2\""; }
  restore_into() { docker compose exec -T "$COMPOSE_SERVICE" sh -c "pg_restore --no-owner --no-privileges --exit-on-error -U \"\$POSTGRES_USER\" -d '$1'" < "$DUMP"; }
  LIVE_DB="$(docker compose exec -T "$COMPOSE_SERVICE" sh -c 'echo "$POSTGRES_DB"' | tr -d '\r')"
  # Only touch an app container that is running now: after `docker compose down`
  # there is none, and `docker compose start app` would fail after a good restore.
  APP_RUNNING="$(docker compose ps -q --status running app 2>/dev/null || true)"
  stop_app() { if [[ -n "$APP_RUNNING" ]]; then docker compose stop app; else log "the app isn't running; leaving it stopped"; fi; }
  start_app() { if [[ -n "$APP_RUNNING" ]]; then docker compose start app; else log "start the app when you're ready: docker compose up -d"; fi; }
  # A one-off container of the app service: its uploads volume (compose names
  # it), as its user (so the files are the app's). Needs the app image built.
  replace_uploads() {
    docker compose run --rm --no-deps -T --entrypoint sh "$COMPOSE_APP_SERVICE" \
      -c 'find /app/uploads -mindepth 1 -delete && tar -xzf - -C /app/uploads' < "$UPLOADS_ARCHIVE"
  }
fi

counts() {
  sql "$1" "select 'users', count(*) from users union all select 'posts', count(*) from posts union all select 'plans', count(*) from plans union all select 'subscriptions', count(*) from subscriptions union all select 'audit_log', count(*) from audit_log" \
    | sed 's/|/ /' | column -t
}

if [[ "$MODE" == "--rehearse" ]]; then
  SCRATCH="openshipkit_restore_check"
  log "rehearsal: restoring $DUMP into a scratch database '$SCRATCH'"
  sql "$LIVE_DB" "drop database if exists $SCRATCH" > /dev/null
  if ! sql "$LIVE_DB" "create database $SCRATCH" > /dev/null; then
    echo "restore: couldn't create the scratch database. With DATABASE_URL, its role needs CREATEDB" >&2
    echo "  (sudo -u postgres psql -c 'ALTER ROLE <role> CREATEDB'), or run the rehearsal with a superuser's DATABASE_URL." >&2
    exit 1
  fi
  trap 'sql "$LIVE_DB" "drop database if exists $SCRATCH" > /dev/null; log "scratch database dropped"' EXIT
  restore_into "$SCRATCH"
  log "restored. Row counts in the backup:"
  counts "$SCRATCH" || log "(couldn't count — table names changed? the restore itself succeeded)"
  log "migrations recorded: $(sql "$SCRATCH" 'select count(*) from drizzle.__drizzle_migrations')"
  if [[ -n "$UPLOADS_ARCHIVE" ]]; then
    # Unpack for real (a listing alone doesn't prove the bytes come back), count, discard.
    UNPACKED="$(mktemp -d)"
    trap 'sql "$LIVE_DB" "drop database if exists $SCRATCH" > /dev/null; rm -rf "$UNPACKED"; log "scratch database and folder removed"' EXIT
    tar -xzf "$UPLOADS_ARCHIVE" -C "$UNPACKED"
    log "uploads: $(find "$UNPACKED" -type f | wc -l | tr -d ' ') files unpacked from $(basename "$UPLOADS_ARCHIVE") ($(du -sh "$UNPACKED" | cut -f1))"
  fi
  log "rehearsal passed"
  exit 0
fi

log "REPLACING database '$LIVE_DB' with $DUMP${UPLOADS_ARCHIVE:+, and the uploads with $(basename "$UPLOADS_ARCHIVE")}"
read -r -p "Type the database name to confirm: " CONFIRM
[[ "$CONFIRM" == "$LIVE_DB" ]] || { echo "restore: not confirmed" >&2; exit 1; }
stop_app
trap start_app EXIT
sql "$LIVE_DB" "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public" > /dev/null
restore_into "$LIVE_DB"
log "restored. Row counts now:"
counts "$LIVE_DB" || true
if [[ -n "$UPLOADS_ARCHIVE" ]]; then
  log "replacing the uploads with $(basename "$UPLOADS_ARCHIVE") ($(count_files "$UPLOADS_ARCHIVE") files)"
  replace_uploads
fi
log "done"
