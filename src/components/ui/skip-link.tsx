/* Standards (web-design): PAGE-14 A keyboard can skip to the content · LAY-8 Focus is visible and never hidden */

/** The first thing Tab reaches on every page: hidden until it has focus, then a pill in the top
    corner above everything, landing on the page’s one `<main id="main">`. Put it first in the layout
    that holds the header and the main, never in a page. Pass the words in the page’s language. */
export function SkipLink({ href = "#main", children = "Skip to content" }: { href?: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      data-slot="skip-link"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50 focus:rounded-full focus:bg-action focus:px-4 focus:py-2 focus:text-small focus:text-action-ink"
    >
      {children}
    </a>
  )
}
