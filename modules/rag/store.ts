//
// The RAG store's contract, its memory implementation, and the rank fusion
// both adapters share.
//
//   memory     this file — the reference implementation; DATA_PROVIDER=memory and unit tests.
//   postgres   ./store-postgres.ts — pgvector + Postgres full-text (./migration.sql).
//
// tests/modules/rag.test.ts runs one suite on both (Postgres when the PGlite
// pgvector extension is installed).
//
// The contract:
//  - Every read and delete takes the owner's userId and filters INSIDE the
//    query. Nobody can read, find or delete another person's document, and a
//    search never ranks the whole table and discards other people's rows
//    afterwards (that returns fewer than asked, sometimes none — and is one
//    forgotten filter away from quoting another tenant's text into a prompt).
//  - Ids are UUIDs; a malformed id is "not found" (null / false), never a throw.
//  - insertDocument stores the document and all its chunks, or nothing.
//  - search is HYBRID: a vector ranking (meaning) and a full-text ranking
//    (exact tokens: error codes, SKUs, names, versions — what people paste
//    into a search box), each `candidates` deep, fused by Reciprocal Rank
//    Fusion. Results are best first, at most `limit`.
//  - deleting a document deletes its chunks.
//
// Pure: no server-only, no I/O — safe to import in tests.
//

export interface RagDocument {
  id: string;
  userId: string;
  title: string;
  source: string | null;
  /** The embedding model its chunks were embedded with. */
  model: string;
  chunks: number;
  createdAt: string;
}

export interface RagDocumentInput {
  id: string;
  userId: string;
  title: string;
  source: string | null;
  model: string;
}

export interface RagChunkInput {
  content: string;
  embedding: number[];
}

export interface RetrievedChunk {
  documentId: string;
  title: string;
  /** 0-based position of the chunk in its document. */
  ordinal: number;
  content: string;
  /** RRF score: higher is better; only the order means anything. */
  score: number;
}

export interface RagSearch {
  embedding: number[];
  /** The raw query, for the full-text half. */
  text: string;
  /** How deep each ranking goes before fusion. */
  candidates: number;
  limit: number;
}

export interface RagStore {
  readonly id: "memory" | "postgres";
  /** Is the schema there? (Postgres: false when the migration was skipped for want of pgvector.) */
  ready(): Promise<boolean>;
  insertDocument(doc: RagDocumentInput, chunks: RagChunkInput[]): Promise<RagDocument>;
  listDocuments(userId: string, limit: number): Promise<RagDocument[]>;
  getDocument(userId: string, id: string): Promise<RagDocument | null>;
  deleteDocument(userId: string, id: string): Promise<boolean>;
  search(userId: string, query: RagSearch): Promise<RetrievedChunk[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

/** The conventional RRF constant: damps the head of each ranking so neither dominates. */
export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion: score(id) = Σ 1 / (k + rank) over the rankings it
 * appears in (rank from 1). Uses ORDER only — cosine distance and ts_rank have
 * no common scale, and weighting them means inventing numbers that drift as
 * the corpus grows. An id in both rankings beats one in either alone: it is
 * on topic AND has the words. Ties keep the first ranking's order.
 */
export function fuseRankings(rankings: readonly (readonly string[])[], k = RRF_K): { id: string; score: number }[] {
  const scores = new Map<string, { score: number; first: number }>();
  let seen = 0;
  for (const ranking of rankings) {
    ranking.forEach((id, i) => {
      const entry = scores.get(id) ?? { score: 0, first: seen++ };
      entry.score += 1 / (k + i + 1);
      scores.set(id, entry);
    });
  }
  return [...scores.entries()].sort((a, b) => b[1].score - a[1].score || a[1].first - b[1].first).map(([id, e]) => ({ id, score: e.score }));
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Lower-cased word tokens: the memory store's stand-in for to_tsvector('simple', …). */
export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu) ?? [];
}

interface MemoryChunk {
  id: string;
  documentId: string;
  userId: string;
  ordinal: number;
  content: string;
  embedding: number[];
  tokens: string[];
}

export function createMemoryRagStore(): RagStore {
  const documents = new Map<string, Omit<RagDocument, "chunks">>();
  const chunks: MemoryChunk[] = [];
  let next = 0;
  const count = (documentId: string) => chunks.filter((c) => c.documentId === documentId).length;
  const view = (d: Omit<RagDocument, "chunks">): RagDocument => ({ ...d, chunks: count(d.id) });

  return {
    id: "memory",
    async ready() {
      return true;
    },
    async insertDocument(doc, input) {
      if (!isUuid(doc.id) || documents.has(doc.id)) throw new Error(`Bad or duplicate document id ${doc.id}`);
      const stored = { ...doc, createdAt: new Date().toISOString() };
      documents.set(doc.id, stored);
      input.forEach((c, ordinal) =>
        chunks.push({ id: String(next++), documentId: doc.id, userId: doc.userId, ordinal, content: c.content, embedding: [...c.embedding], tokens: tokens(c.content) }),
      );
      return view(stored);
    },
    async listDocuments(userId, limit) {
      return [...documents.values()]
        .filter((d) => d.userId === userId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map(view);
    },
    async getDocument(userId, id) {
      const d = documents.get(id);
      return d && d.userId === userId ? view(d) : null;
    },
    async deleteDocument(userId, id) {
      const d = documents.get(id);
      if (!d || d.userId !== userId) return false;
      documents.delete(id);
      for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].documentId === id) chunks.splice(i, 1);
      return true;
    },
    async search(userId, query) {
      const mine = chunks.filter((c) => c.userId === userId);
      const byVector = mine
        .map((c) => ({ c, s: cosineSimilarity(query.embedding, c.embedding) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, query.candidates)
        .map((x) => x.c.id);
      // Like plainto_tsquery: every query word must appear; ranked by how often they do.
      const words = [...new Set(tokens(query.text))];
      const byText = words.length
        ? mine
            .map((c) => ({ c, hits: words.every((w) => c.tokens.includes(w)) ? words.reduce((n, w) => n + c.tokens.filter((t) => t === w).length, 0) : 0 }))
            .filter((x) => x.hits > 0)
            .sort((a, b) => b.hits - a.hits)
            .slice(0, query.candidates)
            .map((x) => x.c.id)
        : [];
      const byId = new Map(mine.map((c) => [c.id, c]));
      return fuseRankings([byVector, byText])
        .slice(0, query.limit)
        .map(({ id, score }) => {
          const c = byId.get(id)!;
          return { documentId: c.documentId, title: documents.get(c.documentId)?.title ?? "", ordinal: c.ordinal, content: c.content, score };
        });
    },
  };
}
