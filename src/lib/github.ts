//
// One GitHub action, one look: a button that links to github.com carries the
// GitHub mark before its label (the header's action, the hero's and the
// close's primary). Pure and client-safe; written once so the three can't
// disagree about what counts as a GitHub link.
//

/** True for a github.com address (http or https, with or without www). */
export function isGitHubUrl(href: string): boolean {
  try {
    const host = new URL(href).hostname;
    return host === "github.com" || host === "www.github.com";
  } catch {
    return false;
  }
}
