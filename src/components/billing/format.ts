//
// Price formatting and billing copy — pure, safe in client and server
// components and in the /api/billing route handlers.
//
//   formatPrice(1900, "usd")                  → "$19"
//   formatPrice(1950, "usd")                  → "$19.50"
//   priceLabel({ amountCents: 1900, currency: "usd", interval: "month" }) → "$19/mo"
//   priceLabel({ … interval: "year" })        → "$190/yr"
//   priceLabel({ … interval: "one_time" })    → "$299 once"
//   priceInWords({ … interval: "month" })     → "$19 a month"   (in a sentence)
//   intervalLabel("month")                    → "per month"
//   intervalLabel("month", "rate")            → "a month"   ("$19 a month")
//   intervalLabel("month", "adverb")          → "monthly"
//
// formatPrice is src/shared/money.ts's, re-exported: one table of currencies
// with no minor unit, not two.
//
// The locale defaults to en-US, not the visitor's, so the server-rendered HTML
// and the hydrated client always agree. Whole amounts drop the ".00".
//
// The billing copy lives here too, so a route's `?error=<code>` and the page
// that shows it can't drift: billingErrorMessage (customer copy per code),
// checkoutConflictCode (which refusal a checkout conflict was) and
// BILLING_DISABLED_MESSAGE (what JSON callers are told while billing is off).
//

import { DEMO_READ_ONLY_ERROR, DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import type { PlanPrice, PriceInterval } from "@/core/types";
import { formatPrice } from "@/shared/money";

// One formatter for the whole app: src/shared/money.ts knows each currency's
// minor unit, so the pricing page, the dashboard, llms.txt and the Offer
// JSON-LD can't state different prices.
export { formatPrice };

const SUFFIX: Record<PriceInterval, string> = { month: "/mo", year: "/yr", one_time: " once" };

/** "$19/mo", "$190/yr", "$299 once". */
export function priceLabel(price: Pick<PlanPrice, "amountCents" | "currency" | "interval" | "perSeat">, locale?: string): string {
  return `${formatPrice(price.amountCents, price.currency, locale)}${price.perSeat ? " per seat" : ""}${SUFFIX[price.interval]}`;
}

/**
 * How an interval is said in words, by where it sits:
 *   per     beside a price or in a label: "per month", "per year", "one-time"
 *   rate    after an amount in a sentence ("$19 a month"): "a month", "a year", "once"
 *   adverb  how often it is billed ("Buy Pro, $19/mo (monthly)"): "monthly", "yearly", "once"
 */
export type IntervalStyle = "per" | "rate" | "adverb";

const INTERVAL_WORDS: Record<IntervalStyle, Record<PriceInterval, string>> = {
  per: { month: "per month", year: "per year", one_time: "one-time" },
  rate: { month: "a month", year: "a year", one_time: "once" },
  adverb: { month: "monthly", year: "yearly", one_time: "once" },
};

/** The words for an interval — the one copy, so the pricing page, the section and the dashboard can't drift. */
export function intervalLabel(interval: PriceInterval, style: IntervalStyle = "per"): string {
  return INTERVAL_WORDS[style][interval];
}

/** A price as it reads in a sentence: "$19 a month", "$190 a year", "$299 once". */
export function priceInWords(price: Pick<PlanPrice, "amountCents" | "currency" | "interval">, locale?: string): string {
  return `${formatPrice(price.amountCents, price.currency, locale)} ${intervalLabel(price.interval, "rate")}`;
}

/**
 * How a site owner turns payments on, for owner-facing surfaces (admin, the
 * billing page for an admin). Never shown to customers. Pass the site's
 * webhook URL to name it exactly; without one the step says "<your site>".
 * The one copy of these instructions: pages render them through
 * <BillingOffNotice audience="owner" /> rather than writing their own.
 */
export function billingSetupSteps(webhookUrl?: string): string[] {
  const hook = webhookUrl || "<your site>/api/billing/webhook";
  return [
    "Create a Polar organisation — start in the sandbox at sandbox.polar.sh — and an organisation access token.",
    `In Polar, add a webhook endpoint for ${hook}: format Raw, with the subscription, order and refund events.`,
    "Set POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET (the endpoint’s secret) and, while testing, POLAR_SERVER=sandbox. Restart the server.",
    "Paste each paid price’s Polar product id into /admin/plans.",
  ];
}

/** The setup steps with a placeholder for the webhook URL. */
export const BILLING_SETUP_STEPS: readonly string[] = billingSetupSteps();

/** The copy for an unexpected failure (logged, never shown): billingErrorMessage's default and the routes' JSON message. */
export const BILLING_GENERIC_ERROR = "Something went wrong on our side. Try again in a minute.";

/**
 * Plain copy for the `?error=<code>` the checkout and portal routes redirect
 * back with. Unknown or missing codes → null (show nothing).
 */
export function billingErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case undefined:
    case null:
    case "":
      return null;
    case "billing_disabled":
      return "Payments aren’t switched on for this site yet, so nothing can be bought right now. Free plans work as usual.";
    case "unavailable":
      return "Checkout isn’t available for this plan yet. It hasn’t been connected to a product at the payment provider.";
    case "not_found":
      return "We couldn’t find that plan, or you don’t have a billing account yet.";
    case "invalid":
      return "That plan can’t be bought this way. Pick another option or contact us.";
    case "already_subscribed":
      return "You already have a subscription. Change or cancel it from Manage billing.";
    case "already_owned":
      return "You already own this plan. Nothing more to pay.";
    case "too_large":
      return "That request was too large to read. Try again from this page.";
    case "rate_limited":
      return "Too many attempts. Wait a minute and try again.";
    case "forbidden":
      return "That request came from another site, so we stopped it. Try again from this page.";
    case DEMO_READ_ONLY_ERROR:
      return DEMO_READ_ONLY_MESSAGE;
    default:
      return BILLING_GENERIC_ERROR;
  }
}

/** What JSON callers (and the webhook's 404) are told while billing is off — for developers, so it says how to enable it. */
export const BILLING_DISABLED_MESSAGE =
  "Billing is off. Set POLAR_ACCESS_TOKEN and POLAR_WEBHOOK_SECRET (see .env.example) and restart to take payments with Polar.";

/** The refusals startCheckout explains in its ServiceError("conflict") `details.reason`; each has copy in billingErrorMessage. */
const CHECKOUT_CONFLICTS = ["already_subscribed", "already_owned"] as const;
export type CheckoutConflict = (typeof CHECKOUT_CONFLICTS)[number];

/**
 * The `?error=` code for a refused checkout, from the conflict's details: the
 * reason startCheckout gives, so the page says the right thing — "you already
 * own this" is not "you already have a subscription". A conflict with no known
 * reason reads as "already_subscribed".
 */
export function checkoutConflictCode(details: unknown): CheckoutConflict {
  const reason = typeof details === "object" && details !== null ? (details as { reason?: unknown }).reason : undefined;
  return CHECKOUT_CONFLICTS.find((r) => r === reason) ?? "already_subscribed";
}
