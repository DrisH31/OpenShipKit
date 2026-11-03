//
// The read-only demo admin — the words and numbers every layer shares. Pure:
// no I/O, safe on the client and the server.
//
// A deployed OpenShipKit showcase (with DEMO_ADMIN_* set) lets a visitor open the
// admin with one click ("Try the demo", POST /api/demo). That signs them in as
// one shared account, DEMO_ADMIN_EMAIL, which is an admin that can change
// nothing: every write service refuses it (src/server/demo.ts →
// assertNotDemo), Better Auth refuses it every credential change
// (src/adapters/auth/better-auth/instance.ts), and the admin shows it other
// people's emails, names and messages masked (src/shared/privacy-mask.ts).
// docs/auth.md → "The read-only demo admin".
//

/** What a demo visitor is told when anything would change: one sentence, every layer. */
export const DEMO_READ_ONLY_MESSAGE = "This is the read-only demo account: nothing can be changed. Clone the template to try it for real.";

/** The Better Auth error code (APIError body) for a refused credential change; errors.ts gives it the sentence above. */
export const DEMO_READ_ONLY_CODE = "DEMO_READ_ONLY";

/** The `?error=` / JSON code the route handlers answer a demo write with (media upload, billing, export). */
export const DEMO_READ_ONLY_ERROR = "read_only";

/** The banner on every admin and dashboard page while the demo account is signed in. */
export const DEMO_BANNER_TEXT = "Read-only demo: you can look at everything; saving is switched off.";

/** The demo account's display name (its Better Auth user and the app's row). */
export const DEMO_ACCOUNT_NAME = "Demo admin";

/**
 * How long one "Try the demo" session lasts. The session is also a browser
 * session (no Max-Age: it ends when the browser closes) and is never extended
 * by activity (Better Auth skips refreshing a "don't remember me" session).
 */
export const DEMO_SESSION_SECONDS = 2 * 60 * 60;

/** Where "Try the demo" lands. */
export const DEMO_LANDING = "/admin";
