# RAG (`modules/rag`)

Each signed-in person adds their own documents; the app chunks and embeds
them, searches them by meaning and by exact words at once, and answers
questions from only what it found, with the sources. **The enable steps,
variables and API are in [modules/rag/README.md](../../modules/rag/README.md).**
This page is about deciding and what changes.

## When you want it

When people need answers from **their own** text — notes, manuals, tickets —
rather than from a model’s general knowledge. It needs [AI](ai.md) for the
answers (and reuses its spend controls), pgvector in your Postgres, and an
embeddings endpoint.

Documents are private to the person who added them: every query filters by
owner inside the database, and someone else’s document is “not found”.
There is no shared, site-wide knowledge base; that is a different feature
(an admin-owned corpus) you could build on the same store.

## What enabling changes

| Where | Change |
|---|---|
| `docker-compose.yml` | the `postgres` image becomes `pgvector/pgvector:0.8.7-pg18-trixie` (Postgres 18 with pgvector; a one-time `REINDEX` on existing data, see the README) |
| `package.json` | `@electric-sql/pglite-pgvector`, for the embedded development database |
| `src/adapters/data/postgres/db.ts` | the embedded database registers the `vector` extension |
| `drizzle/` | one custom migration: `rag_documents`, `rag_chunks` and their indexes |
| `src/app/api/rag/**/route.ts` | four re-export files |
| `src/instrumentation.ts` | optional: a boot-time check that the tables exist |
| `.env.example` / your environment | the `EMBEDDING_*` and `RAG_*` block |

The migration is safe on a Postgres without pgvector: it creates nothing and
warns, so CI and tests keep migrating, and the app answers RAG requests with
`503` until pgvector is there and the SQL is applied again.

## Choosing an embeddings endpoint

| | Notes |
|---|---|
| **OpenAI** (default) | `text-embedding-3-small`, 1,536 wide — matches the column as shipped |
| **Your own Ollama** | e.g. `nomic-embed-text` (768 wide): change the column width before the first migration, see the README |
| **Any OpenAI-compatible `/embeddings`** | set `EMBEDDING_BASE_URL` and `EMBEDDING_MODEL` |

Embedding sends the document text to that endpoint. A self-hosted one keeps
it on your server; otherwise, say so in your privacy policy.

## Backups and restores

The tables are ordinary tables: `pg_dump` and the backup scripts in
`deploy/backups` keep working. A restore needs pgvector on the target
database, so restore onto the pgvector image.

## Checking it

1. `npm run check` (with the PGlite extension installed, the Postgres store
   suite in `tests/modules/rag.test.ts` runs too).
2. Signed in: add a document, search for an exact code or word in it, ask a
   question about it — the answer cites `[1]` and `sources` lists the document.
3. Sign in as someone else: their list is empty and searching finds nothing
   of yours.
4. Delete the document: `/admin/audit` shows the create and the delete.
