import "server-only";

//
// The RAG module's settings, read lazily (see modules/shared/config.ts).
//
// Embeddings come from any OpenAI-compatible /embeddings endpoint, separate
// from the chat endpoint (OpenRouter, the AI module's default, serves chat;
// embeddings usually come from somewhere else):
//
//   OpenAI (default)     EMBEDDING_API_KEY=…                                EMBEDDING_BASE_URL unset
//   Self-hosted Ollama   EMBEDDING_BASE_URL=http://ollama:11434/v1          EMBEDDING_MODEL=nomic-embed-text  (768 wide — see below)
//   Any other            EMBEDDING_BASE_URL=…  EMBEDDING_MODEL=…  (EMBEDDING_API_KEY if it wants one)
//
// Off until EMBEDDING_API_KEY or EMBEDDING_BASE_URL is set.
//
// ─── The vector width is part of the schema ─────────────────────────────────
//
// rag_chunks.embedding is vector(RAG_VECTOR_WIDTH): pgvector needs a fixed
// dimension to index. EMBEDDING_DIMENSIONS must equal it, and ragConfig()
// throws when it doesn't — the mismatch otherwise boots fine and fails every
// ingest deep inside an INSERT. A model of another width (Ollama's
// nomic-embed-text is 768) means changing RAG_VECTOR_WIDTH and the vector(…)
// in ./migration.sql together, in a NEW migration, and re-embedding every
// chunk: vectors from two models aren't comparable, and mixing them degrades
// every search without an error. tests/modules/rag.test.ts checks the constant
// and the SQL agree.
//

import { optionalEnv } from "@/server/env";
import { boolEnv, intEnv, urlEnv } from "../shared/config";

/** MUST equal the vector(N) in ./migration.sql. */
export const RAG_VECTOR_WIDTH = 1536;

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";

export interface RagConfig {
  enabled: boolean;
  embeddingBaseUrl: string;
  embeddingApiKey: string | null;
  embeddingModel: string;
  embeddingDimensions: number;
  /** Send `dimensions` in the request (OpenAI's text-embedding-3-* accept it; others may reject it). */
  sendDimensions: boolean;
  embeddingTimeoutSeconds: number;
  chunkSize: number;
  /** Characters consecutive chunks share — the setting people delete, see ./chunk.ts. */
  chunkOverlap: number;
  /** Chunks fed to the model per answer. */
  topK: number;
  /** How deep EACH ranking (vector, full-text) goes before fusion. */
  candidatePoolSize: number;
  maxDocumentChars: number;
  maxChunksPerDocument: number;
}

export function ragConfig(): RagConfig {
  const customBase = urlEnv("EMBEDDING_BASE_URL");
  const embeddingApiKey = optionalEnv("EMBEDDING_API_KEY") ?? null;
  const enabled = Boolean(embeddingApiKey || customBase);
  const embeddingModel = optionalEnv("EMBEDDING_MODEL") ?? (customBase ? "" : OPENAI_DEFAULT_MODEL);
  if (enabled && !embeddingModel) {
    throw new Error("EMBEDDING_BASE_URL is set but EMBEDDING_MODEL isn't: name the embedding model your endpoint serves.");
  }

  const embeddingDimensions = intEnv("EMBEDDING_DIMENSIONS", RAG_VECTOR_WIDTH, { min: 2, max: 16_000 });
  if (embeddingDimensions !== RAG_VECTOR_WIDTH) {
    throw new Error(
      `EMBEDDING_DIMENSIONS is ${embeddingDimensions} but rag_chunks.embedding is vector(${RAG_VECTOR_WIDTH}). ` +
        "Use a model of that width, or change RAG_VECTOR_WIDTH and the column in a new migration and re-embed every chunk (modules/rag/README.md).",
    );
  }

  const chunkSize = intEnv("RAG_CHUNK_SIZE", 1_200, { min: 200, max: 8_000 });
  const chunkOverlap = intEnv("RAG_CHUNK_OVERLAP", 150, { min: 0, max: 2_000 });
  if (chunkOverlap * 2 > chunkSize) throw new Error("RAG_CHUNK_OVERLAP must be at most half of RAG_CHUNK_SIZE.");

  const topK = intEnv("RAG_TOP_K", 6, { max: 50 });
  const candidatePoolSize = intEnv("RAG_CANDIDATE_POOL_SIZE", 50, { min: 10, max: 1_000 });
  if (candidatePoolSize < topK) throw new Error("RAG_CANDIDATE_POOL_SIZE must be at least RAG_TOP_K.");

  return {
    enabled,
    embeddingBaseUrl: customBase ?? OPENAI_BASE_URL,
    embeddingApiKey,
    embeddingModel,
    embeddingDimensions,
    // On by default only for OpenAI's own endpoint; a self-hosted one may reject the field.
    sendDimensions: boolEnv("EMBEDDING_SEND_DIMENSIONS", !customBase),
    embeddingTimeoutSeconds: intEnv("EMBEDDING_TIMEOUT_SECONDS", 30, { max: 300 }),
    chunkSize,
    chunkOverlap,
    topK,
    candidatePoolSize,
    maxDocumentChars: intEnv("RAG_MAX_DOCUMENT_CHARS", 200_000, { min: 1_000, max: 5_000_000 }),
    maxChunksPerDocument: intEnv("RAG_MAX_CHUNKS_PER_DOCUMENT", 400, { min: 1, max: 5_000 }),
  };
}
