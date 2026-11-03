//
// POST /api/billing/checkout — start a Polar hosted checkout.
//
// Takes { planKey, interval } as a form post (CheckoutButton) or JSON. Forms get
// a 303 to Polar; JSON gets { url }. Signed out → sign-in, returning to
// /pricing. Errors → /pricing?error=<code> (or JSON { error, message }); the
// pricing page turns the code into copy with billingErrorMessage().
//
// OPENSHIPKIT_PROFILE=site → 404, before anything else (no billing routes).
// Billing off (the default) → error=billing_disabled before anything else, so
// a visitor isn't sent through sign-in for a checkout that can't happen. The
// body is read with the shared byte cap (src/server/http.ts) BEFORE sign-in is
// checked, so an anonymous oversized post is refused (too_large, 413) without
// being buffered. A refusal from startCheckout keeps its reason:
// already_subscribed or already_owned, each with its own copy.
//
// This route never grants anything: access arrives only through the verified
// webhook (/api/billing/webhook). The product id comes from the plan in the
// DataStore, never from the request.
//

import { z } from "zod";
import { BILLING_DISABLED_MESSAGE, BILLING_GENERIC_ERROR, checkoutConflictCode } from "@/components/billing/format";
import { slugSchema } from "@/core/schemas";
import { DEMO_READ_ONLY_ERROR, DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { getAuth } from "@/server/auth";
import { isDemoUser } from "@/server/demo";
import { saasOnlyResponse } from "@/server/profile";
import { FORM_BODY_BYTES, isSameOrigin, json, readFields, seeOther, wantsJson, withParam } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { isBillingEnabled, startCheckout } from "@/server/services/billing";
import { ServiceError } from "@/server/services/errors";
import { getCurrentUser } from "@/server/session";
import { log } from "@/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  planKey: slugSchema,
  interval: z.enum(["month", "year", "one_time"]),
});

const RETURN_TO = "/pricing";

export async function POST(request: Request): Promise<Response> {
  // OPENSHIPKIT_PROFILE=site: no billing routes at all (docs/site-profile.md).
  const off = saasOnlyResponse();
  if (off) return off;
  const asJson = wantsJson(request);
  const fail = (code: string, status: number, message: string, path = RETURN_TO) =>
    asJson ? json(status, { error: code, message }) : seeOther(withParam(path, "error", code));

  if (!isSameOrigin(request)) return fail("forbidden", 403, "Cross-site request refused");

  try {
    if (!(await isBillingEnabled())) return fail("billing_disabled", 503, BILLING_DISABLED_MESSAGE);

    const fields = await readFields(request, FORM_BODY_BYTES);
    if (fields === null) return fail("too_large", 413, "That request was too large to read");
    const parsed = inputSchema.safeParse(fields);
    if (!parsed.success) return fail("invalid", 400, "Choose a plan and a billing interval");
    const { planKey, interval } = parsed.data;

    const user = await getCurrentUser();
    if (!user) {
      const signIn = (await getAuth()).urls.signIn;
      const url = `${signIn}${signIn.includes("?") ? "&" : "?"}redirect=${encodeURIComponent(RETURN_TO)}`;
      return asJson ? json(401, { error: "unauthorized", message: "Sign in to subscribe", signInUrl: url }) : seeOther(url);
    }

    // Each checkout creates a session at Polar; a loop shouldn't make hundreds.
    if (!rateLimit(`billing:checkout:${user.id}`, 10, 60_000).ok) {
      return fail("rate_limited", 429, "Too many checkout attempts. Wait a minute and try again.");
    }

    // The read-only demo admin buys nothing (startCheckout refuses it too); its own code, so the page says why.
    if (isDemoUser(user)) return fail(DEMO_READ_ONLY_ERROR, 403, DEMO_READ_ONLY_MESSAGE);
    const url = await startCheckout(user, planKey, interval);
    return asJson ? json(200, { url }) : seeOther(url);
  } catch (error) {
    // startCheckout refuses a second live subscription (two tabs, a double
    // click) — plan changes and cancellations go through the portal instead —
    // and buying a one-time plan twice. Its details.reason says which.
    if (error instanceof ServiceError) {
      if (error.code === "conflict") return fail(checkoutConflictCode(error.details), 409, error.message, "/dashboard/billing");
      return fail(error.code, error.status, error.message);
    }
    // Anything else is a bug or an outage: logged, never shown.
    log.error("billing", "checkout failed", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return fail("error", 500, BILLING_GENERIC_ERROR);
  }
}
