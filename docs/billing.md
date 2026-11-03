# Billing (optional): Polar

Billing is **off by default**. The pricing page still shows your plans, free
plans work, and nothing can be bought. When you’re ready to charge, OpenShipKit
uses [Polar](https://polar.sh) as **merchant of record**: Polar is the seller
on the invoice, so it calculates, collects and remits VAT and sales tax
worldwide and issues the receipts. You get paid out; you don’t register for
tax in every country.

Polar is the only payment provider. The code is `src/adapters/billing/polar/`
behind the `BillingProvider` contract (`src/core/billing.ts`).

## The rule

**Access comes only from verified webhooks.** The checkout redirect, a
`?success=1`, or anything the browser says never grants a plan. Polar calls
`/api/billing/webhook`; OpenShipKit verifies the signature, re-fetches the
subscription or order from Polar’s API (so a late, stale event can’t undo a
newer state), stores it, and only then marks the event processed. Entitlements
are computed from those rows.

## Set it up — sandbox first

Polar has a separate **sandbox** (`sandbox.polar.sh`) with test cards. Do all
of this there first; production is the same steps with production keys.

### 1. Products

In Polar, create an organization, then one **product per price** you sell:

| Your plan price | Polar product |
|---|---|
| Pro, monthly | recurring, every month, the amount |
| Pro, yearly | recurring, every year, the amount |
| Lifetime | one-time purchase |

Copy each product’s id.

### 2. Plans

In **`/admin/plans`**, open each plan and paste the Polar product id into the
matching price (`polarProductId`). Amounts and currency in the plan are what
your pricing page shows — keep them equal to Polar’s. A price without a
product id can’t be bought (the button explains it). Trial days on a plan are
passed to the checkout.

Never hard-code product ids in code: they differ between sandbox and production.

### 3. Access token

Polar → your organization → **Settings → Developers → New token**. Give it the
scopes for checkouts, customer sessions, subscriptions and orders. Then:

```dotenv
POLAR_ACCESS_TOKEN=polar_oat_…
POLAR_SERVER=sandbox        # default outside production; production in production
```

Setting the token switches `BILLING_PROVIDER` to `polar` (you can set it
explicitly: `polar` | `none`).

### 4. Webhook

Polar → **Settings → Webhooks → Add endpoint**:

| Field | Value |
|---|---|
| URL | `https://example.com/api/billing/webhook` |
| Format | **Raw** |
| API version | `2026-10` — the version the SDK import pins (`@polar-sh/sdk/2026-10`) |
| Events | every `subscription.*` event; `order.paid`, `order.updated`, `order.refunded`; `refund.created`, `refund.updated` |

Copy the endpoint’s secret, exactly as shown, into `POLAR_WEBHOOK_SECRET`.

The endpoint answers `403` to a bad signature, `400` to a malformed body,
`202` to events it doesn’t need, and `500` (so Polar retries) if storing
fails. Redelivery is safe: every write is an upsert of current state.

### 5. Test it

Your webhook URL must be reachable from the internet. Easiest: test on a
staging deployment with sandbox keys. To test from your laptop, expose
`localhost:3000` with a tunnel you trust (for example an SSH reverse tunnel to
your own server: `ssh -R 8080:localhost:3000 you@your-server`, proxied by its
Caddy) and use that URL for the sandbox webhook.

1. Sign in, open `/pricing`, choose a paid plan → Polar’s checkout.
2. Pay with the sandbox test card `4242 4242 4242 4242`, any future expiry, any CVC.
3. You land on `/dashboard/billing`. Within seconds the webhook arrives and the
   plan shows as active. (If it doesn’t, the webhook didn’t reach you: check
   Polar’s webhook deliveries and the app log.)
4. **Manage billing** opens Polar’s customer portal (cancel, change card,
   invoices). Cancel there and watch the webhook update the dashboard.

### 6. Go live

Create the products again in production Polar, a production token and webhook,
set `POLAR_SERVER=production` (the default in production), and update the
product ids in `/admin/plans`.

## Gating features

```ts
import { hasPlan, getEntitlement } from "@/server/services/billing";

if (!(await hasPlan(user.id, ["pro", "lifetime"]))) redirect("/pricing");
const entitlement = await getEntitlement(user.id); // the active plan, status, period end
```

Call these on the server — in a page, action or route — after `requireUser()`.

## Routes

| Route | Does |
|---|---|
| `POST /api/billing/checkout` | `{ planKey, interval }` (form or JSON) → 303 to Polar’s checkout. Signed out → sign-in first. Refuses a second subscription. |
| `POST /api/billing/portal` | → 303 to Polar’s customer portal |
| `POST /api/billing/webhook` | Polar → OpenShipKit. 404 when billing is off |

`CheckoutButton` and `PortalButton` (`src/components/billing`) are plain
forms that post to these and work without JavaScript. Both routes check the
request’s `Origin` against `NEXT_PUBLIC_SITE_URL` and rate-limit per user.

## Variables

| Variable | |
|---|---|
| `BILLING_PROVIDER` | `polar` \| `none` (default: `polar` when the token is set) |
| `POLAR_ACCESS_TOKEN` | organization access token (sandbox and production differ) |
| `POLAR_WEBHOOK_SECRET` | the webhook endpoint’s secret |
| `POLAR_SERVER` | `sandbox` \| `production` |
