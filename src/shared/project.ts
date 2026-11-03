//
// OpenShipKit's own repository: the ONE place its URL is written. The footer's
// "Built with OpenShipKit" credit, the deploy section, the default content's
// links and the product's links into the template's guides all read it, so a
// rename or a fork changes one line. Pure; safe on client and server.
//
// This is the TEMPLATE's repository, not the template user's product: a fork
// that drops the credit and the guide links can delete this file with them.
//

/**
 * The template's own product name. A site still called this hasn't been made
 * into the template user's product yet: it is the OpenShipKit showcase
 * (isShowcase in src/shared/seo.ts). src/content/defaults.ts names the site
 * this, and src/components/seo/seo.test.ts keeps the two equal.
 */
export const OPENSHIPKIT_NAME = "OpenShipKit";

/** The template's public repository. */
export const OPENSHIPKIT_REPO = "https://github.com/DrisH31/openshipkit";
/** OpenShipKit's sibling on hosted services (Clerk, Supabase, Polar). Named only on the showcase (the footer, the FAQ default). */
export const GETSHIPKIT_REPO = "https://github.com/DrisH31/GetShipKit";

/** `git clone` this. */
export const OPENSHIPKIT_CLONE_URL = `${OPENSHIPKIT_REPO}.git`;

/** A file or folder in the repository on the main branch: repoPath("docs/mcp.md"), repoPath("deploy", "tree"). */
export function repoPath(path: string, view: "blob" | "tree" = "blob"): string {
  return `${OPENSHIPKIT_REPO}/${view}/main/${path.replace(/^\/+/, "")}`;
}

/**
 * The studio that makes OpenShipKit. Credited on the showcase only
 * (isShowcase): the footer's "A project by". A renamed site never shows it.
 */
export const DRISH_LABS_URL = "https://drishlabs.com";
