# Security

How OpenShipKit protects your users and your site, where each check lives,
and what you must do yourself. Server hardening is in
[deploy/hardening.md](../deploy/hardening.md); reporting a vulnerability is in
[SECURITY.md](../SECURITY.md).

## Who is realistically attacking it

- **Automated scanners**, looking for `/wp-admin`, an exposed `.env`, an open
  database port, default credentials. Most of the hostile traffic any site
  gets, and entirely undirected: keep the database and the app port off the
  public interface (compose binds them to `127.0.0.1`) and nothing they try
  exists here.
- **Form spam** through the few things a stranger can write: sign-up, the
  contact and newsletter forms, the feedback form.
- **Credential stuffing** against sign-in once the site is known.
- **Someone holding a stolen session, password or agent key.**

The design principle: **what a stranger sends only ever becomes a row.**
Nothing they write is executed, rendered as raw HTML (Markdown is sanitised),
used to build a file path (upload names are random), or put into SQL (Drizzle
parameterises everything). That is what makes the rate limits below a speed
bump rather than the thing holding the site together.

## Model in one table

| Threat | Defence | Where |
|---|---|---|
| Someone reaches a page they shouldn’t | `requireUser()` / `requireAdmin()` in every page **and** server action; the proxy is only a redirect convenience | `src/server/session.ts`, `src/proxy.ts` |
| A guard someone forgot | `tests/authz.test.ts` parses every admin and dashboard page, server action (inline ones too) and route handler, and fails CI unless the guard runs before anything but a pure request check. What it can't read (a re-export, a wrapped handler) fails too. A new route or public action must be listed with the reason it needs no session | `tests/authz.test.ts` |
| Probing for the admin | `/admin` 404s for signed-in non-admins (signed out, it redirects to sign-in); disallowed in robots.txt | `requireAdmin()` |
| Free access to paid features | entitlements only from signature-verified, re-fetched, idempotent Polar webhooks | `src/adapters/billing/` |
| Bad or hostile input | every write is validated by a zod schema in a service; refusals are typed `ServiceError`s | `src/server/services/` |
| Unnoticed changes | every write audited with actor, before and after; restorable | `audit_log`, `/admin/audit` |
| Stored XSS via posts | Markdown rendered with marked, then sanitized against an allowlist | `src/server/markdown.ts` |
| CSRF | Better Auth’s origin checks; billing and form routes compare `Origin` to `NEXT_PUBLIC_SITE_URL`; server actions are POST-only with Next’s origin check | `src/server/http.ts` (`isSameOrigin`), Better Auth, Next.js |
| Credential stuffing, spam | Better Auth rate limits (in Postgres) on sign-in, sign-up, 2FA and emailed links; per-IP limits on public forms and MCP | `src/adapters/auth/better-auth/instance.ts`, `src/server/rate-limit.ts` |
| Account enumeration | sign-up with an existing email sends that person an email instead of an error; reset always answers the same; email failures are logged, not shown | auth adapter |
| Stolen agent key | keys stored as SHA-256, shown once, scoped (read/write/admin), revocable; every change it makes is audited under the key’s name, and every call updates the key’s last-used time (reads leave no audit row) | `src/server/services/agent-keys.ts` |
| A web page attacking a local MCP server | `Origin` check on `/api/mcp` (DNS rebinding) | `src/server/mcp/auth.ts` |
| Leaking secrets in the build | env read lazily at runtime; the build needs none; `.dockerignore` keeps `.env*` out of images | `src/server/env.ts` |
| Clickjacking, sniffing, referrer leaks | `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, `Permissions-Policy`, COOP, HSTS in production | `next.config.ts` |
| Image optimizer abuse | short `remotePatterns` allowlist (never a wildcard host: an open optimiser is a bandwidth amplifier anyone can point anywhere), bounded disk cache | `next.config.ts` |
| A hostile upload | the bytes decide the type (magic numbers), never the filename or the claimed `Content-Type`; SVG refused (it’s a document that can run script with your cookies in scope); random names under `yyyy/mm/`, resolved and required to sit under `UPLOADS_DIR`; served with `nosniff` and a sandboxing CSP | `src/core/media.ts`, `src/server/services/media*.ts`, `src/app/uploads/` |

## Passwords, sessions, 2FA

- Passwords are hashed by Better Auth (scrypt), 8–128 characters.
- Sessions are database-backed with an HTTP-only, `SameSite=Lax` cookie
  (`Secure` on HTTPS). Users see and end their sessions in
  `/dashboard/settings`; banning a user ends their access on the next request.
- TOTP two-factor with backup codes; the TOTP secret is encrypted with
  `BETTER_AUTH_SECRET`.
- Production requires a verified email before the first sign-in.

## Admins

Roles live in the app’s `users` table. `ADMIN_EMAILS` promotes on sign-in;
nothing demotes automatically. The last admin can’t be demoted, banned or
deleted. Admin accounts should have 2FA on.

## Agents (MCP)

An agent key acts with its scope through the same services as an admin. Treat
`write` and `admin` keys like passwords. Tool descriptions tell the model that
feedback and contact messages come from the public and are data, not
instructions — but a key’s scope is the real limit: give agents `read` or
`write`, rarely `admin`. `MCP_DEV_KEY` only works in development on the
embedded database and is ignored in production.

## What you’re responsible for

- Keep `.env` secret and backed up (password manager), mode 600.
- Serve only over HTTPS, with the proxy *setting* `X-Forwarded-For`.
- Patch Next.js and Better Auth promptly (Dependabot PRs; GitHub advisories).
- Back up the database off-site and rehearse restores.
- Turn on email before real users so verification and resets work.
- Review the legal pages and your data-processing obligations (GDPR and
  similar): what you collect is in your own Postgres; Polar and Resend are
  processors only if you enable them.

## Rate limits, and their honest scope

| What | Limit | Kept in |
|---|---|---|
| Sign-in, sign-up, two-factor, emailed links (Better Auth) | per endpoint (e.g. 5 sign-ins a minute), on in production | Postgres |
| Wrong passwords per account | a lockout that a password reset clears | Postgres |
| Contact, newsletter and feedback forms; auth server actions; MCP | per IP (IPv6 by /64), fixed window | the app process (`src/server/rate-limit.ts`) |

They are speed bumps, not walls. A determined attacker rotates addresses;
what the limits stop is the accidental and the undirected — a retry loop, a
script left running, one bot hammering one form — which is most of what
happens. Two things to know before you change anything around them:

- **They key on the client address your proxy sends.** The proxy must *set*
  `X-Forwarded-For` to the client, not append to what the client sent;
  behind a CDN, make the CDN overwrite it. Otherwise the client controls the
  first entry and picks a fresh limit with every request.
- **The in-process ones multiply when you add instances** — two servers, twice
  the limit, and nothing says so. [scaling.md](scaling.md) has the fix.

## Headers, and two deliberate choices

`next.config.ts` sets `nosniff`, `X-Frame-Options: DENY`,
`strict-origin-when-cross-origin`, a `Permissions-Policy`, COOP and, in
production, HSTS; `src/proxy.ts` adds a per-request nonce CSP to pages.

- **HSTS without `preload`.** A preloaded domain refuses plain HTTP — for every
  subdomain — in every browser, and getting off the list takes months. Add
  `preload` only when every subdomain you will ever use has a certificate.
- **No `X-XSS-Protection`.** It switches on a filter every current browser has
  removed, and where it still exists it has been shown to *introduce* holes.
  The CSP is the real control.

## Secrets

- Set by you, in `.env` or your platform’s environment; never committed
  (`.gitignore` and `.dockerignore` exclude `.env*`, keys, dumps and backup
  archives — broad on purpose: a secret pushed once is a secret to rotate, even
  after a force-push). Never baked into an image: the build reads none.
- `BETTER_AUTH_SECRET` signs sessions **and** encrypts two-factor secrets.
  Rotate it with `BETTER_AUTH_SECRETS` ([auth.md](auth.md)), never by
  replacing it — a straight swap signs everyone out and makes every stored
  two-factor secret unreadable.
- Connection strings carry a password: don’t log a database error object
  whole; log its message.
- Public by design, not secrets: `NEXT_PUBLIC_*` values, and `INDEXNOW_KEY`
  (search engines fetch it from your site to verify you).

## If an account or a key is stolen

In order:

1. **An agent key:** revoke it in `/admin/agents`. It stops on its next request.
2. **An admin account:** from another admin account, ban it in `/admin/users`
   (that ends its sessions at once and refuses new ones, and revokes every
   agent key it minted). No other admin? Sign in as yourself, change the
   password and end your other sessions in `/dashboard/settings`, and turn on
   two-factor.
3. **Everyone’s sessions** (you suspect the secret itself leaked): rotate
   `BETTER_AUTH_SECRET` with `BETTER_AUTH_SECRETS` and restart. Everyone signs
   in again.
4. **The server:** if there is any chance someone reached a shell, rotate
   `POSTGRES_PASSWORD`, the Resend and Polar keys, and the off-site storage
   key — and rebuild from a clean image.
5. **Look at what changed:** `/admin/audit` lists every content, post, plan,
   user and key change with who made it, and restores content, posts and plans.
   List the uploads folder for anything that isn’t `yyyy/mm/<32 hex>.<ext>` —
   it didn’t come through the upload service.
6. **Restore** from a backup taken before the window if the audit log shows
   damage it can’t undo ([deploy/backups](../deploy/backups/README.md)).
7. **Tell the people affected** if personal data was exposed; your privacy law
   (GDPR and similar) may set a deadline.

## Deliberately not in scope

Real gaps, listed so the absence is a decision you can revisit:

- **No WAF, bot management or DDoS protection.** A determined flood takes one
  server down. The answer is a CDN or proxy in front — a deployment decision,
  not a code one.
- **No CAPTCHA.** Rate limits, a honeypot field and email verification carry
  sign-up and the forms. Add one if spam gets through; it costs every honest
  visitor a little.
- **No encryption of rows at rest** beyond what your disk and backup
  destination provide: the admin has to read them, and the key would live on
  the same server.
- **No dependency or secret scanning in CI** beyond Dependabot’s pull requests.
  `npm audit` before a deploy is the manual version.
