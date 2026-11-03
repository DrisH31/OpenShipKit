"use client";

//
// The last resort: shown when the root layout itself fails. It replaces the
// whole document, so it brings its own <html>, <body> and styles (globals.css)
// and can't rely on the theme provider, content or fonts — the scheme follows
// the system (prefers-color-scheme), and the faces fall back to system-ui.
// No metadata export is allowed here; a React <title> names the tab.
//

import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong</title>
        <meta name="robots" content="noindex" />
        {/* No theme provider here: follow the system scheme by toggling the class before paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
      </head>
      <body>
        <main className="mx-auto flex min-h-svh w-full max-w-content flex-col justify-center px-gutter py-16">
          <p className="mb-6 text-eyebrow font-semibold tracking-[0.08em] text-ink-3 uppercase">Something went wrong</p>
          <h1 className="max-w-[18ch] text-display font-bold text-ink">The site hit an error</h1>
          <p className="mt-8 max-w-measure text-lead text-ink-2">
            It’s on our side, and it’s been logged. Try again in a moment.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-action px-6 text-body font-semibold text-action-ink transition-colors hover:bg-action-hover"
            >
              Try again
            </button>
            {/* A full page load on purpose: the app's router may be what broke. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-field px-6 text-body font-semibold text-ink transition-colors hover:bg-tonal"
            >
              Go to the home page
            </a>
          </div>
          {error.digest && (
            <p className="mt-8 text-caption text-ink-3">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
