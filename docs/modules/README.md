# Modules

OpenShipKit keeps three optional features in [`modules/`](../../modules/README.md),
outside the app: complete, typechecked and tested, and off until you enable
one. A fresh clone builds, deploys and runs without any of them.

| Guide | Enable it when |
|---|---|
| [AI](ai.md) | Your product needs generation (chat, images) for signed-in people, with spend controls and an optional paywall |
| [RAG](rag.md) | People should search and ask questions about their own documents |
| [Redis](redis.md) | You run more than one replica of the app |

Each guide says when you want the module, what enabling it changes in the
app, and how to check it works. The step-by-step lives in each module’s own
README, next to its code.

## The shape of every module

- **Off by default.** No route, table or variable exists until you add them.
  Third parties (an AI provider, an embeddings API) are optional, and each can
  be swapped for one you host through an OpenAI-compatible base URL.
- **Built like the app** ([SPEC.md](../../SPEC.md)): a service is the only
  write path (zod → store → `recordAudit`); a store contract with a memory
  and a Postgres adapter and one test suite for both; plain SQL applied as a
  Drizzle custom migration; sessions from `@/server/session`; env read lazily.
- **Enabled by adding, disabled by deleting.** Route files under
  `src/app/api/` re-export the module’s handlers. Delete them and the module
  is inert; its tables stay until a migration of yours drops them.
- **Checked while unused.** `npm run check` typechecks, lints and tests
  `modules/` and `tests/modules/`; `npx tsc --noEmit -p tsconfig.modules.json`
  checks just the modules.

## Order

`rag` builds on `ai` (its spend controls and chat provider): enable `ai`
first, remove `rag` first. `redis` stands alone; `ai` can use its shared
limiter with a one-line change.
