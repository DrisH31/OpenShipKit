import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/core/csp";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy: built in src/core/csp.ts. This is the STATIC
// policy, for route handlers and assets: no nonce, so no inline script at all.
// Pages get a per-request nonce policy from the proxy (src/proxy.ts), which
// replaces this header on every response it handles.
const contentSecurityPolicyHeader = contentSecurityPolicy({ dev: isDev });

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicyHeader },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // HSTS without `preload`: preloading is near-irreversible and needs every subdomain on HTTPS first.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone — what the Dockerfile copies.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
    // Bounded cache on a shared disk (CVE-2026-27980). Raise it if you serve many images.
    maximumDiskCacheSize: 512 * 1024 * 1024,
    minimumCacheTTL: 60 * 60 * 4,
    // Add the hosts your images live on (your object storage, a CDN …). Keep this list short: each entry is an SSRF surface.
    // These two serve avatars for the optional GitHub and Google sign-in.
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Uploaded media (src/app/uploads): a file opened directly gets no script,
      // no styles and a sandbox. Listed after the site-wide entry, so this CSP wins.
      { source: "/uploads/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox" }] },
    ];
  },
  // The IndexNow key file must answer at the site root (/<INDEXNOW_KEY>.txt);
  // src/app/api/indexnow/[key] serves it, and 404s any other name. A plain array
  // is an afterFiles rewrite: robots.txt, llms.txt and llms-full.txt are matched
  // first, so the pattern can't capture them.
  async rewrites() {
    return [{ source: "/:key([A-Za-z0-9-]{8,128})\\.txt", destination: "/api/indexnow/:key" }];
  },
  // Belt and braces: never ship the local embedded database or env files in
  // .next/standalone. (The real fix is at the source — the PGlite path carries a
  // turbopackIgnore comment and instrumentation drops its dev-only import in
  // production.) Keep these globs specific: a broad one such as "src/**" also
  // matches node_modules/<pkg>/src and silently breaks packages at runtime.
  outputFileTracingExcludes: {
    "/*": ["./.data/**", "./.env", "./.env.*"],
  },
  // The /docs pages read the repository's docs/*.md at request time
  // (src/server/docs.ts), and so do the sitemap and the llms files that list
  // them. The read whose file name varies is turbopackIgnore'd (so the tracer
  // can't sweep in the project), so the files are named here, for exactly the
  // routes that read them; CI checks .next/standalone/docs has them. Images
  // are served from GitHub, not from here (.dockerignore drops docs/images).
  // Keys are route globs (picomatch, matched anywhere in the route path).
  outputFileTracingIncludes: Object.fromEntries(
    ["/docs", "/docs/**", "/sitemap.xml", "/llms.txt", "/llms-full.txt"].map((route) => [route, ["./docs/*.md", "./docs/modules/*.md", "./docs/nav.json"]]),
  ),
  // Packages that must stay as Node requires on the server (native or dynamic code).
  serverExternalPackages: ["pg", "@electric-sql/pglite", "sanitize-html"],
};

export default nextConfig;
