//
// POST /api/billing/portal — open Polar's customer portal (cancel, change
// card, invoices). Form post (PortalButton) → 303 to the portal; JSON → { url }.
// Signed out → sign-in, returning to /dashboard/billing. Errors →
// /dashboard/billing?error=<code> (or JSON { error, message }); billing off
// (the default) → error=billing_disabled. OPENSHIPKIT_PROFILE=site → 404.
//

import { BILLING_DISABLED_MESSAGE, BILLING_GENERIC_ERROR } from "@/components/billing/format";
import { DEMO_READ_ONLY_ERROR, DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { getAuth } from "@/server/auth";
import { isDemoUser } from "@/server/demo";
import { saasOnlyResponse } from "@/server/profile";
import { isSameOrigin, json, seeOther, wantsJson, withParam } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { isBillingEnabled, openPortal } from "@/server/services/billing";
import { ServiceError } from "@/server/services/errors";
import { getCurrentUser } from "@/server/session";
import { log } from "@/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURN_TO = "/dashboard/billing";

export async function POST(request: Request): Promise<Response> {
  // OPENSHIPKIT_PROFILE=site: no billing routes at all (docs/site-profile.md).
  const off = saasOnlyResponse();
  if (off) return off;
  const asJson = wantsJson(request);
  const fail = (code: string, status: number, message: string) =>
    asJson ? json(status, { error: code, message }) : seeOther(withParam(RETURN_TO, "error", code));

  if (!isSameOrigin(request)) return fail("forbidden", 403, "Cross-site request refused");

  try {
    if (!(await isBillingEnabled())) return fail("billing_disabled", 503, BILLING_DISABLED_MESSAGE);

    const user = await getCurrentUser();
    if (!user) {
      const signIn = (await getAuth()).urls.signIn;
      const url = `${signIn}${signIn.includes("?") ? "&" : "?"}redirect=${encodeURIComponent(RETURN_TO)}`;
      return asJson ? json(401, { error: "unauthorized", message: "Sign in to manage billing", signInUrl: url }) : seeOther(url);
    }

    if (!rateLimit(`billing:portal:${user.id}`, 10, 60_000).ok) {
      return fail("rate_limited", 429, "Too many attempts. Wait a minute and try again.");
    }

    // The read-only demo admin has no billing to manage (openPortal refuses it too).
    if (isDemoUser(user)) return fail(DEMO_READ_ONLY_ERROR, 403, DEMO_READ_ONLY_MESSAGE);
    const url = await openPortal(user);
    return asJson ? json(200, { url }) : seeOther(url);
  } catch (error) {
    // A ServiceError (no customer yet → not_found) keeps its code and status; anything else is logged, never shown.
    if (error instanceof ServiceError) return fail(error.code, error.status, error.message);
    log.error("billing", "portal failed", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return fail("error", 500, BILLING_GENERIC_ERROR);
  }
}
