import "server-only";

//
// The profile guard for the routes only a SaaS has (src/core/profile.ts lists
// them): /pricing, /dashboard/billing, /admin/plans and their server actions
// call requireSaasProfile() before anything else, so under
// OPENSHIPKIT_PROFILE=site they are a plain 404 — the same answer as a page
// that was never there, not a "switched off" notice a crawler would index.
// Route handlers (/api/billing/*) can't use notFound(); they answer
// saasOnlyResponse() instead.
//

import { notFound } from "next/navigation";
import { siteProfile } from "./env";

/** True under OPENSHIPKIT_PROFILE=site: a landing page + blog, no pricing, billing or plans. */
export function isSiteProfile(): boolean {
  return siteProfile() === "site";
}

/** 404 (notFound()) under the site profile; nothing under saas. Call it first in a SaaS-only page, layout or action. */
export function requireSaasProfile(): void {
  if (isSiteProfile()) notFound();
}

/** A route handler's 404 under the site profile, or null to carry on. */
export function saasOnlyResponse(): Response | null {
  if (!isSiteProfile()) return null;
  return Response.json({ error: "not_found", message: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}
