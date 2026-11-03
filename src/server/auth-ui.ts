import "server-only";

//
// The auth adapter's UI (sign-in, sign-up, the /auth/<page> pages, the
// sign-out button) — kept out of src/server/auth.ts on purpose.
//
// ui.tsx renders the auth forms, which are client components. Anything that
// imports this module puts those forms in its route's client bundle, so only
// the routes that SHOW them import it: src/app/(auth)/**, the dashboard's
// settings page and the product shell (sign-out). Public pages and the
// session helpers import src/server/auth.ts, which never reaches ui.tsx.
//

import type { AuthUI } from "@/core/auth";
import { ui } from "@/adapters/auth/better-auth/ui";

export async function getAuthUI(): Promise<AuthUI> {
  return ui;
}
