//
// Next 16's proxy (formerly middleware), Node runtime. Two jobs, pages only:
//
//   1. Redirects signed-out visitors away from /dashboard and /admin — an
//      OPTIMISTIC check on the session cookie only
//      (src/adapters/auth/better-auth/proxy.ts). Pages and actions still call
//      requireUser()/requireAdmin(): never trust the proxy alone.
//   2. Gives every page a fresh CSP nonce (src/core/csp.ts): set on the
//      request's Content-Security-Policy header, which Next reads to stamp its
//      own scripts, and on `x-nonce` for the root layout (the theme script);
//      and the same policy on the response.
//
// It never runs on /api/*: webhooks and the MCP endpoint authenticate
// themselves, and route handlers keep the static policy from next.config.ts.
//

import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { proxy as authProxy } from "@/adapters/auth/better-auth/proxy";
import { NONCE_HEADER, contentSecurityPolicy, createNonce } from "@/core/csp";

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const auth = await authProxy(request, event);
  // A redirect (or anything but "carry on") goes out as the auth proxy made it.
  if (auth && auth.headers.get("x-middleware-next") !== "1") return auth;

  const nonce = createNonce();
  const policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV !== "production" });
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    // Pages only: not /api, Next internals, generated metadata files or static assets.
    "/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|robots.txt|sitemap.xml|llms.txt|llms-full.txt|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff2?|txt|xml|webmanifest)$).*)",
  ],
};
