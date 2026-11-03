# Roadmap

Where OpenShipKit goes after 1.0, in order. The goal: you can clone it,
configure it, deploy it, and then work only on your own product, not on
fixing the foundation underneath it.

Every item keeps the [invariants](AGENTS.md#invariants--dont-break-these).
Each new outside service is **opt-in**: off until its key is set, and
replaceable by something you host yourself. The README's
["doesn't do (yet)"](README.md#what-openshipkit-doesnt-do-yet) table shrinks
as these land.

## How we judge it

| | Question | Evidence |
|---|---|---|
| **Feature completeness** | Does it have what a SaaS needs? | The feature table, and a short "doesn't do" table |
| **Engineering quality** | Is each feature built correctly? | Contract tests on memory and Postgres, e2e in CI, the two-axis review |
| **Production confidence** | Can it hold real customers' data? | Security scanning, enforced authorization, observability, rehearsed restores, an outside audit |

A kit can score 9 on completeness and 5 on confidence. Confidence comes first.

## Phase 1: Production confidence (hardening)

Status: 1.1–1.7 done (November 2026), apart from the migration check in 1.7, which
moves to 1.8. An independent review of 1.1–1.5 found a leak of query parameters
into logs and a fail-open authorization test. Both are fixed, with tests that fail
without the fix.

| # | Item | Done when |
|---|---|---|
| 1.1 | **Security scanning in CI**: CodeQL, `npm audit` (high and above fails), secret scanning (gitleaks), dependency review on PRs | `security.yml` runs on every PR and every week |
| 1.2 | **Enforced authorization**: a test fails when an admin page, action or route skips `requireAdmin()`, or a dashboard page or action skips `requireUser()` | `tests/authz.test.ts`; a new unguarded file turns CI red |
| 1.3 | **Structured logging**: one `log` with levels, JSON lines in production and readable lines in development | No bare `console.*` in `src/server` or `src/app` outside the logger |
| 1.4 | **Optional error tracking**: any Sentry-protocol DSN (GlitchTip self-hosted, or Sentry) via `ERROR_TRACKING_DSN`, without the SDK | Off by default; unhandled server errors are reported when it is set |
| 1.5 | **Email without Resend**: an SMTP adapter (`SMTP_URL`), so mail can go through your own server or any provider | `EMAIL_PROVIDER=smtp`; contract tests for each adapter |
| 1.6 | **Background jobs in Postgres**: a `jobs` table with `SKIP LOCKED`, retries with backoff, run in-process. No Redis needed | A failed email send is queued and retried; `/admin/jobs` and MCP show and retry failures |
| 1.7 | **Health in depth**: `/api/health` reports the database and job lag; `/api/health/live` for liveness | Documented in docs/observability.md |
| 1.8 | **Migrations in health**: `/api/health` says whether the database is on the schema the code expects | A deploy that skipped `db:migrate` shows up in monitoring, not in a 500 |

## Phase 2: Teams and organisations

Status: Phase 2 done (November 2026). Organisations are app-owned tables behind the
DataStore, not Better Auth's plugin, so they get the contract tests, the audit
log and MCP like everything else. Billing per seat uses Polar's seat-based
pricing; the subscription is billed to the owner who buys it (Polar keys
customers by email). Site admins see organisations read-only in /admin/orgs
and through MCP (orgs_list, org_get); team actions are audited under the
organisation's id. Not done: an org_id on audit rows for your own product's
actions, which comes with the first product feature that needs it.

| # | Item |
|---|---|
| 2.1 | Organisations as app-owned DataStore tables: create, switch, rename, delete |
| 2.2 | Invitations by email: accept, expire, revoke |
| 2.3 | Org roles (owner, admin, member) and a permission map in `src/core`, checked by `requireOrgRole()` |
| 2.4 | Org-scoped billing: a subscription belongs to an org, with seats |
| 2.5 | A permission matrix test: every role against every org action |
| 2.6 | MCP and admin aware of orgs; audit rows carry the org |
| 2.7 | `OPENSHIPKIT_TENANCY=personal|org`, so a single-user product stays simple |

## Phase 3: More providers

| # | Item |
|---|---|
| 3.1 | Stripe billing adapter behind `BillingProvider` (verified, re-fetched, idempotent webhooks, like Polar) |
| 3.2 | Razorpay billing adapter (subscriptions + webhooks), for India |
| 3.3 | A shared billing contract test that every adapter passes |
| 3.4 | S3-compatible upload storage (Garage, MinIO, R2, S3) behind a `MediaStorage` contract, with the disk as the default |

## Phase 4: Usage and limits

| # | Item |
|---|---|
| 4.1 | Plan limits declared on the plan (`limits: { seats, projects, … }`) and checked by `requireWithinLimit()` |
| 4.2 | Usage metering: an append-only `usage_events` table, rolled up per billing period |
| 4.3 | Reporting usage to the billing provider where it supports metered prices |
| 4.4 | Usage shown in the dashboard and through MCP |

## Phase 5: Developer experience

| # | Item |
|---|---|
| 5.1 | An interactive `npm run setup` wizard: profile, email, billing, tenancy |
| 5.2 | Feature removal: `npm run setup -- --without blog,mcp` deletes what you don't use, cleanly |
| 5.3 | An HTTP API reference generated from the route handlers' zod schemas |
| 5.4 | Example apps on top of the kit (a small B2B tool, a usage-billed API) |
| 5.5 | `npm run upgrade`: a guided merge of a new release, with migration notes per version |

## Outside this repository

Some of the score depends on things code can't provide:

- **An independent security audit and penetration test** before 2.0. Findings
  and fixes are published in `SECURITY.md`.
- **A restore drill on a real server** each release, recorded in the release notes.
- **A release cadence**: a minor version each month while there are changes, a
  patch within 72 hours of a Next.js or Better Auth security release, and
  migration notes in the CHANGELOG for every schema change.
