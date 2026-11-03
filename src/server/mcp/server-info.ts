import "server-only";

//
// Who the MCP server says it is, and the version /api/health reports. The
// version is package.json's, so a release bump is the only place to change it.
//
// INSTRUCTIONS is what a client may put in the model's system prompt: it is
// the one paragraph every agent reads, so it says how to work safely, not
// what each tool does (tool descriptions do that).
//

import type { SiteProfile } from "@/core/profile";
import pkg from "../../../package.json";

export const OPENSHIPKIT_VERSION: string = pkg.version;

export const SERVER_INFO = {
  name: "openshipkit",
  title: "OpenShipKit",
  version: OPENSHIPKIT_VERSION,
} as const;

export const INSTRUCTIONS = [
  "This server runs an OpenShipKit website: its landing-page content, blog, changelog, legal pages, pricing plans, feedback inbox, audit log and (with an admin key) users, subscribers and agent keys.",
  "Call `guide` once at the start: it lists the editable content keys with their JSON schemas, the post kinds and the plan model. `site_overview` shows the stack and what changed recently.",
  "Read before you write (content_get, post_get, plan_get) and change only what you were asked to. To change one field of a section, use content_update with mode \"merge\" and pass just that field.",
  "Changes are LIVE as soon as a call returns: pages render at request time. Drafts (status \"draft\") are invisible to the public.",
  "Every write is recorded in the audit log with the value before and after; audit_list finds an entry and audit_restore undoes changes to content, posts and plans.",
  "Never invent facts: no made-up customers, testimonials, statistics, prices or product ids. When something is unknown, ask the person you are working for.",
  "A refused call returns isError with {error, message, details}; read the message, fix the arguments and retry rather than guessing.",
].join(" ");

/** INSTRUCTIONS for this profile: under OPENSHIPKIT_PROFILE=site it says there are no plans, so no agent goes looking for plan_* tools. */
export function instructionsFor(profile: SiteProfile): string {
  if (profile === "saas") return INSTRUCTIONS;
  return `${INSTRUCTIONS} This site runs the site profile (OPENSHIPKIT_PROFILE=site): a landing page and blog with no pricing page, billing or plans, so there are no plan tools and the pricing section is not shown.`;
}
