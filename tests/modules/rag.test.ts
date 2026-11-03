//
// modules/rag — chunking, rank fusion, the SQL/constant couplings, the
// embeddings client, the store contract (memory always; Postgres on PGlite
// when its pgvector extension is installed), the migration's no-pgvector
// guard, the service (audit, ownership, quota) and the routes.
//
// The Postgres half needs `@electric-sql/pglite-pgvector` (an enable step in
// modules/rag/README.md, not a dependency of the template). Without it that
// suite is skipped and says so. PGLITE_PGVECTOR_MODULE can point at a copy
// installed elsewhere.
//

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, type Extension } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, User } from "@/core/types";
import { createPostgresStore } from "@/adapters/data/postgres";
import { drizzleOverPglite } from "@/adapters/data/postgres/db";
import { migrateEmbedded } from "@/adapters/data/postgres/embedded";
import { UpstreamError } from "../../modules/shared/api";
import { chunkText } from "../../modules/rag/chunk";
import { RAG_VECTOR_WIDTH, ragConfig } from "../../modules/rag/config";
import { embed } from "../../modules/rag/embeddings";
import { createMemoryRagStore, fuseRankings, type RagStore } from "../../modules/rag/store";
import { createPostgresRagStore, TEXT_SEARCH_CONFIG } from "../../modules/rag/store-postgres";
import { addDocument, askDocuments, ASK_SYSTEM_PROMPT, deleteDocument, listDocuments, searchDocuments } from "../../modules/rag/service";
import { GET as listRoute, POST as addRoute } from "../../modules/rag/routes/documents";
import { DELETE as deleteRoute } from "../../modules/rag/routes/document";
import { POST as searchRoute } from "../../modules/rag/routes/search";
import { POST as askRoute } from "../../modules/rag/routes/ask";
import { applyModuleSql, fakeEmbedding, getRequest, jsonRequest, user } from "./helpers";

const state = vi.hoisted(() => ({
  user: null as User | null,
  audit: [] as { actor: Actor; action: string; entityId: string | null; before: unknown; after: unknown }[],
}));
vi.mock("@/server/session", () => ({
  getCurrentUser: async () => state.user,
  actorFor: (u: User) => ({ type: "user", id: u.id, label: u.email }),
}));
vi.mock("@/server/services/billing", () => ({ hasPlan: async () => false }));
vi.mock("@/server/services/audit", () => ({
  recordAudit: async (actor: Actor, action: string, _entity: string, entityId: string | null, before: unknown, after: unknown) => {
    state.audit.push({ actor, action, entityId, before, after });
  },
}));

const g = globalThis as unknown as { __openshipkitAiUsage?: unknown; __openshipkitAiConcurrency?: unknown; __openshipkitRagStore?: unknown; __openshipkitAiSweep?: ReturnType<typeof setInterval> };
const W = RAG_VECTOR_WIDTH;

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[] = [];

/** Embeddings from fakeEmbedding(); chat answers `answer` (or fails with `chatStatus`). */
function stubProviders(opts: { answer?: string; chatStatus?: number; shuffle?: boolean } = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url: String(url), body, headers: init.headers as Record<string, string> });
      if (String(url).endsWith("/embeddings")) {
        const data = (body.input as string[]).map((text, index) => ({ index, embedding: fakeEmbedding(text, W) }));
        return Response.json({ data: opts.shuffle ? [...data].reverse() : data });
      }
      if (opts.chatStatus) return new Response("nope", { status: opts.chatStatus });
      return Response.json({ choices: [{ message: { content: opts.answer ?? "It says so [1]." } }] });
    }),
  );
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("DATA_PROVIDER", "memory");
  g.__openshipkitAiUsage = undefined;
  g.__openshipkitAiConcurrency = undefined;
  g.__openshipkitRagStore = undefined;
  state.user = null;
  state.audit = [];
});

afterAll(() => {
  if (g.__openshipkitAiSweep) clearInterval(g.__openshipkitAiSweep);
  g.__openshipkitAiSweep = undefined;
});

// ---------------------------------------------------------------- pure parts

describe("rag chunking", () => {
  it("keeps short text whole and empty text out", () => {
    expect(chunkText("  One short note.  ", 200, 20)).toEqual(["One short note."]);
    expect(chunkText(" \n\n ", 200, 20)).toEqual([]);
  });

  it("stays within the size, overlaps, and drops nothing", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} talks about topic${i}. It has a second sentence here. And a third one too.`);
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text, 200, 40);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    for (let i = 0; i < 12; i++) expect(chunks.some((c) => c.includes(`topic${i}.`))).toBe(true);
    // Overlap: some chunk starts with text that ended the previous one.
    expect(chunks.slice(1).some((c, i) => chunks[i].endsWith(c.split("\n\n")[0]))).toBe(true);
  });

  it("hard-cuts a run of text with no sentence breaks instead of dropping it", () => {
    const blob = "x".repeat(950);
    const chunks = chunkText(`Intro.\n\n${blob}`, 200, 0);
    expect(chunks.join("").replace(/\s/g, "").length).toBe("Intro.".length + 950);
  });
});

describe("rag rank fusion", () => {
  it("ranks an id found by both rankings above ids found by one", () => {
    const fused = fuseRankings([
      ["a", "b", "c"],
      ["c", "d"],
    ]);
    expect(fused[0].id).toBe("c");
    expect(fused.map((f) => f.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("rag schema couplings", () => {
  const migration = readFileSync(fileURLToPath(new URL("../../modules/rag/migration.sql", import.meta.url)), "utf8");
  it("vector width in the SQL matches RAG_VECTOR_WIDTH", () => {
    // Every vector(N) in the file (the column, and the header comment that names it).
    expect([...new Set([...migration.matchAll(/vector\((\d+)\)/g)].map((m) => Number(m[1])))]).toEqual([RAG_VECTOR_WIDTH]);
  });
  it("text search config in the SQL matches the query's", () => {
    expect(migration).toContain(`to_tsvector('${TEXT_SEARCH_CONFIG}', content)`);
  });
});

// ---------------------------------------------------------------- config + embeddings

describe("rag config and embeddings", () => {
  it("is off until configured, and refuses a width the column can't hold", () => {
    expect(ragConfig().enabled).toBe(false);
    vi.stubEnv("EMBEDDING_API_KEY", "sk-test");
    expect(ragConfig()).toMatchObject({ enabled: true, embeddingModel: "text-embedding-3-small", sendDimensions: true });
    vi.stubEnv("EMBEDDING_DIMENSIONS", "768");
    expect(() => ragConfig()).toThrow(/vector\(1536\)/);
  });

  it("needs a model for a self-hosted endpoint and doesn't send dimensions to it", () => {
    vi.stubEnv("EMBEDDING_BASE_URL", "http://ollama:11434/v1");
    expect(() => ragConfig()).toThrow(/EMBEDDING_MODEL/);
    vi.stubEnv("EMBEDDING_MODEL", "some-embedder");
    expect(ragConfig()).toMatchObject({ enabled: true, embeddingApiKey: null, sendDimensions: false });
  });

  it("puts out-of-order answers back in order by index", async () => {
    vi.stubEnv("EMBEDDING_API_KEY", "sk-test");
    stubProviders({ shuffle: true });
    const [a, b] = await embed(ragConfig(), ["alpha", "beta"]);
    expect(a).toEqual(fakeEmbedding("alpha", W));
    expect(b).toEqual(fakeEmbedding("beta", W));
    expect(calls[0].body).toMatchObject({ model: "text-embedding-3-small", input: ["alpha", "beta"], dimensions: W });
    expect(calls[0].headers.authorization).toBe("Bearer sk-test");
  });

  it("rejects vectors of the wrong width without leaking the detail", async () => {
    vi.stubEnv("EMBEDDING_API_KEY", "sk-test");
    vi.stubGlobal("fetch", async () => Response.json({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    const error = await embed(ragConfig(), ["alpha"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).not.toMatch(/RAG_VECTOR_WIDTH|README/);
  });
});

// ---------------------------------------------------------------- the store contract

const doc = (userId: string, title: string) => ({ id: crypto.randomUUID(), userId, title, source: null, model: "test-embedder" });
const chunk = (content: string) => ({ content, embedding: fakeEmbedding(content, W) });

function describeRagContract(name: string, setup: () => Promise<{ store: RagStore; users: [string, string] }>) {
  describe(`rag store: ${name}`, () => {
    let store: RagStore;
    let a: string;
    let b: string;
    beforeEach(async () => {
      const made = await setup();
      store = made.store;
      [a, b] = made.users;
    });

    it("is ready", async () => {
      expect(await store.ready()).toBe(true);
    });

    it("stores a document with its chunks and lists only the owner's, newest first", async () => {
      const first = await store.insertDocument(doc(a, "First"), [chunk("one"), chunk("two")]);
      await new Promise((r) => setTimeout(r, 5));
      const second = await store.insertDocument(doc(a, "Second"), [chunk("three")]);
      await store.insertDocument(doc(b, "Not yours"), [chunk("four")]);
      expect(first).toMatchObject({ title: "First", chunks: 2, userId: a, model: "test-embedder" });
      expect(Date.parse(first.createdAt)).not.toBeNaN();
      const listed = await store.listDocuments(a, 10);
      expect(listed.map((d) => d.id)).toEqual([second.id, first.id]);
      expect(await store.listDocuments(a, 1)).toHaveLength(1);
    });

    it("never hands one person another's document", async () => {
      const theirs = await store.insertDocument(doc(b, "Private"), [chunk("the launch code is 4471")]);
      expect(await store.getDocument(a, theirs.id)).toBeNull();
      expect(await store.deleteDocument(a, theirs.id)).toBe(false);
      expect(await store.getDocument(b, theirs.id)).not.toBeNull();
      expect(await store.search(a, { embedding: fakeEmbedding("launch code", W), text: "launch code", candidates: 10, limit: 5 })).toEqual([]);
    });

    it("treats a malformed id as not found", async () => {
      expect(await store.getDocument(a, "not-a-uuid")).toBeNull();
      expect(await store.deleteDocument(a, "not-a-uuid")).toBe(false);
    });

    it("deletes a document with its chunks", async () => {
      const d = await store.insertDocument(doc(a, "Gone soon"), [chunk("ephemeral words")]);
      expect(await store.deleteDocument(a, d.id)).toBe(true);
      expect(await store.getDocument(a, d.id)).toBeNull();
      expect(await store.search(a, { embedding: fakeEmbedding("ephemeral words", W), text: "ephemeral", candidates: 10, limit: 5 })).toEqual([]);
    });

    it("finds by meaning and by exact token, best first, within the limit", async () => {
      await store.insertDocument(doc(a, "Errors"), [
        chunk("Error E1234 means the disk is full; free some space and retry."),
        chunk("Our office plants need watering every Tuesday."),
        chunk("Billing questions go to the finance team."),
      ]);
      const exact = await store.search(a, { embedding: fakeEmbedding("what is E1234", W), text: "E1234", candidates: 10, limit: 2 });
      expect(exact.length).toBeLessThanOrEqual(2);
      expect(exact[0]).toMatchObject({ title: "Errors", ordinal: 0 });
      expect(exact[0].content).toContain("E1234");
      expect(exact[0].score).toBeGreaterThan(0);
      const meaning = await store.search(a, { embedding: fakeEmbedding("plants watering", W), text: "zzzz-nothing-matches", candidates: 10, limit: 3 });
      expect(meaning[0].content).toContain("plants");
    });
  });
}

describeRagContract("memory", async () => ({ store: createMemoryRagStore(), users: [crypto.randomUUID(), crypto.randomUUID()] }));

/** PGlite's pgvector extension, when installed (an enable step, not a template dependency). */
async function loadPgvector(): Promise<Extension | null> {
  const specifier = process.env.PGLITE_PGVECTOR_MODULE ?? "@electric-sql/pglite-pgvector";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as { vector?: Extension };
    return mod.vector ?? null;
  } catch {
    return null;
  }
}

async function makeUsers(db: ReturnType<typeof drizzleOverPglite>): Promise<[string, string]> {
  const users = createPostgresStore({ db }).users;
  const make = async () =>
    (
      await users.upsertFromIdentity(
        { provider: "better-auth", providerUserId: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, name: null, image: null, emailVerified: true },
        { makeAdmin: false },
      )
    ).id;
  return [await make(), await make()];
}

const vectorExtension = await loadPgvector();

describe.skipIf(!vectorExtension)("rag store: postgres (PGlite + pgvector)", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzleOverPglite>;
  beforeAll(async () => {
    client = new PGlite({ extensions: { vector: vectorExtension! } });
    await migrateEmbedded(client);
    await applyModuleSql(client, "rag");
    await applyModuleSql(client, "rag"); // idempotent
    db = drizzleOverPglite(client);
  }, 60_000);
  afterAll(async () => {
    await client?.close();
  });

  describeRagContract("postgres", async () => ({ store: createPostgresRagStore({ db }), users: await makeUsers(db) }));

  it("deletes a person's documents and chunks with the person", async () => {
    const store = createPostgresRagStore({ db });
    const [a] = await makeUsers(db);
    const d = await store.insertDocument(doc(a, "Mine"), [chunk("some words")]);
    await createPostgresStore({ db }).users.delete(a);
    expect(await store.getDocument(a, d.id)).toBeNull();
    const left = await db.execute<{ n: number }>(sql`select count(*)::int as n from rag_chunks where document_id = ${d.id}`);
    expect(Number(left.rows[0].n)).toBe(0);
  }, 30_000);
});

if (!vectorExtension) {
  describe("rag store: postgres (PGlite + pgvector)", () => {
    it.skip("skipped: install @electric-sql/pglite-pgvector (modules/rag/README.md) to run the Postgres store suite", () => {});
  });
}

describe("rag migration without pgvector", () => {
  it("applies cleanly, creates nothing, and the store reports not ready", async () => {
    const client = new PGlite();
    try {
      await migrateEmbedded(client);
      await applyModuleSql(client, "rag");
      const store = createPostgresRagStore({ db: drizzleOverPglite(client) });
      expect(await store.ready()).toBe(false);
    } finally {
      await client.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------- the service

describe("rag service", () => {
  beforeEach(() => {
    vi.stubEnv("EMBEDDING_API_KEY", "sk-embed");
    vi.stubEnv("AI_API_KEY", "sk-chat");
    vi.stubEnv("RAG_CHUNK_SIZE", "200");
    vi.stubEnv("RAG_CHUNK_OVERLAP", "20");
    stubProviders();
  });

  it("adds a document, audited, and lists it for its owner only", async () => {
    const owner = user();
    const doc1 = await addDocument(owner, { title: "  Handbook ", content: "Holidays are booked through the portal. ".repeat(12), source: "https://example.com/handbook" });
    expect(doc1).toMatchObject({ title: "Handbook", source: "https://example.com/handbook", userId: owner.id });
    expect(doc1.chunks).toBeGreaterThan(1);
    expect(state.audit).toEqual([
      expect.objectContaining({ action: "rag_document.create", entityId: doc1.id, before: null, after: expect.objectContaining({ title: "Handbook", chunks: doc1.chunks }) }),
    ]);
    expect((await listDocuments(owner)).map((d) => d.id)).toEqual([doc1.id]);
    expect(await listDocuments(user())).toEqual([]);
    // One batched embeddings call for the whole document.
    expect(calls.filter((c) => c.url.endsWith("/embeddings"))).toHaveLength(1);
  });

  it("refuses an empty document, a document over the chunk limit, and missing setup", async () => {
    const owner = user();
    await expect(addDocument(owner, { title: "Empty", content: "   " })).rejects.toMatchObject({ code: "invalid" });
    vi.stubEnv("RAG_MAX_CHUNKS_PER_DOCUMENT", "1");
    await expect(addDocument(owner, { title: "Long", content: "A sentence that goes on. ".repeat(40) })).rejects.toMatchObject({ code: "invalid" });
    expect(calls).toHaveLength(0);
    vi.unstubAllEnvs();
    vi.stubEnv("DATA_PROVIDER", "memory");
    await expect(addDocument(owner, { title: "x", content: "y" })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("deletes only your own document (someone else's is not found), audited", async () => {
    const owner = user();
    const d = await addDocument(owner, { title: "Mine", content: "Private notes." });
    await expect(deleteDocument(user(), d.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteDocument(owner, "not-a-uuid")).rejects.toMatchObject({ code: "not_found" });
    await deleteDocument(owner, d.id);
    expect(state.audit.at(-1)).toMatchObject({ action: "rag_document.delete", entityId: d.id, before: { title: "Mine" }, after: null });
  });

  it("searches without spending the daily quota", async () => {
    vi.stubEnv("AI_FREE_CALLS_PER_DAY", "1");
    const owner = user();
    await addDocument(owner, { title: "Codes", content: "Error E1234 means the disk is full." });
    for (let i = 0; i < 3; i++) {
      const results = await searchDocuments(owner, { query: "E1234" });
      expect(results[0].content).toContain("E1234");
    }
  });

  it("answers from retrieved excerpts, fenced as data, with sources", async () => {
    stubProviders({ answer: "The disk is full [1]." });
    const owner = user();
    await addDocument(owner, { title: "Codes", content: "Error E1234 means the disk is full." });
    const result = await askDocuments(owner, { question: "What does E1234 mean?" });
    expect(result.answer).toBe("The disk is full [1].");
    expect(result.sources[0]).toMatchObject({ n: 1, title: "Codes", ordinal: 0 });
    expect(result.remainingToday).toBe(4);
    const chat = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    const messages = chat.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: ASK_SYSTEM_PROMPT });
    expect(messages[1].content).toMatch(/^<context>\n\[1\] Codes \(part 1\)\nError E1234/);
  });

  it("says it found nothing instead of asking the model, and refunds a failed answer", async () => {
    const owner = user();
    const none = await askDocuments(owner, { question: "Anything?" });
    expect(none.sources).toEqual([]);
    expect(calls.some((c) => c.url.endsWith("/chat/completions"))).toBe(false);

    vi.stubEnv("AI_FREE_CALLS_PER_DAY", "2");
    stubProviders({ chatStatus: 500 });
    await addDocument(owner, { title: "Codes", content: "Error E1234 means the disk is full." });
    await expect(askDocuments(owner, { question: "What is E1234?" })).rejects.toBeInstanceOf(UpstreamError);
    // One call used by "Anything?", the failed one refunded: one left.
    stubProviders();
    await expect(askDocuments(owner, { question: "What is E1234?" })).resolves.toMatchObject({ remainingToday: 0 });
  });
});

// ---------------------------------------------------------------- routes

describe("rag routes", () => {
  beforeEach(() => {
    vi.stubEnv("EMBEDDING_API_KEY", "sk-embed");
    vi.stubEnv("AI_API_KEY", "sk-chat");
    stubProviders();
  });

  it("adds, lists, searches, asks and deletes over HTTP", async () => {
    state.user = user();
    const added = await addRoute(jsonRequest("/api/rag/documents", { title: "Codes", content: "Error E1234 means the disk is full." }));
    expect(added.status).toBe(201);
    const { document } = (await added.json()) as { document: { id: string } };

    const listed = (await (await listRoute(getRequest("/api/rag/documents"))).json()) as { documents: { id: string }[] };
    expect(listed.documents.map((d) => d.id)).toEqual([document.id]);

    const found = (await (await searchRoute(jsonRequest("/api/rag/search", { query: "E1234", limit: 1 }))).json()) as { results: unknown[] };
    expect(found.results).toHaveLength(1);

    const asked = await askRoute(jsonRequest("/api/rag/ask", { question: "What is E1234?" }));
    expect(asked.status).toBe(200);

    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    const del = await deleteRoute(jsonRequest(`/api/rag/documents/${document.id}`, "", { method: "DELETE" }), params(document.id));
    expect(del.status).toBe(204);
    const again = await deleteRoute(jsonRequest(`/api/rag/documents/${document.id}`, "", { method: "DELETE" }), params(document.id));
    expect(again.status).toBe(404);
  });

  it("refuses anonymous and cross-site callers", async () => {
    expect((await listRoute(getRequest("/api/rag/documents"))).status).toBe(401);
    state.user = user();
    const cross = await deleteRoute(jsonRequest("/api/rag/documents/x", "", { method: "DELETE", origin: "https://evil.example" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(cross.status).toBe(403);
  });

  it("answers 503 while document search isn't set up", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("DATA_PROVIDER", "memory");
    state.user = user();
    const res = await searchRoute(jsonRequest("/api/rag/search", { query: "hello" }));
    expect(res.status).toBe(503);
  });
});
