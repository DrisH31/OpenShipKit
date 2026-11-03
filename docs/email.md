# Email: Resend or your own SMTP server

OpenShipKit sends a handful of transactional emails: email verification,
password reset, magic links, welcome, and security notices (password changed,
“you already have an account”). It never sends marketing mail on its own.

| Provider | When | What happens |
|---|---|---|
| `console` | default (no `RESEND_API_KEY`) | each email is printed to the server log. In development the whole message, links included; in production only To and Subject (the body holds live sign-in links) |
| `resend` | `RESEND_API_KEY` set | sent through [Resend](https://resend.com) |
| `smtp` | `SMTP_URL` set (and no `RESEND_API_KEY`) | sent through any SMTP server: your own, or a provider's SMTP endpoint ([below](#send-over-smtp)) |

`console` is perfect for development. **In production, turn on Resend or SMTP
before the first sign-up, yours included**: production requires email verification,
`ADMIN_EMAILS` promotes only a verified address, and password resets need
delivery. The production log never shows the link, so without Resend nobody
can verify (see [below](#no-resend-yet-verifying-the-first-admin) for the one
escape hatch). `AUTH_REQUIRE_EMAIL_VERIFICATION=false` doesn’t get you there
either: you could sign in, but not become the admin.

## Set up Resend

1. Create a Resend account and **add your domain** (Domains → Add Domain). Use
   a subdomain for sending if you like (`mail.example.com`) — it keeps your
   main domain’s reputation separate.
2. Add the DNS records Resend shows, at your DNS provider:
   - **SPF** — a `TXT` record (and the `MX` record for the bounce subdomain)
     that authorizes Resend to send for the domain.
   - **DKIM** — the `TXT` record with Resend’s public key; it signs every
     message.
   - **DMARC** — add one yourself if you don’t have it. Start by monitoring:

     ```
     _dmarc.example.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
     ```

     After a few weeks of clean reports, tighten to `p=quarantine`, then `p=reject`.
3. Wait for Resend to show the domain as **Verified**.
4. API Keys → Create API key (sending access is enough). Then:

```dotenv
RESEND_API_KEY=re_…
EMAIL_FROM=Your Product <hello@example.com>
```

`EMAIL_FROM` must use the verified domain. The default
(`OpenShipKit <onboarding@resend.dev>`) is Resend’s test sender and only
delivers to your own Resend account’s address — fine for a first try, not for
users.

Setting the key switches `EMAIL_PROVIDER` to `resend`; set
`EMAIL_PROVIDER=console` to force the log even with a key present.

## Send over SMTP

Any SMTP server or relay works: your own Postfix or Stalwart, or the SMTP
endpoint of Amazon SES, Postmark, Mailgun, Brevo, Fastmail or Google
Workspace. One URL holds the server and the login:

```bash
SMTP_URL=smtps://user:password@smtp.example.com:465   # TLS from the first byte
SMTP_URL=smtp://user:password@smtp.example.com:587    # STARTTLS
EMAIL_FROM="Your Product <hello@example.com>"
```

- **Percent-encode** `@`, `:` and `/` in the user name or password
  (`me@example.com` becomes `me%40example.com`).
- **TLS is required.** With `smtp://` the server must offer STARTTLS, or
  nothing is sent: otherwise one wrong port sends your password and every reset
  link in plain text. The exception is a relay on the same machine
  (`smtp://localhost:25`).
- **`EMAIL_FROM` is required** in production with SMTP, on a domain the server
  may send for. Publish that domain's SPF and DKIM records exactly as the mail
  server or provider gives them, and a DMARC record. Without them the mail goes
  to spam, or isn't delivered.
- **Many VPS hosts block outgoing port 25**, and some block 465 and 587 until
  you ask. If sends time out, check that first.
- A send the server didn't accept (a `4xx` reply, a dropped connection) is
  retried once. SMTP has no idempotency key, so in the rare case the connection
  drops just after the server accepted the message, it is sent twice.
- A malformed `SMTP_URL` stops the server at start, not at the first sign-up,
  and the error never repeats the password.

Setting `SMTP_URL` switches `EMAIL_PROVIDER` to `smtp` unless `RESEND_API_KEY`
is also set. `EMAIL_PROVIDER=smtp` picks it explicitly.

## No Resend yet: verifying the first admin

If you must bring a site up before Resend is ready,
`EMAIL_CONSOLE_PRINT_BODIES=true` makes the console provider print bodies in
production too. Use it for the few minutes it takes to verify your own address,
then remove it:

1. Add `EMAIL_CONSOLE_PRINT_BODIES=true` to the env file and restart the app
   (`docker compose up -d` recreates it; on Dokploy/Coolify, add it in the
   environment and redeploy; on plain Node, `sudo systemctl restart openshipkit`).
2. Sign up with the `ADMIN_EMAILS` address and open the verification link from
   the log (`docker compose logs app | grep -A6 -i verify`, or
   `journalctl -u openshipkit`).
3. Remove the variable and restart again.

While it’s on, every verification, reset and magic-link email for every user is
written to the log, where anyone who can read the log can use it.

## Check it

Sign up with a real address on the deployed site, or use **Forgot password**.
The email should arrive within seconds and pass SPF, DKIM and DMARC (in Gmail:
⋮ → Show original). If it doesn’t arrive, the app log has the provider’s error
— a failed send is logged, never shown to the visitor (that would reveal
whether an account exists).

## Changing the emails

The templates are in `src/server/email-templates.ts`: plain, accessible HTML
plus a text version, using the site name from `/admin/content/site`. Edit the
copy there. To add an email, add a template and call
`sendEmail({ to, subject, html, text })` from `src/server/email.ts` in a service.

## Variables

| Variable | |
|---|---|
| `EMAIL_PROVIDER` | `resend` \| `smtp` \| `console` (default: `resend` when its key is set, else `smtp` when `SMTP_URL` is) |
| `RESEND_API_KEY` | Resend API key |
| `SMTP_URL` | `smtps://user:password@host:465` or `smtp://user:password@host:587` (STARTTLS) |
| `EMAIL_FROM` | `Name <address@your-verified-domain>` |
| `EMAIL_CONSOLE_PRINT_BODIES` | `true` prints console-provider bodies in production too. Only to verify the first admin; remove it after |
