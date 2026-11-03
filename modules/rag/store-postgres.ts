import "server-only";

//
// The RAG store on Postgres + pgvector: the tables from ./migration.sql,
// through the app's shared Drizzle client. This module's adapter — the one
// file in modules/rag that talks to the database.
//
// Raw SQL through Drizzle's `sql` tag: the tables aren't in schema.ts, so
// drizzle-kit never generates a migration that drops them.
//
// Search runs in one transaction that first sets, for that transaction only:
//   hnsw.ef_search       = the candidate pool × 2. An HNSW scan returns at most
//                          ef_search rows (pgvector's default is 40, under the
//                          default pool of 50), so without this the vector half
//                          is quietly capped.
//   hnsw.iterative_scan  = relaxed_order (pgvector 0.8+). The owner filter is
//                          applied to what the index returns; on a shared table a
//                          person whose chunks aren't among the global nearest
//                          got NOTHING from the vector half — retrieval silently
//                          fell back to full-text, after paying for the embedding.
//                          Iterative scans keep going until the filter is
//                          satisfied. Skipped on an older pgvector that lacks it.
// Relaxed order can return the index's rows slightly out of order, so the
// vector candidates are materialised and ranked by their exact distance.
//

import { sql, type SQL } from "drizzle-orm";
import { getDrizzle, type Db } from "@/adapters/data/postgres/db";
import { toVectorLiteral } from "./embeddings";
import { isUuid, RRF_K, type RagDocument, type RagStore, type RetrievedChunk } from "./store";

/** RRF's k as SQL text (a constant, not a parameter: its type then needs no inference). */
const K = sql.raw(String(RRF_K));

/** MUST match the to_tsvector('english', …) in ./migration.sql. */
export const TEXT_SEARCH_CONFIG = "english";

type DocumentRow = {
  id: string;
  user_id: string;
  title: string;
  source: string | null;
  model: string;
  created_at: Date | string;
  chunks: number | string;
};

function toDocument(row: DocumentRow): RagDocument {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    source: row.source,
    model: row.model,
    chunks: Number(row.chunks),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const DOCUMENT_COLUMNS = sql`d.id, d.user_id, d.title, d.source, d.model, d.created_at,
  (select count(*)::int from rag_chunks c where c.document_id = d.id) as chunks`;

/** `db` for tests (an in-memory PGlite with pgvector); the app's shared client otherwise. */
export function createPostgresRagStore(opts: { db?: Db } = {}): RagStore {
  const db = (): Db => opts.db ?? getDrizzle();

  async function one(where: SQL): Promise<RagDocument | null> {
    const result = await db().execute<DocumentRow>(sql`select ${DOCUMENT_COLUMNS} from rag_documents d where ${where} limit 1`);
    return result.rows[0] ? toDocument(result.rows[0]) : null;
  }

  return {
    id: "postgres",

    async ready() {
      const result = await db().execute<{ ok: boolean }>(sql`select to_regclass('public.rag_chunks') is not null as ok`);
      return Boolean(result.rows[0]?.ok);
    },

    async insertDocument(doc, chunks) {
      await db().transaction(async (tx) => {
        await tx.execute(sql`
          insert into rag_documents (id, user_id, title, source, model)
          values (${doc.id}, ${doc.userId}, ${doc.title}, ${doc.source}, ${doc.model})`);
        if (chunks.length > 0) {
          // One round trip for every chunk (at most RAG_MAX_CHUNKS_PER_DOCUMENT × 4 parameters).
          const rows = chunks.map(
            (c, ordinal) => sql`(${doc.id}, ${doc.userId}, ${ordinal}, ${c.content}, ${toVectorLiteral(c.embedding)}::vector)`,
          );
          await tx.execute(sql`insert into rag_chunks (document_id, user_id, ordinal, content, embedding) values ${sql.join(rows, sql`, `)}`);
        }
      });
      const stored = await one(sql`d.id = ${doc.id}`);
      if (!stored) throw new Error(`rag document ${doc.id} vanished after insert`);
      return stored;
    },

    async listDocuments(userId, limit) {
      if (!isUuid(userId)) return [];
      const result = await db().execute<DocumentRow>(sql`
        select ${DOCUMENT_COLUMNS} from rag_documents d
        where d.user_id = ${userId}
        order by d.created_at desc, d.id desc
        limit ${limit}`);
      return result.rows.map(toDocument);
    },

    async getDocument(userId, id) {
      if (!isUuid(userId) || !isUuid(id)) return null;
      return one(sql`d.id = ${id} and d.user_id = ${userId}`);
    },

    async deleteDocument(userId, id) {
      if (!isUuid(userId) || !isUuid(id)) return false;
      // Ownership is part of the DELETE: no window between a check and the write.
      const result = await db().execute<{ id: string }>(sql`delete from rag_documents where id = ${id} and user_id = ${userId} returning id`);
      return result.rows.length > 0;
    },

    async search(userId, query) {
      if (!isUuid(userId)) return [];
      const vector = toVectorLiteral(query.embedding);
      const efSearch = String(Math.min(1000, Math.max(40, query.candidates * 2)));
      return db().transaction(async (tx) => {
        // The '[0]'::vector is folded at plan time, which loads pgvector so
        // current_setting() can tell whether this version has iterative scans.
        await tx.execute(sql`
          select set_config('hnsw.ef_search', ${efSearch}, true),
                 case when current_setting('hnsw.iterative_scan', true) is not null
                      then set_config('hnsw.iterative_scan', 'relaxed_order', true) end
          from (select '[0]'::vector) as load_pgvector`);
        const result = await tx.execute<{ document_id: string; title: string; ordinal: number; content: string; score: number | string }>(sql`
          with vec_raw as materialized (
            select id, embedding <=> ${vector}::vector as distance
            from rag_chunks
            where user_id = ${userId}
            order by embedding <=> ${vector}::vector
            limit ${query.candidates}
          ),
          vec as (
            select id, row_number() over (order by distance, id) as rank from vec_raw
          ),
          fts as (
            select c.id, row_number() over (order by ts_rank_cd(c.tsv, q) desc, c.id) as rank
            from rag_chunks c, plainto_tsquery(${TEXT_SEARCH_CONFIG}::regconfig, ${query.text}) q
            where c.user_id = ${userId} and c.tsv @@ q
            order by ts_rank_cd(c.tsv, q) desc, c.id
            limit ${query.candidates}
          ),
          -- Drive from the candidate ids (a few dozen primary-key lookups), not from
          -- rag_chunks: two LEFT JOINs filtered by "found in either" read every chunk
          -- the person owns on every search.
          candidates as (select id from vec union select id from fts)
          select c.document_id, d.title, c.ordinal, c.content,
                 (coalesce(1.0 / (${K} + vec.rank), 0) + coalesce(1.0 / (${K} + fts.rank), 0))::float8 as score
          from candidates k
          join rag_chunks c on c.id = k.id
          join rag_documents d on d.id = c.document_id
          left join vec on vec.id = c.id
          left join fts on fts.id = c.id
          where c.user_id = ${userId}
          order by score desc, vec.rank asc nulls last, fts.rank asc nulls last
          limit ${query.limit}`);
        return result.rows.map(
          (r): RetrievedChunk => ({ documentId: r.document_id, title: r.title, ordinal: Number(r.ordinal), content: r.content, score: Number(r.score) }),
        );
      });
    },
  };
}
