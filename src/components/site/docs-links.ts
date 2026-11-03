//
// Links into /docs, left out where the docs aren't published. OpenShipKit's own
// docs are served at /docs only on the showcase, or on a renamed site that sets
// OPENSHIPKIT_PUBLIC_DOCS=true (src/server/docs.ts, docsOn). The default
// navigation, hero and close link to them; a renamed site that keeps those
// defaults would otherwise show a "Docs" link that answers 404. Pure: the caller
// says whether the docs are on.
//

/** True for "/docs", "/docs/…", "/docs#…" and "/docs?…". */
export function isDocsHref(href: string): boolean {
  return /^\/docs(?:[/?#]|$)/.test(href);
}

/** `links` without the ones into /docs, when the docs are off. */
export function withoutDocsLinks<T extends { href: string }>(links: T[], docs: boolean): T[] {
  return docs ? links : links.filter((l) => !isDocsHref(l.href));
}
