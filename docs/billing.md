# Billing (optional): Polar, Stripe or Razorpay

Billing is **off by default**. The pricing page still shows your plans, free
plans work, and nothing can be bought. When you’re ready to charge, OpenShipKit
uses [Polar](https://polar.sh) as **merchant of record**: Polar is the seller
on the invoice, so it calculates, collects and remits VAT and sales tax
worldwide and issues the receipts. You get paid out; you don’t register for
tax in every country.

Polar is the default and the guide below sets it up. [Stripe](#stripe-instead)
and [Razorpay](#razorpay-instead-india) (for India) work the same way, one provider at
a time (`BILLING_PROVIDER`). Each lives in `src/adapters/billing/<provider>/`
behind the `BillingProvider` contract (`src/core/billing.ts`), and
`tests/billing-adapters.test.ts` holds every adapter to the same scenarios.

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
| `POST /api/billing/checkout` | `{ planKey, interval }` (form or JSON) → 303 to the provider’s checkout. Signed out → sign-in first. Refuses a second subscription. |
| `POST /api/billing/portal` | → 303 to the provider’s customer portal (Polar, Stripe; Razorpay has none) |
| `POST /api/billing/webhook` | The provider → OpenShipKit. 404 when billing is off |

`CheckoutButton` and `PortalButton` (`src/components/billing`) are plain
forms that post to these and work without JavaScript. Both routes check the
request’s `Origin` against `NEXT_PUBLIC_SITE_URL` and rate-limit per user.

## Stripe instead

`BILLING_PROVIDER=stripe` (or just `STRIPE_SECRET_KEY` set, with no Polar
token). Stripe isn't the merchant of record: you turn on Stripe Tax and
receipts in your Stripe dashboard.

1. **Products and prices.** In Stripe, create a product per plan and a
   recurring price per interval (or a one-time price). In `/admin/plans`,
   paste each price's id (`price_…`) into **Stripe price id**. For teams,
   a per-seat price uses Stripe's per-unit pricing: the checkout buys one
   unit per seat.
2. **Webhook.** Developers → Webhooks → Add endpoint
   `<NEXT_PUBLIC_SITE_URL>/api/billing/webhook` with the events
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `charge.refunded`,
   `refund.failed` and `charge.dispute.closed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. **The customer portal.** Settings → Billing → Customer portal: turn on
   cancelling, updating payment methods, and **switching plans** (add each
   plan's products, so a subscriber can move between them). **Manage billing**
   opens it; without plan switching a subscriber has no way to change plan,
   because the app refuses a second subscription.

Test with `sk_test_…` keys and Stripe's test cards. The rules don't change:
access comes only from a signature-verified webhook, the subscription is
re-fetched from Stripe before anything is written, and a redelivered event is
applied again with the same result (it re-fetches, so it can't grant twice).
Promotion codes are on at checkout: a one-time price made free by a 100% code
is granted from the completed checkout session, since Stripe makes no payment
for it.

## Razorpay instead (India)

`BILLING_PROVIDER=razorpay` (or just `RAZORPAY_KEY_ID` set). Razorpay takes
UPI, cards and netbanking. GST invoices are set up in its dashboard.

1. **Plans.** For each recurring price, create a Razorpay plan
   (Subscriptions → Plans) with the same amount and period, and paste its id
   (`plan_…`) into **Razorpay plan id**. A one-time price needs nothing in
   Razorpay: the checkout is a payment link for the price's amount.
2. **Webhook.** Account & Settings → Webhooks →
   `<NEXT_PUBLIC_SITE_URL>/api/billing/webhook`, with a secret you choose
   (`RAZORPAY_WEBHOOK_SECRET`) and the events `subscription.authenticated`,
   `subscription.activated`, `subscription.charged`, `subscription.pending`,
   `subscription.halted`, `subscription.cancelled`, `subscription.completed`,
   `subscription.paused`, `subscription.resumed`, `subscription.updated`,
   `payment_link.paid`, `refund.processed`, `refund.failed` and
   `payment.dispute.lost`.
3. **Keys.** `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
   (`rzp_test_…` while testing).

What's different about Razorpay:

- **No customer portal.** The billing page lists the person's renewing
  subscriptions with a **Cancel at period end** button instead of Manage
  billing. Updating a card goes through Razorpay's own emails and links.
- **Cancel records the cancellation first, then asks Razorpay** (Razorpay takes
  one cancel call per subscription, and a second press at the same time stops
  before it reaches Razorpay). If Razorpay refuses, the subscription goes back
  to renewing and the person sees Razorpay's reason. If the answer is lost (a
  timeout), it shows as ending, and the person is told so; if Razorpay then
  charges a new period anyway, it shows as renewing again and can be cancelled
  again. The app keeps a cancellation it recorded only within the period it was
  recorded in.
- **A trial** (or a mandate whose first charge hasn't happened) is cancelled at
  Razorpay straight away, since Razorpay can't cancel those "at the end of the
  cycle". Nothing is charged, and the trial still runs to its end here.
- **Changing plan mid-cycle isn't offered.** Razorpay's subscription update
  works only for some payment methods, so the app keeps one rule: cancel, and
  buy the new plan once the old one ends.
- **A cancellation is remembered by the app.** Razorpay keeps a subscription
  cancelled "at the end of the cycle" as `active`, with no field saying it will
  end. The app records the cancellation when you press the button and keeps it
  until Razorpay moves the subscription to `cancelled`. A cancellation made in
  Razorpay's dashboard isn't seen until then.
- **Subscriptions run for at most 120 months (10 years).** Razorpay needs a
  cycle count. When it runs out, the subscription shows as completed.
- **Refunds of one-time purchases** are recognised because the app copies its
  notes onto the payment when the link is paid.

## Chargebacks

A one-time purchase whose chargeback you **lose** loses its access for good
(Stripe `charge.dispute.closed` and Razorpay `payment.dispute.lost`, each
re-fetched before anything changes). It's shown as "Charged back", and no later
event for that payment hands it back. A refund, unlike a chargeback, follows the
provider: one that failed gives the access back.

What the app doesn't do:

- **Polar.** Polar is the merchant of record and handles disputes itself. The app
  follows the order Polar reports; it doesn't read Polar's disputes, so a lost
  dispute ends access only if Polar also marks the order refunded.
- **A disputed subscription payment** doesn't end the subscription. The provider
  keeps it running until you cancel it in their dashboard; the webhook then ends
  access as usual. That's deliberate: whether to keep a customer who disputed
  one invoice is your call, not the app's.

## Checking prices

The pricing page shows each plan's amount; the customer pays the provider's.
`/admin/plans/<key>` compares the two for every paid price (amount, currency,
interval) and lists any difference, or a price id the provider doesn't have.
It only reads: nothing is changed on either side.

## Switching providers

One provider at a time. After `BILLING_PROVIDER` changes, the old provider's
webhooks are refused (they can't be verified), so its subscribers **keep being
charged** while their access runs out at the period end. The server logs how
many there are at startup (`… still renew, but billing is now …`). Before
switching, cancel those subscriptions at the old provider (or let them run
out), and ask the people to subscribe again. The admin overview lists them under
"Needs you" until you mark them handled there, which ends their access here
(each change is in the audit log). Their past purchases and history stay in the
database.

## Variables

| Variable | |
|---|---|
| `BILLING_PROVIDER` | `polar` \| `stripe` \| `razorpay` \| `none` (default: the first whose key is set: Polar, Stripe, then Razorpay) |
| `POLAR_ACCESS_TOKEN` | organization access token (sandbox and production differ) |
| `POLAR_WEBHOOK_SECRET` | the webhook endpoint’s secret |
| `POLAR_SERVER` | `sandbox` \| `production` |
