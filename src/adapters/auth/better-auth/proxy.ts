//
// Better Auth in the proxy: an OPTIMISTIC check only — "is there a session
// cookie at all?" — so signed-out visitors to /dashboard and /admin go to the
// sign-in page without a round-trip. The cookie is not verified here; pages
// call requireUser()/requireAdmin(), which do.
//
// Never touches /api/*: webhooks and the MCP endpoint authenticate themselves.
// No server-only import: this module runs inside src/proxy.ts.
//

import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import { isProtectedPath, type AuthProxy } from "@/core/auth";

export const proxy: AuthProxy = async (request) => {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/") || pathname === "/api") return NextResponse.next();
  if (!isProtectedPath(pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(url);
};
