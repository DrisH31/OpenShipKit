# Copilot instructions

Read and follow [AGENTS.md](../AGENTS.md) at the repository root — it is the
single source of truth for how this codebase works (map, invariants, recipes,
commands, don'ts). [SPEC.md](../SPEC.md) is the contract behind it.

The essentials, in case you read nothing else:

- One stack: Next.js 16 App Router + Postgres (Drizzle) + Better Auth, self-hosted. Don't add hosted auth, database or analytics services. Polar (billing) and Resend (email) are optional and off by default.
- Every write goes through `src/server/services/*` (zod validation → DataStore → audit log). Pages and route handlers never write through the DataStore directly.
- Env is read lazily via `src/server/env.ts`, never at module scope; `next build` needs no environment.
- Drivers and SDKs are imported only in `src/adapters/*`. Client components never import `src/server`, `src/adapters` or `server-only` code.
- Next.js 16 APIs differ from older versions (async `params`/`searchParams`/`cookies()`/`headers()`, `proxy.ts`). Check `node_modules/next/dist/docs/` before using an API.
- Never `revalidate` a page that reads data, never `next/script` for JSON-LD, never content at `opacity: 0` on first paint, never a canonical in a layout, never a caught read error turned into an empty page — AGENTS.md, "Rules that cost traffic", says why each one.
- Before finishing: `npm run check`.
