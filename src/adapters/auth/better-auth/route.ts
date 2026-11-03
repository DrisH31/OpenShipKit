import "server-only";

//
// /api/auth/* for Better Auth: sign-in, sign-up, sessions, OAuth callbacks,
// email verification and password reset links all land here.
//

import { toNextJsHandler } from "better-auth/next-js";
import type { AuthRouteHandler } from "@/core/auth";
import { getBetterAuth } from "./instance";

// Built per request (the instance itself is cached) so nothing reads env at import time.
async function handlers() {
  return toNextJsHandler(await getBetterAuth());
}

export const handler: AuthRouteHandler = {
  async GET(request) {
    return (await handlers()).GET(request);
  },
  async POST(request) {
    return (await handlers()).POST(request);
  },
};
