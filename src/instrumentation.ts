//
// Next.js runs register() once when a server process starts, before it
// serves requests.
//
// Production: checks the environment and refuses to start without what every
// request needs (src/server/boot-check.ts has the list). A Postgres server is
// migrated by `npm run db:migrate` (the compose `migrate` service); an
// embedded one is readied lazily by getData().
//
// Development: gets the embedded database ready (migrations + first-boot seed)
// when no DATABASE_URL is set, then the read-only demo admin when
// DEMO_ADMIN_EMAIL is set (src/server/services/demo-account.ts; on a Postgres server it
// is ensured by the first "Try the demo" instead). NODE_ENV is inlined at build time, so the
// bundler drops that import from production builds — and with it the file
// trace that would otherwise copy the whole repository into .next/standalone.
//
// Next also compiles this file for the Edge runtime. Everything Node-only is
// therefore a dynamic import inside the NEXT_RUNTIME === "nodejs" branch, so
// the Edge bundle never sees process.exit or the database driver.
//

import { demoAdminProblems, resolveDataMode } from "@/server/env-rules";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production") {
      const { checkProductionEnv } = await import("@/server/boot-check");
      return checkProductionEnv();
    }
    // Production refuses these (boot-check.ts); development says so and runs without the demo admin.
    for (const problem of demoAdminProblems(process.env)) console.warn(`[openshipkit] ${problem} The demo admin is off until it's fixed.`);
    let mode: string;
    try {
      mode = resolveDataMode(process.env);
    } catch {
      return; // an unknown DATA_PROVIDER: getData() says so on the first request
    }
    if (mode !== "embedded-postgres") return;
    const { prepareEmbeddedDatabase } = await import("@/adapters/data/postgres/embedded");
    await prepareEmbeddedDatabase();
    // The read-only demo admin (DEMO_ADMIN_EMAIL), ready before the first "Try the demo".
    const { ensureDemoAccountInBackground } = await import("@/server/services/demo-account");
    ensureDemoAccountInBackground("boot");
  }
}
