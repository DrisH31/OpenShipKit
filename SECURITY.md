# Security policy

## Reporting a vulnerability

Please report security problems **privately** through GitHub:
[**Report a vulnerability**](https://github.com/DrisH31/openshipkit/security/advisories/new)
(the repository’s Security tab → Advisories → Report a vulnerability).

Don’t open a public issue, discussion or pull request for a vulnerability.

Include what you can: the affected file or route, the version or commit, steps
to reproduce or a proof of concept, and the impact you expect. You’ll get an
acknowledgement within a few days. We’ll agree a fix and a disclosure date with
you, credit you in the advisory if you’d like, and publish a fixed release
before details go public.

## Scope

In scope: the code in this repository — auth flows, sessions and admin checks,
the services write path and audit log, the billing webhook handling (Polar,
Stripe, Razorpay), organisations, roles and invitations, uploads (on disk or in
a bucket), the MCP server and agent keys, the forms, the Dockerfile, compose
file and deploy guides.

Out of scope: vulnerabilities in a dependency with no OpenShipKit-specific
exploit (report them upstream — Next.js, Better Auth, Drizzle, etc.), a
deployment that ignores the guides (for example Postgres published to the
internet), and findings that need an already-compromised admin account or
server.

## Supported versions

Security fixes go into the latest release on `main`. OpenShipKit is a template
you copy, so you apply fixes to your copy yourself: watch the repository’s
releases (Watch → Custom → Releases and Security alerts) and
[docs/upgrading.md](docs/upgrading.md) explains how to pull changes in.

## Keeping your deployment safe

- Patch Next.js the week a security release ships (`npm run check && npm run build`, deploy).
- Keep Dependabot on in your copy, and merge its security PRs. The Security workflow (`.github/workflows/security.yml`: CodeQL, `npm audit`, gitleaks, dependency review) comes with your copy; keep it green.
- Follow [deploy/hardening.md](deploy/hardening.md).
- The security model — what is checked where — is in [docs/security.md](docs/security.md).
