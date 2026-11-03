//
// What a paying customer reads must name the provider in use, not Polar: a
// Stripe or Razorpay customer was told "Payments are handled by Polar" and
// sent to a Manage billing button Razorpay doesn't have (Phase 3 review).
// Customer-facing billing surfaces take the name from PROVIDER_LABEL and the
// portal from hasPortal; this fails on a provider name written into their code.
//

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CUSTOMER_FACING = ["src/app/dashboard/billing/page.tsx", "src/components/sections/pricing-plans.tsx", "src/components/dashboard/plan-card.tsx"];

/** The file without its comments: a comment may name a provider, a string the customer reads may not. */
const code = (path: string) =>
  readFileSync(resolve(__dirname, "..", path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("customer-facing billing copy", () => {
  it.each(CUSTOMER_FACING)("%s names no provider itself", (path) => {
    expect(code(path)).not.toMatch(/\b(Polar|Stripe|Razorpay)\b/);
  });
});
