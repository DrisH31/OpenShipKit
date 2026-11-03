# modules/rag — answers from each person’s own documents

Add text, chunk it, embed it, and search it two ways at once — pgvector for
meaning, Postgres full text for exact tokens, fused by Reciprocal Rank
Fusion — then answer questions from **only** what was retrieved, with the
sources alongside.

**Requires [`modules/ai`](../ai/README.md)** (its guard chain and chat
provider; one set of spend controls, not two that drift), **pgvector** in
your Postgres, and an embeddings endpoint (OpenAI’s, or your own).

---

## What it does

| Route | Body | Answers |
|---|---|---|
| `POST /api/rag/documents` | `{ title, content, source? }` | `201 { document }` (audited) |
| `GET /api/rag/documents` | — | `{ documents }` — your own, newest first, at most 200 |
| `DELETE /api/rag/documents/[id]` | — | `204` (audited); someone else’s is `404` |
| `POST /api/rag/search` | `{ query, limit? }` | `{ results }` — retrieval only |
| `POST /api/rag/ask` | `{ question }` | `{ answer, sources, remainingToday }` |

Server code calls `modules/rag/service.ts` directly: `addDocument`,
`listDocuments`, `deleteDocument`, `searchDocuments`, `askDocuments`, each
taking the `User` from `requireUser()`.

**Keep `search` around.** It is the honest way to debug a wrong answer: look
at what was *retrieved* before blaming the model. Most “the AI made it up”
reports are a retrieval miss.

## What it costs

| | |
|---|---|
| **Packages** | none in production; `@electric-sql/pglite-pgvector` for the development database |
| **Database** | the `vector` extension; tables `rag_documents`, `rag_chunks` (the second is big by design) |
| **Per document** | one batched embeddings call, one transaction |
| **Per search** | one embeddings call, one query |
| **Per answer** | one embeddings call, one query, one chat call — and one of the person’s daily AI calls |
| **Storage** | a chunk is its text plus 1,536 floats (~6 KB): a 200,000-character document is a few hundred rows, a few MB |

Adding and searching use the AI module’s bulkhead and per-minute limit but
**not** the daily quota (charging five “AI calls” to upload a document would
be a strange product); `RAG_MAX_DOCUMENT_CHARS` and
`RAG_MAX_CHUNKS_PER_DOCUMENT` bound that spend. Asking generates, so it
spends a call — refunded if no answer is delivered.

## Decisions that carry the weight

**The owner filter is inside the query.** `user_id` is on every chunk so the
filter runs within the vector and full-text scans. Ranking the whole table
and dropping other people’s rows afterwards returns fewer results than asked
(sometimes none) — and is one forgotten filter away from quoting another
person’s document into a prompt.

**Hybrid, not vector alone.** Embeddings are good at “what is this about” and
bad at exact tokens — error codes, SKUs, names, version numbers — which is
what people paste into a search box. RRF fuses the two rankings by order only;
a chunk found by both outranks one found by either.

**The vector index is told to look far enough.** Each search sets, for its
own transaction, `hnsw.ef_search` to twice the candidate pool (pgvector’s
default of 40 would cap a pool of 50) and `hnsw.iterative_scan` (pgvector
0.8+), so filtering by owner on a shared table can’t starve one person of
vector results. Nothing to configure in the connection pool.

**Retrieved text is untrusted.** A document can say “ignore your
instructions”. The prompt fences the excerpts and tells the model they are
data; that lowers the risk and doesn’t remove it. Show `sources` next to
every answer, and don’t give the model tools that act on your behalf from
this endpoint.

## Enable

**1. Enable [`modules/ai`](../ai/README.md) first**, and set `AI_API_KEY` or
`AI_BASE_URL` (answers need a chat model).

**2. Give your Postgres pgvector.** In `docker-compose.yml`, change the
`postgres` service’s image (same Postgres 18; pinned, like the original):

```yaml
  postgres:
    image: pgvector/pgvector:0.8.7-pg18-trixie
```

Then `docker compose up -d` (Dokploy and Coolify read the same file: redeploy).

On a database **that already has data**, the stock image is Alpine (musl) and
this one is Debian (glibc); they sort text differently, so rebuild the text
indexes once after the switch, then record the new collation version:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "REINDEX DATABASE \"$POSTGRES_DB\";" -c "ALTER DATABASE \"$POSTGRES_DB\" REFRESH COLLATION VERSION;"'
```

Elsewhere: a Postgres you installed yourself needs its pgvector package
(`postgresql-18-pgvector` from the PostgreSQL apt repository); most managed
Postgres services list `vector` among their extensions. Backups made with
`pg_dump` keep working; restoring them needs pgvector on the target too.

**3. Give the development database pgvector.** Install PGlite’s extension
(the version must match `@electric-sql/pglite`, 0.5.8 today):

```bash
npm install @electric-sql/pglite-pgvector@0.0.9
```

and register it where the embedded database is opened,
`src/adapters/data/postgres/db.ts`, `connectEmbedded()` — both `new PGlite(…)`
calls:

```ts
import { vector } from "@electric-sql/pglite-pgvector";
// …
const client = new PGlite(dir, { extensions: { vector } });
```

Tests that build their own `new PGlite()` keep passing without it: the
migration skips itself where pgvector is missing (step 4).
`tests/modules/rag.test.ts` runs its Postgres suite once the package is
installed.

**4. Apply the migration.** Stop `npm run dev`, then:

```bash
npm run db:generate -- --custom --name rag
cp modules/rag/migration.sql drizzle/0006_rag.sql   # the file name it printed
```

Restart `npm run dev`; deploys apply it with `npm run db:migrate`.

Where pgvector is missing, this migration creates nothing, raises a warning,
and is still recorded as applied — so a database without pgvector (CI, a test,
a server you haven’t switched yet) migrates instead of failing. The app then
answers RAG requests with `503` and logs what’s missing. Once pgvector is
there, apply the file again (idempotent):

```bash
node --conditions=react-server --import tsx modules/rag/apply-migration.mts   # embedded or DATABASE_URL; stop npm run dev first
# or, on the compose database:
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < modules/rag/migration.sql
```

**5. Mount the routes** — four files:

```ts
// src/app/api/rag/documents/route.ts
export { GET, POST } from "../../../../../modules/rag/routes/documents";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

```ts
// src/app/api/rag/documents/[id]/route.ts
export { DELETE } from "../../../../../../modules/rag/routes/document";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

```ts
// src/app/api/rag/search/route.ts
export { POST } from "../../../../../modules/rag/routes/search";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

```ts
// src/app/api/rag/ask/route.ts
export { POST } from "../../../../../modules/rag/routes/ask";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

**6. Say so at boot (optional, recommended).** In `src/instrumentation.ts`,
inside the `NEXT_RUNTIME === "nodejs"` branch, before the production return:

```ts
const { assertRagReady } = await import("../modules/rag/service");
await assertRagReady().catch((error: unknown) => console.error(String(error)));
```

A database where step 4 skipped then says so in the first lines of the log,
not on the first request.

**7. Set the variables**, and add this block to `.env.example`:

```bash
# ---- Document search (modules/rag) — off until EMBEDDING_API_KEY or EMBEDDING_BASE_URL is set ----
# EMBEDDING_API_KEY=                # OpenAI by default; any OpenAI-compatible /embeddings endpoint
# EMBEDDING_BASE_URL=               # e.g. http://ollama:11434/v1 (default https://api.openai.com/v1)
# EMBEDDING_MODEL=                  # required with EMBEDDING_BASE_URL; default text-embedding-3-small
# EMBEDDING_DIMENSIONS=1536         # must equal the vector(…) column (modules/rag/config.ts)
# EMBEDDING_SEND_DIMENSIONS=        # send "dimensions" in requests; default true only for OpenAI's endpoint
# EMBEDDING_TIMEOUT_SECONDS=30
# RAG_CHUNK_SIZE=1200
# RAG_CHUNK_OVERLAP=150             # at most half the chunk size
# RAG_TOP_K=6                       # excerpts per answer
# RAG_CANDIDATE_POOL_SIZE=50        # depth of each ranking before fusion
# RAG_MAX_DOCUMENT_CHARS=200000
# RAG_MAX_CHUNKS_PER_DOCUMENT=400
```

**8. Check it:** `npm run check`; signed in, add a document, search for a word
in it, ask about it, delete it.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `EMBEDDING_API_KEY` | — | Turns RAG on (OpenAI unless `EMBEDDING_BASE_URL`) |
| `EMBEDDING_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible `/embeddings`; turns RAG on by itself |
| `EMBEDDING_MODEL` | `text-embedding-3-small` on OpenAI | Required with `EMBEDDING_BASE_URL` |
| `EMBEDDING_DIMENSIONS` | `1536` | Must equal the column width — checked |
| `EMBEDDING_SEND_DIMENSIONS` | `true` for OpenAI, else `false` | Some servers reject the field |
| `EMBEDDING_TIMEOUT_SECONDS` | `30` | |
| `RAG_CHUNK_SIZE` | `1200` | Characters |
| `RAG_CHUNK_OVERLAP` | `150` | The setting people delete — see `chunk.ts` |
| `RAG_TOP_K` | `6` | Excerpts fed to the model |
| `RAG_CANDIDATE_POOL_SIZE` | `50` | Each ranking’s depth before fusion |
| `RAG_MAX_DOCUMENT_CHARS` | `200000` | The add route’s body cap follows it |
| `RAG_MAX_CHUNKS_PER_DOCUMENT` | `400` | |

### Another embedding model (another width)

`rag_chunks.embedding` is `vector(1536)` — OpenAI’s `text-embedding-3-*`.
pgvector needs a fixed width to index, so a model of another width (Ollama’s
`nomic-embed-text` is 768) means, together:

1. `RAG_VECTOR_WIDTH` in `modules/rag/config.ts` and `vector(…)` in
   `modules/rag/migration.sql` (before you first apply it), or a new migration
   that changes the column (after);
2. re-embedding every chunk — vectors from two models aren’t comparable, and
   mixing them degrades every search without an error. `rag_documents.model`
   records which model each document used.

`tests/modules/rag.test.ts` fails if the constant and the SQL disagree, and the
app refuses an `EMBEDDING_DIMENSIONS` that doesn’t match.

### Another language

Full text uses Postgres’s `english` configuration (stemming, stop words). For
another language change `to_tsvector('english', …)` in the migration and
`TEXT_SEARCH_CONFIG` in `store-postgres.ts` together (`simple` works for any
language, without stemming); the test checks they agree.

## Removing it

1. Delete `src/app/api/rag/` and the `assertRagReady` lines in
   `src/instrumentation.ts`.
2. Drop the tables when you mean it, as a new migration:

   ```bash
   npm run db:generate -- --custom --name drop_rag
   printf 'DROP TABLE IF EXISTS rag_chunks, rag_documents;\n--> statement-breakpoint\nDROP EXTENSION IF EXISTS vector;\n' > drizzle/00NN_drop_rag.sql
   ```

3. Only after that, put the stock Postgres image back if you like (and
   `REINDEX` again, for the same glibc/musl reason), and remove
   `@electric-sql/pglite-pgvector` and its registration in `db.ts`.
4. Delete `modules/rag/` and `tests/modules/rag.test.ts`.
