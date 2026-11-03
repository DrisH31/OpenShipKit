//
// The plan editor's words: hints and labels for planSchema's fields, shared by
// /admin/plans/new and /admin/plans/<key>. Plain data, so it crosses into the
// client SchemaEditor as props.
//

export const PLAN_HINTS: Record<string, string> = {
  key: "Stable id used by checkout and entitlements, like pro or lifetime. Lower-case words joined by hyphens.",
  name: "What customers see on the pricing page.",
  features: "One per row, shown as a checklist on the card.",
  prices: "Empty makes it a free plan. At most one price per billing interval.",
  "prices.*.amountCents": "As you’d write it: 19 or 19.50. Stored in cents (1950), which is what the JSON tab shows.",
  "prices.*.currency": "Three letters, like usd or eur.",
  "prices.*.polarProductId": "From Polar → Products → the product’s id. Empty: this price shows but can’t be bought yet.",
  "prices.*.stripePriceId": "BILLING_PROVIDER=stripe: the Stripe price’s id (price_…). Empty: this price shows but can’t be bought yet.",
  "prices.*.razorpayPlanId": "BILLING_PROVIDER=razorpay: the Razorpay plan’s id (plan_…), for a monthly or yearly price. A one-time price needs none.",
  "prices.*.perSeat":
    "With teams on (OPENSHIPKIT_TENANCY=org): an organisation buys one seat per member and open invitation, and invitations stop at the seat count. The Polar product must use seat-based pricing. Monthly or yearly only.",
  highlighted: "Marks the card as the one to pick.",
  contactSales: "Shows a “Contact sales” button (or your button label) that opens the contact form, instead of checkout.",
  ctaLabel: "The button on the card.",
  trialDays: "Empty means no trial.",
  active: "Inactive plans disappear from the pricing page; existing customers keep them.",
  sortOrder: "Lower numbers show first.",
};

export const PLAN_LABELS: Record<string, string> = {
  "prices.*.amountCents": "Amount",
  "prices.*.polarProductId": "Polar product id",
  "prices.*.perSeat": "Charged per seat",
  "prices.*.stripePriceId": "Stripe price id",
  "prices.*.razorpayPlanId": "Razorpay plan id",
  ctaLabel: "Button label",
  contactSales: "Contact sales instead of checkout",
  highlighted: "Highlight this plan",
};

/** Prices are typed in the main unit with their currency's symbol, stored in cents (SchemaEditor `money`). */
export const PLAN_MONEY: Record<string, string> = {
  "prices.*.amountCents": "currency",
};

export const PLAN_OPTION_LABELS: Record<string, Record<string, string>> = {
  "prices.*.interval": { month: "Monthly", year: "Yearly", one_time: "One-time" },
};
