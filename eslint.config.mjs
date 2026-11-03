//
// ESLint: Next's Core Web Vitals and TypeScript presets, plus the import rules
// of SPEC.md §2 as `no-restricted-imports`, so a boundary slip fails `npm run
// lint` instead of waiting for review. The client-component rule ("use client"
// files never reach src/server, src/adapters or a server-only module) needs the
// import graph, so it is a test: tests/foundation.test.ts → "import boundaries".
//

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** The app's own top-level folders, as the @/ alias spells them. */
const APP = ["@/server/**", "@/adapters/**", "@/components/**", "@/lib/**", "@/hooks/**", "@/app/**"];

/** One `no-restricted-imports` rule from forbidden patterns (a glob list, or one regex) and why. */
const restrict = (group, message) =>
  ({ "no-restricted-imports": ["error", { patterns: [typeof group === "string" ? { regex: group, message } : { group, message }] }] });

const PURE = "src/core, src/shared and src/content are pure (SPEC §2): they import only each other and libraries, never the app.";
const ADAPTERS = "Only src/server registries (and src/proxy.ts, src/instrumentation.ts) import src/adapters (SPEC §2). Go through src/server instead.";
/** Unit tests next to code may build a memory store or mock a registry. */
const TESTS = ["**/*.test.ts", "**/*.test.tsx"];

const ACTIONS_ONLY = "Here the one sanctioned adapter import is @/adapters/auth/better-auth/actions (SPEC §2). Anything else goes through src/server.";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["src/core/**", "src/shared/**"], ignores: TESTS, rules: restrict([...APP, "@/content/**"], PURE) },
  { files: ["src/content/**"], ignores: TESTS, rules: restrict(APP, PURE) },
  { files: ["src/app/**", "src/components/**", "src/lib/**", "src/hooks/**"], ignores: TESTS, rules: restrict(["@/adapters/**"], ADAPTERS) },
  // The account-security server actions ("use server", safe to pass to client forms).
  {
    files: ["src/app/dashboard/**", "src/components/dashboard/**"],
    ignores: TESTS,
    rules: restrict("^@/adapters/(?!auth/better-auth/actions$)", ACTIONS_ONLY),
  },
  // Server code logs through src/server/log.ts: JSON in production, and errors reach ERROR_TRACKING_DSN (ROADMAP 1.3).
  // Client components ("use client") log to the browser and are exempt; so are the logger, the reporter (it can't
  // report its own failure), the console email provider (its output is the email) and instrumentation's Edge-safe dev warning.
  {
    files: ["src/server/**", "src/adapters/**", "src/app/**/route.ts", "src/app/**/actions.ts", "src/app/sitemap.ts"],
    ignores: [...TESTS, "src/server/log.ts", "src/server/error-reporting.ts", "src/adapters/email/console/**"],
    rules: { "no-console": ["error"] },
  },
  // Generated output: drizzle/ (drizzle-kit) and src/lib/cn-tables.ts (`cn build`, checked against cn-config.ts by src/lib/utils.test.ts).
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "drizzle/**", ".data/**", "src/lib/cn-tables.ts"]),
]);
