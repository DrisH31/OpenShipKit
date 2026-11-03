import "server-only";

//
// The auth entry points: Better Auth, self-hosted. Pages use the helpers in
// src/server/session.ts (getCurrentUser, requireUser, requireAdmin), which
// resolve the signed-in Identity into the app's own User.
//
// The auth UI lives in ./auth-ui.ts, not here: this module is imported by every
// public page (the site header asks who is signed in), and importing the UI —
// even lazily, with import() — would ship every auth form in their client
// bundles. Nothing here may import ./auth-ui; tests/foundation.test.ts
// ("import boundaries") walks the graph from the public pages and fails if it
// is reached.
//

import type { AuthAdapter, AuthRouteHandler } from "@/core/auth";
import { adapter } from "@/adapters/auth/better-auth/server";
import { handler } from "@/adapters/auth/better-auth/route";

export async function getAuth(): Promise<AuthAdapter> {
  return adapter;
}

export async function getAuthRouteHandler(): Promise<AuthRouteHandler> {
  return handler;
}
