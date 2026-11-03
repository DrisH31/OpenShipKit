//
// The Content-Security-Policy, built in one place: the second layer behind the
// HTML sanitiser (src/server/markdown.ts). Pure; no imports, so next.config.ts
// (by relative path), the proxy and the tests can all read it.
//
// Pages get a fresh nonce per request (src/proxy.ts): `script-src 'nonce-…'
// 'strict-dynamic'`. Next stamps the nonce on its own bootstrap and chunk
// scripts (it reads it from the request's CSP header), the root layout hands it
// to the theme script, and scripts those load are trusted through
// 'strict-dynamic'. An inline <script> or on* handler that slips past the
// sanitiser has no nonce and does not run. No 'unsafe-inline' for scripts,
// ever — JSON-LD (<script type="application/ld+json">) is data, not script,
// and CSP doesn't block it.
//
// Everything else (route handlers, assets) gets the static policy from
// next.config.ts: no nonce and no inline script at all.
//
// The rest: no plugins, no <base> hijack, no framing, connections only to this
// origin, forms post only here, to Polar (checkout, portal) and to the optional
// GitHub/Google sign-in. Images from any https host (admin-authored posts);
// embeds only from youtube-nocookie (the sanitiser's one allowed iframe).
// Styles keep 'unsafe-inline': React style props and next/font need it, and a
// style can't run code. Development adds 'unsafe-eval' and websockets for Fast
// Refresh.
//

export interface CspOptions {
  /** The per-request nonce for a page; omitted for the static policy. */
  nonce?: string;
  /** Development: allow eval and websockets for Fast Refresh. */
  dev?: boolean;
}

export function contentSecurityPolicy({ nonce, dev = false }: CspOptions = {}): string {
  const scripts = ["'self'"];
  if (nonce) scripts.push(`'nonce-${nonce}'`, "'strict-dynamic'");
  if (dev) scripts.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    "media-src 'self' https:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self' https://polar.sh https://*.polar.sh https://github.com https://accounts.google.com",
  ].join("; ");
}

/** A fresh nonce: 16 random bytes, base64. Web Crypto, so it runs in any runtime. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The request header the proxy passes the nonce on; the root layout reads it with headers(). */
export const NONCE_HEADER = "x-nonce";
