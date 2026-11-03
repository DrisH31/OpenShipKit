# syntax=docker/dockerfile:1
#
# OpenShipKit — one image, two runnable targets.
#
#   runner    (default) the Next.js standalone server: `node server.js` as the
#             non-root `node` user, with a HEALTHCHECK on /api/health.
#   migrator  the full source + node_modules; runs `npm run db:migrate && npm run db:seed`
#             once per deploy, then exits. Both are safe to repeat: migrations
#             apply once, and the seed only ever fills a brand-new database.
#
#   docker build -t openshipkit .                       # the app
#   docker build -t openshipkit-migrator --target migrator .
#
# Non-obvious rules:
#   - The build needs NO environment: no secrets, no database. Every variable
#     is read at request time (src/server/env.ts), so one image runs anywhere.
#     NEXT_PUBLIC_SITE_URL is read on the server at runtime too — don't add it
#     as a build arg.
#   - Pinned to an exact Node + Alpine tag (checked on Docker Hub, 6 Oct 2026).
#     Dependabot opens a PR when a newer one ships. Keep the tag LITERAL on the
#     FROM line: Dependabot doesn't resolve ARG defaults, so `FROM ${ARG}` would
#     silently stop the updates. The same tag appears in the `docker run` setup
#     commands in README.md and deploy/vps/README.md; bump those by hand.
#   - Native packages (sharp, Next's SWC, Tailwind's oxide, lightningcss) use
#     their musl builds from package-lock.json, so no build toolchain is needed.
#   - Uploaded images live in /app/uploads (UPLOADS_DIR), which the runner
#     creates owned by `node`. Mount a NAMED volume there (docker-compose.yml
#     does): the container's own filesystem is replaced on every deploy. The
#     directory must exist in the image, owned by node, BEFORE a volume is
#     mounted: Docker seeds a new named volume from the mount point, ownership
#     included, and a root-owned one fails every upload with EACCES — at the
#     first upload, weeks later, not at boot. No VOLUME instruction: that would
#     create an anonymous volume, which backup tools don't see.
#

# ---------------------------------------------------------------- base
FROM node:24.21.0-alpine3.24 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- deps
# Every dependency, dev ones included: the build and the migrator need them.
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------------------------------------------------------------- builder
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `public/` is optional in the repository; the runner copies it either way.
RUN mkdir -p public && npm run build

# ---------------------------------------------------------------- migrator
# One-shot: apply SQL migrations from ./drizzle, then seed a brand-new database
# with the starter plans and posts (once: a `seed.run` audit entry stops later
# runs, so starter rows you deleted stay deleted). Exits non-zero on failure so
# the deploy stops before the new app starts.
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed"]

# ---------------------------------------------------------------- runner
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOADS_DIR=/app/uploads

# The standalone output is a self-contained server with only the node_modules
# it traced; static assets and public/ are copied beside it.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The official image ships a `node` user (uid 1000). The image cache under
# .next/cache must be writable by it — the chown above covers that — and so
# must the uploads folder (see the header: it must exist before the volume).
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000

# Node's fetch, so the check needs no curl/wget in the image. It asks loopback,
# so it can't tell whether the server is reachable from OUTSIDE the container:
# keep HOSTNAME=0.0.0.0 (docker-compose.yml pins it, and PORT, for the app).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "server.js"]
