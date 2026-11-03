-- modules/rag — documents, their chunks, and the indexes hybrid search needs.
--
-- Needs pgvector. On Postgres 18 in docker compose that means the
-- pgvector/pgvector image (modules/rag/README.md, "Enable"); in development
-- the embedded database needs PGlite's pgvector extension registered.
--
-- Apply it as a Drizzle custom migration:
--   npm run db:generate -- --custom --name rag
--   cp modules/rag/migration.sql drizzle/<the new file>.sql
--
-- Without pgvector this migration does NOTHING but raise a warning, and
-- Drizzle still records it as applied. That keeps `npm run db:migrate` (and
-- every test that builds a database from /drizzle) working on a Postgres
-- that has no pgvector, and the app refuses to serve RAG instead: the
-- service's readiness check says what is missing. Once pgvector is there,
-- apply this file again by hand — every statement is IF NOT EXISTS:
--   psql "$DATABASE_URL" -f modules/rag/migration.sql
--
-- Coupled numbers and names (tests/modules/rag.test.ts checks them):
--   vector(1536)  = RAG_VECTOR_WIDTH in modules/rag/config.ts
--   'english'     = TEXT_SEARCH_CONFIG in modules/rag/store-postgres.ts
-- Changing either is a NEW migration (and, for the width, re-embedding every chunk).
--
-- rag_chunks.user_id repeats rag_documents.user_id on purpose: the owner
-- filter runs INSIDE the vector and full-text scans instead of after them.
-- The HNSW index uses cosine ops to match the <=> operator in the query; an
-- index built for another distance is silently ignored (a sequential scan,
-- correct but slower every month). HNSW rather than IVFFlat: no training
-- pass, useful from the first row.

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
		RAISE WARNING 'modules/rag: pgvector is not available on this Postgres, so the RAG tables were NOT created. Install pgvector, then apply modules/rag/migration.sql again.';
		RETURN;
	END IF;

	CREATE EXTENSION IF NOT EXISTS vector;

	CREATE TABLE IF NOT EXISTS rag_documents (
		id uuid PRIMARY KEY,
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		title text NOT NULL,
		source text,
		model text NOT NULL,
		created_at timestamptz(3) NOT NULL DEFAULT now()
	);
	CREATE INDEX IF NOT EXISTS rag_documents_user_created_idx ON rag_documents (user_id, created_at DESC, id DESC);

	CREATE TABLE IF NOT EXISTS rag_chunks (
		id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		document_id uuid NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		ordinal integer NOT NULL,
		content text NOT NULL,
		embedding vector(1536) NOT NULL,
		tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
	);
	CREATE UNIQUE INDEX IF NOT EXISTS rag_chunks_document_ordinal_idx ON rag_chunks (document_id, ordinal);
	CREATE INDEX IF NOT EXISTS rag_chunks_user_idx ON rag_chunks (user_id);
	CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx ON rag_chunks USING hnsw (embedding vector_cosine_ops);
	CREATE INDEX IF NOT EXISTS rag_chunks_tsv_idx ON rag_chunks USING gin (tsv);
END
$$;
