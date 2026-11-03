//
// /api/auth/* — Better Auth's endpoints: sign-in/up, sessions, OAuth callbacks
// (/api/auth/callback/github|google), email verification, password reset,
// two-factor. See src/adapters/auth/better-auth/route.ts.
//

import { getAuthRouteHandler } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return (await getAuthRouteHandler()).GET(request);
}

export async function POST(request: Request) {
  return (await getAuthRouteHandler()).POST(request);
}
