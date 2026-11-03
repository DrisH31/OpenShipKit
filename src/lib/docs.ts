//
// Links from the product into OpenShipKit's own guides (the docs/ folder of the
// template's repository, src/shared/project.ts). One place, so a fork can
// point them at its own copy or remove the links.
//
// These are the template's docs, not the template user's product: they appear
// on the getting-started checklist and in admin hints, never on public pages.
//

import { repoPath } from "@/shared/project";

export type DocPage = "getting-started" | "customization" | "content" | "billing" | "email" | "deployment" | "mcp" | "auth" | "security";

/** A guide under docs/ on the main branch. */
export function docUrl(page: DocPage): string {
  return repoPath(`docs/${page}.md`);
}
