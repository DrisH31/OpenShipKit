//
// Starter data: the plans and posts a fresh install shows. Loaded by the
// memory adapter on boot, by the embedded database's first boot and by
// `npm run db:seed`. Safe to edit or delete; nothing depends on these rows.
//

import type { PlanInput, PostInput } from "@/core/types";
import { SEED_POSTS } from "./seed-posts";

export const SEED_PLANS: PlanInput[] = [
  {
    key: "free",
    name: "Free",
    description: "For side projects and trying things out.",
    features: ["1 project", "Community support", "All core features"],
    prices: [],
    highlighted: false,
    contactSales: false,
    ctaLabel: "Start free",
    trialDays: null,
    active: true,
    sortOrder: 0,
  },
  {
    key: "pro",
    name: "Pro",
    description: "For founders shipping a real product.",
    features: ["Unlimited projects", "Priority email support", "Advanced analytics", "Custom domain"],
    prices: [
      { interval: "month", amountCents: 1900, currency: "usd", polarProductId: null },
      { interval: "year", amountCents: 19000, currency: "usd", polarProductId: null },
    ],
    highlighted: true,
    contactSales: false,
    ctaLabel: "Upgrade to Pro",
    trialDays: 14,
    active: true,
    sortOrder: 1,
  },
  {
    key: "lifetime",
    name: "Lifetime",
    description: "Pay once, keep Pro forever.",
    features: ["Everything in Pro", "Pay once, no renewals", "Lifetime license"],
    prices: [{ interval: "one_time", amountCents: 29900, currency: "usd", polarProductId: null }],
    highlighted: false,
    contactSales: false,
    ctaLabel: "Buy once",
    trialDays: null,
    active: true,
    sortOrder: 2,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "SSO, SLAs and a contract your legal team will like.",
    features: ["Everything in Pro", "SSO and SCIM", "Uptime SLA", "Dedicated support"],
    prices: [],
    highlighted: false,
    contactSales: true,
    ctaLabel: "Contact sales",
    trialDays: null,
    active: true,
    sortOrder: 3,
  },
];

export const SEED: { plans: PlanInput[]; posts: PostInput[] } = {
  plans: SEED_PLANS,
  posts: SEED_POSTS,
};
