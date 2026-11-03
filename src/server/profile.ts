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
import type { Feature } from "@/core/profile";
import { siteProfile, without } from "./env";

/** True under OPENSHIPKIT_PROFILE=site: a landing page + blog, no pricing, billing or plans. */
export function isSiteProfile(): boolean {
  return siteProfile() === "site";
}

/** 404 (notFound()) under the site profile; nothing under saas. Call it first in a SaaS-only page, layout or action. */
export function requireSaasProfile(): void {
  if (isSiteProfile()) notFound();
}

/** Whether a feature is on (not in OPENSHIPKIT_WITHOUT). */
export function featureOn(feature: Feature): boolean {
  return !without().includes(feature);
}

/** 404 (notFound()) when `feature` is switched off. Call it first in that feature's pages, layouts and actions. */
export function requireFeature(feature: Feature): void {
  if (!featureOn(feature)) notFound();
}

/** A route handler's 404 when `feature` is switched off, or null to carry on. */
export function featureResponse(feature: Feature): Response | null {
  if (featureOn(feature)) return null;
  return Response.json({ error: "not_found", message: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

/** A route handler's 404 under the site profile, or null to carry on. */
export function saasOnlyResponse(): Response | null {
  if (!isSiteProfile()) return null;
  return Response.json({ error: "not_found", message: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}
