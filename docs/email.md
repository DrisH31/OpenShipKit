# Email (optional): Resend

OpenShipKit sends a handful of transactional emails: email verification,
password reset, magic links, welcome, and security notices (password changed,
“you already have an account”). It never sends marketing mail on its own.

| Provider | When | What happens |
|---|---|---|
| `console` | default (no `RESEND_API_KEY`) | each email is printed to the server log. In development the whole message, links included; in production only To and Subject (the body holds live sign-in links) |
| `resend` | `RESEND_API_KEY` set | sent through [Resend](https://resend.com) |

`console` is perfect for development. **In production, turn on Resend before
the first sign-up, yours included**: production requires email verification,
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
| `EMAIL_PROVIDER` | `resend` \| `console` (default: `resend` when the key is set) |
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM` | `Name <address@your-verified-domain>` |
| `EMAIL_CONSOLE_PRINT_BODIES` | `true` prints console-provider bodies in production too. Only to verify the first admin; remove it after |
