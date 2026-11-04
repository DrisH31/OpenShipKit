# Auth

Authentication is [Better Auth](https://better-auth.com), running inside the
app with its tables in your Postgres. No auth service, no per-user pricing,
no data leaving your server. The adapter is `src/adapters/auth/better-auth/`;
the rest of the app only sees `getCurrentUser()`, `requireUser()` and
`requireAdmin()` from `src/server/session.ts`.

## What’s included

| Feature | How it’s turned on | Where |
|---|---|---|
| Email + password | always | `/sign-up`, `/sign-in` (8–128 characters) |
| Email verification | required in production; off in development | link → `/auth/verify-email` |
| Password reset | always | `/auth/forgot-password` → email → `/auth/reset-password` |
| Magic links | `AUTH_MAGIC_LINK=true` | “Email me a sign-in link” on `/sign-in`, `/auth/magic-link` |
| Two-factor (TOTP + backup codes) | always available; each user opts in | `/dashboard/settings`; challenge at `/auth/two-factor` — see [Two-factor](#two-factor) |
| Sessions | always | `/dashboard/settings` lists devices, signs others out |
| Account deletion | always | `/dashboard/settings` |
| GitHub / Google sign-in | both `*_CLIENT_ID` and `*_CLIENT_SECRET` set | buttons on `/sign-in` and `/sign-up` — see [GitHub and Google](#optional-github-and-google) |
| Rate limits | on in production (`AUTH_RATE_LIMIT`) | per IP and per account: sign-in, sign-up, 2FA, emailed links; stored in Postgres — see [Rate limits and lockouts](#rate-limits-and-lockouts) |

Every form works without JavaScript. Emails (verification, reset, magic link,
welcome, security notices such as “your password was changed”) are rendered by
`src/server/email-templates.ts` and sent through the email provider — in
development they print to the terminal.

While email verification is required (the production default), signing up
with an address that already has an account sends that person an email (“you
already have an account — sign in or reset”) and shows the same “check your
inbox” answer as a new sign-up, so the form never reveals who is registered.
With verification off (development, or `AUTH_REQUIRE_EMAIL_VERIFICATION=false`)
sign-up answers “An account with this email already exists” instead, which
tells anyone whether an address has an account.

### Rate limits and lockouts

With `AUTH_RATE_LIMIT` on (the production default), Better Auth’s per-IP
limits run alongside per-account ones
(`src/adapters/auth/better-auth/throttle.ts`), so requests spread over many
IP addresses still hit a wall. The counters live in the `auth_rate_limit`
table, shared by every process, and hold a hash of the address, never the
address itself.

| Limit | Counted | Over the limit |
|---|---|---|
| Wrong passwords | 10 per account per 15 minutes, on the sign-in and on every settings form that checks the current password | “Too many wrong passwords for this account”. The answer is the same for an address with no account. |
| Known devices | a browser that has proved the password (a right password, or a reset link opened in it) gets a signed `known_device` cookie for 180 days, and its own wrong-password counter for that account | A stranger who runs the shared counter down locks out guessers, not the owner’s own browsers. The cookie remembers one account per browser: the last one proved. |
| Asks for a link | 5 per address per hour: password reset, sign-in link, “send the confirmation again”, counted whether or not the address has an account | The form says so (`TOO_MANY_EMAILS`: “Too many emails have been sent to this address in the last hour”), which reveals nothing. |
| Other emailed links | 5 per address per hour: the confirmation sent on sign-up or sign-in, “you already have an account” | The email is quietly not sent, and the form answers exactly as before. |

### Two-factor

Better Auth’s two-factor step guards the **password** sign-in only. So that
nothing skips the second factor, an account with two-factor on is refused a
session by every other way in: a sign-in link, an email-confirmation link, and
GitHub or Google (the provider’s own 2FA isn’t this site’s). Such an account
isn’t even sent a sign-in link: it gets a “sign in with your password and
code” email instead, and the form answers the same. A GitHub or Google
identity is never linked into an account that has two-factor on.

Ten wrong codes in a row lock the second factor for 15 minutes. “Trust this
device” on the challenge skips the code in that browser for 30 days.

## Configuration

| Variable | Default | |
|---|---|---|
| `BETTER_AUTH_SECRET` | dev: generated once into `.data/dev-auth-secret` (random, git- and docker-ignored); production: **required** | signs sessions, encrypts 2FA secrets |
| `BETTER_AUTH_SECRETS` | unset | versioned keys for rotating the secret — see [Rotating the secret](#rotating-the-secret) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | the base URL for callbacks and emailed links |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | production `true`, dev `false` | `true`/`false` overrides. `false` in production turns sign-up into an account-enumeration oracle (it says when an email is taken) |
| `AUTH_MAGIC_LINK` | off | `true` to offer magic links |
| `AUTH_RATE_LIMIT` | production on, dev off | `false` only if your proxy limits these routes |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | — | optional |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | optional |

Keep the secret in your password manager. Never just *replace*
`BETTER_AUTH_SECRET`: that signs everyone out **and** makes every stored 2FA
secret and backup code unreadable (users would have to set 2FA up again).
Rotate it as below instead.

### Rotating the secret

Rotate when the secret may have leaked (with a copy of the database it lets
someone forge any session, an admin’s included), or on a schedule. Better Auth
reads versioned keys from `BETTER_AUTH_SECRETS` (`<version>:<secret>,…`, the
newest first): new sessions and newly encrypted 2FA data use the first key,
and anything encrypted earlier still decrypts with the key it was written
with. A value encrypted before you ever set `BETTER_AUTH_SECRETS` has no
version and decrypts with `BETTER_AUTH_SECRET`.

1. **First rotation.** Leave `BETTER_AUTH_SECRET` as it is — it is now only
   the key for the 2FA secrets already stored — and add the new key:

   ```bash
   BETTER_AUTH_SECRET=<the old secret, unchanged>
   BETTER_AUTH_SECRETS=1:<new: openssl rand -base64 32>
   ```

2. **Restart** (`docker compose up -d`, or restart the service). Session
   cookies are signed with the newest key only, so everyone — including
   anyone holding the old secret — is signed out once and signs in again;
   two-factor keeps working because old TOTP secrets and backup codes still
   decrypt.
3. **Check**: sign in to an account that has 2FA on with an authenticator
   code, then once more with a backup code.
4. **Later rotations** put the new key first and keep the previous ones:
   `BETTER_AUTH_SECRETS=2:<newer>,1:<new>`. Remove a version only when nothing
   is still encrypted with it — a user who set up 2FA under that key must set
   it up again (or turn 2FA off and on) first. Keep `BETTER_AUTH_SECRET` set
   too: it stays the key for 2FA set up before the first rotation.

After a leak, also ask admins (and anyone else you can reach) to turn 2FA off
and on again in `/dashboard/settings`, so their TOTP secret is re-encrypted
with — and only readable by — the new key. `tests/secret-rotation.test.ts`
pins this behaviour of Better Auth, so an upgrade that changes it fails CI.

## Optional: GitHub and Google

These are plain OAuth — off unless you add keys, and email + password always
works alongside them.

**GitHub** → Settings → Developer settings → OAuth Apps → New OAuth App:

- Homepage URL: `https://example.com`
- Authorization callback URL: `https://example.com/api/auth/callback/github`

Copy the Client ID and a new client secret into `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET`. For local development create a second app with
`http://localhost:3000/api/auth/callback/github`.

**Google** → Google Cloud console → APIs & Services → Credentials → Create
credentials → OAuth client ID → Web application:

- Authorized JavaScript origin: `https://example.com`
- Authorized redirect URI: `https://example.com/api/auth/callback/google`

Configure the OAuth consent screen (app name, support email) first. Put the
values in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

A button appears only when both values of a provider are set.

How a GitHub or Google identity meets your accounts:

- **Sign-up needs a verified email.** While email verification is required
  (the production default), a GitHub or Google sign-up whose email the
  provider hasn’t verified is refused, and the browser lands on
  `/sign-in?error=SOCIAL_EMAIL_NOT_VERIFIED` (“That account’s email isn’t
  verified with GitHub or Google yet…”). Otherwise anyone with a provider
  account under someone else’s address could open an account here before its
  owner.
- **Linking** into an existing account with the same email happens only when
  the provider says the address is verified, and never into an account with
  two-factor on. Linking from a signed-in session needs a sign-in from the last
  15 minutes.
- **No provider tokens are stored**: sign-in needs only the identity, so a
  database dump holds nothing usable at GitHub or Google.

## Users, roles and admins

Better Auth knows identities; the app’s own `users` table holds the role
(`user` | `admin`) and bans. On every request `getCurrentUser()` maps the
session to that row (creating it on first sign-in).

- **The first admin**: put your address in `ADMIN_EMAILS` and sign in. Listed
  addresses are promoted on sign-in (in production only once the address is
  verified); removing one later doesn’t demote.
- **More admins**: promote them in `/admin/users`, or add them to `ADMIN_EMAILS`.
- **Banning** in `/admin/users` ends the person’s sessions on every device and
  refuses them new ones, whatever the way in; the sign-in page says the account
  is suspended.
- **The last admin** who isn’t banned can’t be demoted, banned or deleted, and
  an `ADMIN_EMAILS` address can’t be demoted until it’s removed there.
- **Organisation roles are separate.** With teams on
  (`OPENSHIPKIT_TENANCY=org`), member, admin and owner are roles inside one
  organisation, kept by the app, not Better Auth; the site admin role grants
  nothing there ([teams.md](teams.md)).
- **Agent keys follow their admin.** An MCP key minted in `/admin/agents`
  belongs to the admin who minted it; demoting, banning or deleting that admin
  revokes their keys, and each revoke is in the audit log ([mcp.md](mcp.md)).

## The read-only demo admin

> **OpenShipKit's showcase only.** Leave `DEMO_ADMIN_EMAIL` and
> `DEMO_ADMIN_PASSWORD` empty on your own site (they are, in `.env.example`).

The showcase lets a visitor open the admin without an account: **Try the
demo** in the note beside the sign-in and sign-up forms posts to
`/api/demo`, which signs the browser in as one shared admin account that can
change nothing. Set both variables to switch it on (production refuses to
start with only one, or with a password under 16 characters):

```bash
DEMO_ADMIN_EMAIL=demo@example.com
DEMO_ADMIN_PASSWORD=$(openssl rand -base64 24)
```

**The password is a server secret.** Nothing renders it; only `/api/demo`
uses it, through Better Auth's own `signInEmail`.

**The account** is made by `src/server/services/demo-account.ts` with Better
Auth's internal adapter (its own password hash, the email marked verified so
required verification never blocks it), then made an admin in the app's
`users` table. It runs at boot on the embedded development database and before
every press of Try the demo on any database, so a Postgres server needs no
seed step and an account deleted or demoted in `/admin` is back on the next
press. Which identity is the demo's is written once to the audit log; if the
address already belongs to an account the demo didn't create, that account is
left untouched, never promoted, and the server logs a loud `[demo] REFUSED`.
To switch the demo off, unset the variables (or ban the account in
`/admin/users`: a ban is kept).

**`/api/demo`**: a plain form post, so it works without JavaScript. It answers
404 while the demo is off, refuses another site's Origin, allows ten presses
per network per minute, and 303s to `/admin` (JSON callers get
`{ ok, redirect }`). Someone signed in as another account is signed out first.
A demo session is a browser session (it ends when the browser closes), lasts
at most two hours, and is never extended by activity.

**Read-only, in depth:**

- Every write service calls `assertNotDemo()` (`src/server/demo.ts`) before it
  touches the database and refuses with *“This is the read-only demo account:
  nothing can be changed. Clone the template to try it for real.”* — shown by
  each admin and dashboard form like any other refusal. `tests/demo.test.ts`
  fails for an exported service that takes an `Actor` or a `User` without it.
- The routes that write outside a service refuse it too: media uploads,
  the subscriber CSV export, checkout and the billing portal.
- Better Auth refuses the demo account every credential change, for the HTTP
  endpoints and the settings forms alike: password, email and profile changes,
  deleting itself, two-factor (which would lock every other visitor out),
  ending other sessions, linking a provider, and reset or sign-in links to its
  address.
- The contact form treats it as an anonymous visitor; the dashboard's
  feedback form refuses it.
- Every admin and dashboard page shows *“Read-only demo: you can look at
  everything; saving is switched off.”* The controls stay, so visitors see the
  real admin.

**Privacy.** The demo viewer sees other people masked
(`src/shared/privacy-mask.ts`): emails as `a•••@g•••.com` (first letter, the
domain's first letter, the top-level domain), names as `A••• S•••`, feedback
and contact messages, private notes, and session addresses as
`[hidden in the demo]`, feedback titles with addresses and phone numbers
replaced. The audit log's actors and before/after values, the overview's
recent changes and agent keys' "minted by" are masked the same way. User and
subscriber search is off for it (a match on an exact address would say who
has an account), the user page looks people up by id only, and its settings
list only its own browser's session. Its own address is shown as is.

## Protecting your pages

```ts
// a page or server action in src/app/dashboard/…
import { requireUser } from "@/server/session";

const user = await requireUser("/dashboard/reports"); // redirects to sign-in, then back
```

`requireAdmin()` returns the admin or **404s** — to a signed-in non-admin,
`/admin` doesn’t admit it exists. `src/proxy.ts` also redirects signed-out visitors away from
`/dashboard` and `/admin`, but only by checking that a session cookie exists;
it is a convenience, never the check. Server actions skip layouts, so every
action calls `requireUser()`/`requireAdmin()` itself.

`tests/authz.test.ts` checks this: it fails when an admin or dashboard page or
action doesn't call its guard before anything else, and when a route handler
isn't in its `ROUTES` map with the guard it needs (or, if public, the reason).
A new route handler goes there, and in `src/server/api-reference.ts` for the
[API reference](api.md) (`npm run docs:api`).

For plan-gated features see [billing.md](billing.md#gating-features).

## Adding a Better Auth plugin

Better Auth has plugins for passkeys and more. (Organisations are built in,
without its plugin: [teams.md](teams.md).) To add one:

1. Register it in `src/adapters/auth/better-auth/instance.ts` (and its client
   counterpart if it has UI).
2. If it brings tables or columns, add them to
   `src/adapters/data/postgres/schema.ts` (prefix `auth_`, snake_case columns)
   and run `npm run db:generate -- --name <plugin>` — the Drizzle adapter
   refuses to write a field its schema lacks.
3. Add its screens under `src/app/(auth)/` or the dashboard settings.
