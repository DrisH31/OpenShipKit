import "server-only";

//
// Embeddings from any OpenAI-compatible POST {base}/embeddings — plain fetch,
// no SDK. Separate from modules/ai/providers.ts: a different endpoint (see
// ./config.ts), and a different shape — batched, no max_tokens, priced per
// token at a small fraction of a chat call.
//
// Failures are UpstreamError (modules/shared/api.ts): 504 when too slow, 502
// otherwise. Logs carry the status only — the provider can echo the document.
//

import { UpstreamError } from "../shared/api";
import type { RagConfig } from "./config";

/**
 * Embed a batch of texts; result[i] belongs to texts[i]. One request for the
 * whole batch: one per chunk turns a two-second ingest into forty.
 */
export async function embed(config: RagConfig, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (!config.enabled) throw new UpstreamError("Embeddings aren’t set up on this site yet.", 503);
  if (texts.length === 0) return [];

  const timeout = AbortSignal.timeout(config.embeddingTimeoutSeconds * 1000);
  let response: Response;
  try {
    response = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.embeddingApiKey ? { authorization: `Bearer ${config.embeddingApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: texts,
        ...(config.sendDimensions ? { dimensions: config.embeddingDimensions } : {}),
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw new UpstreamError("The request was cancelled.", 499);
    if (timeout.aborted) throw new UpstreamError("The embedding service took too long to respond.", 504);
    console.error("[rag] embeddings unreachable:", error instanceof Error ? error.message : error);
    throw new UpstreamError("The embedding service is unavailable right now.");
  }
  if (!response.ok) {
    console.error(`[rag] embeddings failed with ${response.status}`);
    throw new UpstreamError("The embedding service is unavailable right now.");
  }

  const data = (await response.json().catch(() => null)) as { data?: { embedding?: unknown; index?: unknown }[] } | null;
  const rows = data?.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new UpstreamError("The embedding service returned an unexpected answer.");
  }
  // Some providers answer OUT OF ORDER but always say `index`. Trusting array
  // order would attach embeddings to the wrong chunks: an index that is subtly,
  // permanently wrong, with nothing ever failing.
  const ordered = rows.map((row, i) => ({ row, at: typeof row.index === "number" ? row.index : i })).sort((a, b) => a.at - b.at);
  return ordered.map(({ row }) => {
    const v = row.embedding;
    if (!Array.isArray(v) || v.length !== config.embeddingDimensions || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      // The operator's problem, not the caller's: the detail goes to the log.
      console.error(
        `[rag] ${config.embeddingModel} returned a vector of width ${Array.isArray(v) ? v.length : "?"}, expected ${config.embeddingDimensions} (EMBEDDING_MODEL / RAG_VECTOR_WIDTH, modules/rag/README.md)`,
      );
      throw new UpstreamError("The embedding service returned an unexpected answer.");
    }
    return v as number[];
  });
}

/** pgvector's text form, "[0.1,0.2,…]", cast with ::vector in SQL. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
