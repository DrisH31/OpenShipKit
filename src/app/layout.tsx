//
// The root layout: wraps every page, public and signed-in. It sets
// `dynamic = "force-dynamic"` (SPEC invariant 1: content is read at request
// time, never baked into the build), loads the three self-hosted font faces,
// builds the site-wide metadata from the editable `site` content (name,
// tagline, locale, social handle) and wraps the page in the theme provider —
// nothing else, so public pages stay light. The theme script carries the
// request's CSP nonce (set by src/proxy.ts, policy in src/core/csp.ts): pages
// run no inline script without it.
//

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist_Mono, Inter, Space_Grotesk } from "next/font/google";
import { getSiteSeo } from "@/components/seo/site-seo";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { htmlLang, openGraphLocale } from "@/core/content";
import { NONCE_HEADER } from "@/core/csp";
import { getContent } from "@/server/services/content";
import { ROBOTS_INDEX } from "@/shared/seo";
import "./globals.css";

// Faces are self-hosted by next/font: no request to Google at runtime. Only the
// latin subset is preloaded (two files); add "latin-ext" for accented languages,
// knowing next/font preloads every subset listed. Inter keeps its opsz axis:
// font-optical-sizing is auto, so the browser uses it at every size.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const text = Inter({ subsets: ["latin"], axes: ["opsz"], variable: "--font-inter", display: "swap" });
const code = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });

// Every page reads the DataStore at request time. Never add `revalidate` to a
// page that reads data: the build has no database and would bake in empty content.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // The same per-request values every page's metadata uses: one content read,
  // one X handle parser (xHandle), one safe social image.
  const { site, base, twitterSite, ogImage } = await getSiteSeo();
  return {
    metadataBase: new URL(base),
    title: { default: `${site.name} — ${site.tagline}`, template: `%s · ${site.name}` },
    description: site.description,
    keywords: site.keywords,
    applicationName: site.name,
    // No canonical or og:url here: they would leak to every page that doesn't set its
    // own and point it at the home page. Each page sets them with pageMetadata().
    alternates: { types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: `${site.name} blog` }] } },
    openGraph: {
      type: "website",
      siteName: site.name,
      title: `${site.name} — ${site.tagline}`,
      description: site.description,
      locale: openGraphLocale(site.locale),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      ...(twitterSite ? { site: twitterSite } : {}),
    },
    // Large image previews (the 1200×630 cards every post has) in Search and Discover; full snippets.
    // The same constant pageMetadata repeats, since a page's robots replaces the layout's.
    robots: { ...ROBOTS_INDEX },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E6E6E6" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" }, // --bg in src/styles/tokens.css
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [site, nonce] = await Promise.all([getContent("site"), headers().then((h) => h.get(NONCE_HEADER) ?? undefined)]);
  return (
    <html lang={htmlLang(site.locale)} suppressHydrationWarning className={`${display.variable} ${text.variable} ${code.variable}`}>
      <body>
        {/* Only the theme wraps every page. Toasts and tooltips are the signed-in
            shell's (src/components/product/app-shell.tsx), so public pages
            don't ship sonner or Base UI's floating layer. */}
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
