import "server-only";

//
// The tool registry: every tool the MCP server offers, in the order tools/list
// shows them (orientation first, then content, posts, media, plans, inbox and
// audit, then admin). To add a tool, define it in the matching file with defineTool
// and it appears here; docs/mcp.md must name it too (tests/mcp.test.ts checks).
//
// TOOLS is every tool the code defines. What a server OFFERS also depends on
// the profile: under OPENSHIPKIT_PROFILE=site there are no plans, so the plan
// tools are neither listed (tools/list) nor callable by name (tools/call says
// "Unknown tool", as for a name that never existed). Stored plans are untouched.
//

import type { SiteProfile } from "@/core/profile";
import type { AgentScope } from "@/core/types";
import { siteProfile } from "@/server/env";
import { scopeAllows } from "@/server/services/agent-keys";
import type { McpTool } from "../types";
import { ADMIN_TOOLS } from "./admin";
import { COMMUNITY_TOOLS } from "./community";
import { CONTENT_TOOLS } from "./content";
import { MEDIA_TOOLS } from "./media";
import { PLAN_TOOLS } from "./plans";
import { POST_TOOLS } from "./posts";
import { SITE_TOOLS } from "./site";

export const TOOLS: readonly McpTool[] = [...SITE_TOOLS, ...CONTENT_TOOLS, ...POST_TOOLS, ...MEDIA_TOOLS, ...PLAN_TOOLS, ...COMMUNITY_TOOLS, ...ADMIN_TOOLS];

/** The tools that exist only in the saas profile: plans are a SaaS's (src/core/profile.ts). */
export const SAAS_ONLY_TOOLS: ReadonlySet<string> = new Set(PLAN_TOOLS.map((t) => t.name));

/** The tools a server in `profile` offers, in TOOLS order. */
export function toolsForProfile(profile: SiteProfile): readonly McpTool[] {
  return profile === "site" ? TOOLS.filter((t) => !SAAS_ONLY_TOOLS.has(t.name)) : TOOLS;
}

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** A tool this server offers, by name, whatever its scope (the caller checks the scope). */
export function findTool(name: string): McpTool | undefined {
  if (SAAS_ONLY_TOOLS.has(name) && siteProfile() === "site") return undefined;
  return BY_NAME.get(name);
}

/** The tools a key with `scope` may see and call. */
export function toolsForScope(scope: AgentScope): McpTool[] {
  return toolsForProfile(siteProfile()).filter((t) => scopeAllows(scope, t.scope));
}
