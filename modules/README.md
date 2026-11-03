# modules — opt-in capability, off by default

Three features that most sites built on OpenShipKit don’t need, kept here
complete, typechecked and tested so they are ready the day you do:

| Module | What it adds | Needs | Installs |
|---|---|---|---|
| [`ai/`](ai/README.md) | Chat and image generation for signed-in people, behind spend controls: model allowlist, per-process bulkhead, per-minute limit, refundable daily quota, a total deadline. Plan holders can be unmetered. | an OpenAI-compatible endpoint (OpenRouter, or your own Ollama / vLLM); fal.ai optional for images | nothing |
| [`rag/`](rag/README.md) | Each person’s own documents: chunk, embed, hybrid search (pgvector + full text, fused), and answers grounded in what was retrieved, with sources. | `ai/`; pgvector in your Postgres; an embeddings endpoint | `@electric-sql/pglite-pgvector` (development database only) |
| [`redis/`](redis/README.md) | A cache seam and a rate limiter shared across replicas. In-memory until `REDIS_URL` is set; then any Redis or Valkey you run. | nothing (a Redis/Valkey server once you scale out) | nothing |

The app imports none of this. `next build` doesn’t bundle it, no route
exists, no table is created, and no variable is read until you enable a
module. Guides for deciding: [docs/modules](../docs/modules/README.md).

---

## How a module is built

A module is written the way the app is (SPEC.md), so enabling it adds no new
rules:

- **Services are the only write path.** `service.ts` validates with zod
  (`parseInput`), goes through the module’s store, and records writes with
  `recordAudit` (`rag_document.create`, `rag_document.delete`). Routes,
  your pages and your server actions call the service.
- **A store contract with two adapters**, like the DataStore: a memory
  reference implementation (what `DATA_PROVIDER=memory` and unit tests use)
  and a Postgres one over the app’s Drizzle client. One contract test suite
  runs on both (`tests/modules/`).
- **Plain SQL migrations**, applied as Drizzle custom migrations, so the
  embedded development database, `npm run db:migrate` and the compose
  `migrate` service all apply them like any other.
- **Sessions from `@/server/session`.** Route handlers answer `401` JSON
  (they don’t redirect), refuse cross-site writes with the app’s
  `isSameOrigin` check, and read bodies with the shared byte cap.
- **Env read lazily** through `optionalEnv` (`shared/config.ts`): the build
  needs none of it, and a bad value names its variable.
- **Third parties are optional and off** until their keys are set, and every
  provider can be swapped for one you host (an OpenAI-compatible base URL).

| Path | Purpose |
|---|---|
| `shared/config.ts` | `intEnv`, `boolEnv`, `listEnv`, `urlEnv` over `optionalEnv` |
| `shared/api.ts` | `apiUser`, `readJsonObject`, `apiError`, `UpstreamError`: what every module route does before and after its service |
| `<module>/README.md` | what it does, requirements, enable steps, environment, removal |
| `<module>/service.ts` | what routes, pages and actions call |
| `<module>/routes/*.ts` | route handlers, mounted by a three-line file under `src/app/api/` |
| `<module>/migration.sql` | the tables, applied as a Drizzle custom migration |

## Enabling one, in general

Each README has the exact steps; they always have this shape:

1. **Install** what it lists (usually nothing).
2. **Apply its SQL**, with `npm run dev` stopped (the embedded database
   allows one process, and the dev server would otherwise apply the
   still-empty migration file the moment it appears):

   ```bash
   npm run db:generate -- --custom --name <module>   # prints drizzle/00NN_<module>.sql
   cp modules/<module>/migration.sql drizzle/00NN_<module>.sql
   ```

   The dev server applies it on its next start; a deploy applies it with
   `npm run db:migrate` (the compose `migrate` service does this for you).
3. **Mount its routes**: one file per route under `src/app/api/`, each a
   re-export. The handler stays in `modules/`, so disabling is deleting
   the route file, not surgery on it:

   ```ts
   // src/app/api/ai/chat/route.ts
   export { POST } from "../../../../../modules/ai/routes/chat";
   export const runtime = "nodejs";
   export const dynamic = "force-dynamic";
   ```

4. **Set its variables** in `.env.local` (development) or your server’s
   environment, and add the README’s block to `.env.example`.

Disabling is the reverse: delete the route files and the module is inert.
Its tables stay until you drop them — a separate, deliberate step each README
spells out (as a new migration, never by editing an applied one).

## Keeping them healthy

They are in the toolchain even while unused: `npm run check` typechecks
(`tsconfig.json` includes every `.ts` file), lints and tests them
(`tests/modules/`). `npx tsc --noEmit -p tsconfig.modules.json` checks just
the modules and the core they import.

## Order

```
redis ──(optional, one import line)──→ ai ←── rag
```

`rag` imports `ai`’s guard chain and chat provider: enable `ai` first, and
remove `rag` before `ai`. `redis` is needed by nothing; `ai` can use its
shared limiter instead of the in-process one (one line in
`ai/rate-limit.ts`).

## Not here on purpose

- **Feature flags in the database.** A module is on when its route files
  exist; “is it on in production?” is answered by the repository.
- **Analytics or tracking.** OpenShipKit ships none (SPEC §3.9).
- **A job queue.** An AI request here is a bounded HTTP call with a
  deadline. Durable background work (retries, a dead-letter path, an
  operator view) is a different shape; add it as its own module when
  something needs it.
- **Auth and billing.** They are part of the core, not modules: Better Auth
  (`src/adapters/auth`) and optional Polar (`src/adapters/billing`). `ai`
  gates on billing through `hasPlan()`.
