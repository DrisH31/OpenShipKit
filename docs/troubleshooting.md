# Troubleshooting

Fixes for the errors people actually hit, listed by the message you see: the
embedded database lock, a refused secret, a failed migration, certificates,
sign-in loops, emails that don’t arrive, a payment without access, uploads and
MCP. If yours isn’t here, search the issues or open one with the steps to
reproduce (remove secrets from logs first).

## Development

**“The embedded database at … is in use by another process (pid …)”**
Only one process can use `.data/pglite` at a time. The message names the
holder — usually `npm run dev` while you ran `db:migrate`, `db:seed` or
`mcp:key`. Stop it, or mint keys in `/admin/agents` instead. A lock left by a
crashed process is detected and taken over automatically.

**I want a clean database**
Stop the dev server, `rm -rf .data/pglite`, start again — it migrates and seeds.

**Port 3000 is in use**
`npm run dev -- -p 3001`, and set `NEXT_PUBLIC_SITE_URL=http://localhost:3001`
in `.env.local` so links and auth callbacks match.

**Sign-up works but I’m not an admin**
Your email must be in `ADMIN_EMAILS` (in `.env.local`, then restart the dev
server). Promotion happens on your next request while signed in.

**Where’s the verification / reset email?**
In development emails print to the terminal running `npm run dev`. Look for the
link in the log. In production the log shows only To and Subject (see
“Verification emails don’t arrive” below).

**`npm run setup -- --env-file .env` fails with “not found”**
Node itself claims `--env-file`. Use `npm run setup -- --compose` (writes
`.env`) or `--file <path>`.

**Type errors about Next.js APIs**
Next.js 16: `params`, `searchParams`, `cookies()` and `headers()` are async
(`await` them), and middleware is `src/proxy.ts`. The bundled docs are in
`node_modules/next/dist/docs/`.

## Production

**The app exits: “DATABASE_URL is not set”**
Production refuses the embedded database. Set `DATABASE_URL` (compose builds it
from `POSTGRES_*` — check `.env` has `POSTGRES_PASSWORD`).

**“[openshipkit] BETTER_AUTH_SECRET is not set.” / “… is 20 characters; it needs at least 32.” / “… is placeholder text.” / “… repeats a few characters” — then “Refusing to start”**
Production refuses a missing or weak session secret. Generate one with
`openssl rand -base64 32` (44 characters), put it in `.env` (compose) or your
environment file, then `docker compose up -d` (or restart the service). Under
docker compose a missing one stops earlier, with compose’s own message: *Set
BETTER_AUTH_SECRET in .env (npm run setup -- --compose)*. Changing the secret
signs everyone out and breaks stored two-factor secrets — on a running site,
rotate it instead ([auth.md](auth.md#rotating-the-secret)).

**`migrate` fails, the app never starts**
`docker compose logs migrate` has the real cause. Common ones:
- *password authentication failed*: the Postgres volume was created with a
  different `POSTGRES_PASSWORD`. Postgres keeps the password it was created
  with; put the old one back, or change it inside:
  `docker compose exec postgres psql -U openshipkit -c "ALTER USER openshipkit PASSWORD '<new>'"`.
- *connection refused*: Postgres isn’t healthy yet or is out of disk — `docker compose ps`, `df -h`.

**Caddy can’t get a certificate**
`docker compose logs caddy`. The domain’s `A`/`AAAA` record must point at this
server (`dig +short example.com`), ports 80 and 443 must be open (`ufw status`),
and `DOMAIN` in `.env` must be the bare host name. Too many retries can hit
Let’s Encrypt rate limits — fix DNS first, then restart Caddy once.

**Signed in, then immediately signed out / redirect loop**
`NEXT_PUBLIC_SITE_URL` must be exactly the origin in the address bar
(`https`, www or not). Behind your own proxy, pass `X-Forwarded-Proto` and
`Host`.

**Verification emails don’t arrive**
Without `RESEND_API_KEY` nothing is sent, and production logs only each
email’s To and Subject, never the link. Set up Resend
([email.md](email.md)); to verify the first admin before that, set
`EMAIL_CONSOLE_PRINT_BODIES=true` briefly
([email.md](email.md#no-resend-yet-verifying-the-first-admin)). With Resend: the
domain must be verified in Resend and `EMAIL_FROM` must use it. The app log has
Resend’s error. [email.md](email.md).

**A customer paid but has no access**
Access comes only from the webhook. In Polar, check the endpoint’s deliveries:
URL `https://<your-domain>/api/billing/webhook`, format Raw, status codes.
`403` = wrong `POLAR_WEBHOOK_SECRET`; `404` = billing is off (no
`POLAR_ACCESS_TOKEN`); `500` = see the app log. Polar retries failed
deliveries; you can redeliver from its dashboard. [billing.md](billing.md).

**Checkout says the plan can’t be bought**
That price has no Polar product id. Set it in `/admin/plans` (sandbox and
production ids differ).

**Every visitor shares one rate limit / everyone is “unknown”**
Your proxy isn’t passing `X-Forwarded-For`. Caddy does by default; nginx needs
`proxy_set_header X-Forwarded-For $remote_addr;`.

**`/api/health` returns 503**
The database didn’t answer within 5 seconds. `docker compose ps postgres`,
`docker compose logs postgres`, and disk space.

**Every page says “Something went wrong” (HTTP 500), including the home page**
The database is unreachable — `/api/health` answers 503 at the same time; fix
it as above. This is on purpose (SPEC invariant 3): when a read fails, the
page fails rather than fall back to the template’s default copy, which on a
renamed site is another product’s name and description served with a 200.
The error page is `noindex`, and crawlers retry a 500, so a short outage costs
nothing in search. Monitor `/api/health`, not `/`. If health is 200 and pages
still fail, the app log has the error (the page shows only a digest to match
it by).

**The landing page is missing its “Latest posts” band**
Either the section is off (`/admin/content/latestPosts`), there is no
published **listed** post (unlisted ones are never promoted), or reading the
posts failed — then the app log has `[landing] latest posts unavailable`.
On a renamed site, starter posts still in OpenShipKit’s words are left out too.

**The sitemap or canonical URLs say localhost**
`NEXT_PUBLIC_SITE_URL` isn’t set in the app’s environment. It’s read at
runtime: set it and restart; no rebuild needed.

**Uploading an image fails (“check that the uploads folder exists and is writable”)**
The app can’t write to `UPLOADS_DIR`. Under compose: the `uploads` volume was
created root-owned (by an older image, or a bind mount) — fix it once with
`docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /app/uploads`.
On plain Node: create the folder for the app user
(`sudo install -d -o openshipkit -g openshipkit /opt/openshipkit/uploads`) and
check `ReadWritePaths` in the systemd unit names it.

**Images are gone after a deploy**
`UPLOADS_DIR` wasn’t on persistent storage: the container’s filesystem (or
`.next/standalone`, on plain Node) is replaced on every deploy. Use the
compose `uploads` volume, or a folder outside the checkout; restore the images
from the last uploads archive ([deploy/backups](../deploy/backups/README.md)).

**An upload is refused**
The refusal says why: the file is empty, over 5 MB, an SVG (never accepted:
an SVG can carry script that would run on your domain), not a PNG, JPEG,
WebP, AVIF or GIF *by its contents* (the extension doesn’t count), or its
claimed type disagrees with its contents. Convert it (e.g. to WebP) and try
again. Behind nginx, a `413 Request Entity Too Large` before the app answers
means `client_max_body_size` is under 6 MB for `/api/admin/media`
([deployment.md](deployment.md#required-in-production)).

**“Delete” on an image in `/admin/media` is refused**
A post (its cover or its body) or a content section still uses it — a broken
image is worse than a spare file. The refusal names where; change those
first, then delete.

**Images are broken after a restore**
The database came back without its uploads (or from a different day). Restore
the `.uploads.tar.gz` taken with that dump: `restore.sh --replace <dump>` does
both when the archive sits next to the dump.

**`npm run e2e` says the account already exists**
A run that crashed before its clean-up left it. Delete it in `/admin/users`
(and its post, if any, in `/admin/posts`), or pass another `--email`.

## MCP

**401 from `/api/mcp`**
Send `Authorization: Bearer osk_…`. A revoked key is 401. `MCP_DEV_KEY` works
only in development on the embedded database — on a server, mint a key in
`/admin/agents`.

**A tool is missing from the list**
Tools are filtered by the key’s scope (`read` < `write` < `admin`). Mint a key
with the scope the tool needs. [mcp.md](mcp.md).

## Setting up with an agent

**The agent can’t see the `openshipkit` tools**
The key has to be in the environment of the shell that *started* the agent,
and the agent reads its MCP config only at start. Quit it,
`export OPENSHIPKIT_MCP_KEY=…` (the `MCP_DEV_KEY` from `.env.local` locally),
add `OPENSHIPKIT_MCP_URL` for a deployed site, start it again in the project
folder and approve the server. In Claude Code, `/mcp` shows why a server
failed.

**The agent edits `src/content/defaults.ts` and nothing changes**
Stored content overrides the defaults, so once a section has been saved, the
defaults no longer show. Ask the agent to use the MCP `content_*` tools
instead ([ai-setup.md](ai-setup.md), step 2).

**The agent’s `db:migrate` or `mcp:key` says the database is in use**
The embedded database allows one process, and the agent’s dev server holds it.
The dev server migrates and seeds itself on start. Mint keys in
`/admin/agents`.

**An agent run left test data behind**
Everything it changed is in `/admin/audit` under its key’s name. Content,
posts and plans can be restored from there. Users and feedback can’t: delete
a test account in `/admin/users`, and close a test message in
`/admin/feedback` (feedback has no delete).

## Still stuck

Run `npm run smoke -- <your-url>` and include its output in an issue, with
your OpenShipKit version (or commit), how you deploy, and the relevant log lines.
