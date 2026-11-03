#!/usr/bin/env bash
#
# Build and migrate OpenShipKit on a plain-Node server (deploy/node/README.md).
#
#   bash deploy/node/deploy.sh               install → build → migrate → seed → restart
#   bash deploy/node/deploy.sh --no-restart  everything except the restart
#
# Run from the checkout as the app user. ENV_FILE (default
# /opt/openshipkit/openshipkit.env — outside the checkout, so `next build` never
# loads it) is passed to the migration with Node's --env-file; the build itself
# needs no environment. Stops at the first failure, so a failed migration
# never restarts the app onto new code.
#
set -euo pipefail

cd "$(dirname "$0")/../.."
ENV_FILE="${ENV_FILE:-/opt/openshipkit/openshipkit.env}"
RESTART=1
[[ "${1:-}" == "--no-restart" ]] && RESTART=0

if [[ ! -f "$ENV_FILE" ]]; then
  echo "deploy: $ENV_FILE not found (see deploy/node/README.md)" >&2
  exit 1
fi
# Uploads default to .data/uploads under the working directory — inside
# .next/standalone here, which every build replaces. Say so before it costs images.
UPLOADS=$(sed -n 's/^UPLOADS_DIR=//p' "$ENV_FILE" | tail -n 1)
if [[ -z "$UPLOADS" ]]; then
  echo "deploy: warning: UPLOADS_DIR isn't set in $ENV_FILE — uploaded images would be lost on the next build." >&2
  echo "        Set UPLOADS_DIR=/opt/openshipkit/uploads (deploy/node/README.md, step 3)." >&2
elif [[ ! -w "$UPLOADS" ]]; then
  echo "deploy: warning: $UPLOADS doesn't exist or isn't writable by $(id -un): uploads will fail." >&2
fi

echo "==> npm ci"
npm ci --no-audit --no-fund

echo "==> next build"
# No app secrets at build time: everything is read at runtime.
NEXT_TELEMETRY_DISABLED=1 npm run build

echo "==> assets into the standalone server"
# The standalone output doesn't include static assets or public/.
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
if [[ -d public ]]; then
  rm -rf .next/standalone/public
  cp -r public .next/standalone/public
fi
mkdir -p .next/standalone/.next/cache

echo "==> migrate + seed"
# The package.json db:* scripts, with the env file loaded by Node (it parses
# values like `EMAIL_FROM=Name <a@b.c>` that a shell `source` would not).
run() { NODE_ENV=production node --env-file="$ENV_FILE" --conditions=react-server --import tsx "$@"; }
run scripts/db-migrate.mts
run scripts/seed.mts

if [[ "$RESTART" == 1 ]]; then
  echo "==> restart"
  sudo systemctl restart openshipkit
  sleep 3
  PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -n 1)
  curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" && echo
fi
echo "==> done"
