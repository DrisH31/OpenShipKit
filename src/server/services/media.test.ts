//
// The media library end to end on a memory store and a throwaway uploads
// folder: uploads are sniffed, capped and refused with reasons; files land
// under yyyy/mm/<random>.<ext>; the list pages newest first; a delete is
// refused while a post uses the image; every write is audited; and the public
// /uploads route serves only our own paths, with immutable caching, an ETag
// and a 304.
//

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/core/data";
import { MAX_MEDIA_BYTES } from "@/core/media";
import { createMemoryStore } from "@/adapters/data/memory";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
let viewer: { id: string; email: string; role: "admin" | "user" } | null = null;
vi.mock("@/server/session", () => ({
  getCurrentUser: async () => viewer,
  actorFor: (u: { id: string; email: string }) => ({ type: "user", id: u.id, label: u.email }),
}));

// Inside the project's gitignored .data/, removed afterwards.
const ROOT = resolve(".data", `test-uploads-${randomUUID()}`);
vi.stubEnv("UPLOADS_DIR", ROOT);

const { deleteMedia, getMedia, listMedia, mediaRefusalOf, uploadMedia } = await import("./media");
const { resolveMediaFile, uploadsRoot } = await import("./media-storage");
const { createPost } = await import("./posts");
const { GET } = await import("@/app/uploads/[...path]/route");
const { POST } = await import("@/app/api/admin/media/route");

const ACTOR = { type: "user" as const, id: "u1", label: "admin@example.com" };
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return mediaRefusalOf(error);
  }
  throw new Error("expected a refusal");
}

function get(path: string, headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/uploads/${path}`, { headers }), { params: Promise.resolve({ path: path.split("/") }) });
}

beforeEach(() => {
  store = createMemoryStore({ fresh: true });
  viewer = { id: "u1", email: "admin@example.com", role: "admin" };
  rmSync(ROOT, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("uploadMedia", () => {
  it("stores a sniffed image under yyyy/mm/<random>.<ext> and audits it", async () => {
    expect(uploadsRoot()).toBe(ROOT);
    const item = await uploadMedia({ bytes: PNG, claimedType: "image/png" }, ACTOR);
    const now = new Date();
    const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(item.path).toMatch(new RegExp(`^${month}/[0-9a-f]{32}\\.png$`));
    expect(item).toMatchObject({ url: `/uploads/${item.path}`, contentType: "image/png", size: PNG.length });
    // No temporary file is left behind.
    expect(readdirSync(join(ROOT, month))).toEqual([item.path.split("/")[2]]);

    const audit = await store.audit.list({ entity: "media" });
    expect(audit.items[0]).toMatchObject({ action: "media.upload", entityId: item.path, before: null, after: item });

    // Two uploads of the same bytes are two files (names are random, never reused).
    const again = await uploadMedia({ bytes: PNG }, ACTOR);
    expect(again.path).not.toBe(item.path);
  });

  it("refuses with a reason: empty, too large, SVG, not an image, a lying type", async () => {
    expect(await refusal(uploadMedia({ bytes: new Uint8Array(0) }, ACTOR))).toBe("empty");
    expect(await refusal(uploadMedia({ bytes: new Uint8Array(MAX_MEDIA_BYTES + 1) }, ACTOR))).toBe("too_large");
    expect(await refusal(uploadMedia({ bytes: new TextEncoder().encode('<svg onload="alert(1)"/>'), claimedType: "image/svg+xml" }, ACTOR))).toBe("svg");
    expect(await refusal(uploadMedia({ bytes: new TextEncoder().encode("<html><body>hi</body></html>"), claimedType: "image/png" }, ACTOR))).toBe("not_image");
    expect(await refusal(uploadMedia({ bytes: JPEG, claimedType: "image/png" }, ACTOR))).toBe("mismatch");
    // No claim, the generic one, and the common misspelling are not disagreements.
    await uploadMedia({ bytes: JPEG, claimedType: "" }, ACTOR);
    await uploadMedia({ bytes: JPEG, claimedType: "application/octet-stream" }, ACTOR);
    await uploadMedia({ bytes: JPEG, claimedType: "image/jpg" }, ACTOR);
    expect((await store.audit.list({ entity: "media" })).items).toHaveLength(3);
  });
});

describe("listMedia", () => {
  it("lists newest first, pages without gaps, and ignores files that aren't ours", async () => {
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await uploadMedia({ bytes: PNG }, ACTOR));
    // A stray file and a half-written temp file are not part of the library.
    const dir = join(ROOT, made[0].path.split("/").slice(0, 2).join("/"));
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, ".tmp-abc"), "x");
    mkdirSync(join(ROOT, "misc"), { recursive: true });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listMedia({ limit: 2, cursor });
      seen.push(...page.items.map((i) => i.path));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen)).toEqual(new Set(made.map((m) => m.path)));
    expect(seen).toHaveLength(5);
    await expect(listMedia({ cursor: "../../etc" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("an empty or missing folder is an empty library", async () => {
    expect(await listMedia()).toEqual({ items: [], nextCursor: null });
  });
});

describe("deleteMedia", () => {
  it("refuses while a post uses the image, then deletes and audits", async () => {
    const item = await uploadMedia({ bytes: PNG }, ACTOR);
    const post = await createPost({ title: "With a cover", coverImage: item.url, coverAlt: "A dot" }, ACTOR);
    await expect(deleteMedia(item.url, ACTOR)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("With a cover") });
    expect(await getMedia(item.path)).not.toBeNull();

    await store.posts.update(post.id, { coverImage: null, body: `![a dot](${item.url})` });
    await expect(deleteMedia(item.path, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    await store.posts.update(post.id, { body: "No image now." });

    const removed = await deleteMedia(item.path, ACTOR);
    expect(removed.path).toBe(item.path);
    expect(await getMedia(item.path)).toBeNull();
    expect((await store.audit.list({ entity: "media" })).items[0]).toMatchObject({ action: "media.delete", before: item, after: null });
    await expect(deleteMedia(item.path, ACTOR)).rejects.toMatchObject({ code: "not_found" });
  });

  it("never resolves a path outside the uploads root", () => {
    expect(resolveMediaFile("../../package.json")).toBeNull();
    expect(resolveMediaFile("2026/10/../../../x.png")).toBeNull();
    expect(resolveMediaFile(`2026/10/${"a".repeat(32)}.png`)).toBe(join(ROOT, "2026/10", `${"a".repeat(32)}.png`));
  });
});

describe("GET /uploads/[...path]", () => {
  it("serves a stored image with its type, immutable caching, nosniff and an ETag that answers 304", async () => {
    const item = await uploadMedia({ bytes: PNG }, ACTOR);
    const res = await get(item.path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    const etag = res.headers.get("etag") ?? "";
    expect(etag).toMatch(/^".+"$/);
    const revalidated = await get(item.path, { "if-none-match": `W/${etag}, "other"` });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
  });

  it("404s (uncached) for anything that isn't one of our stored files", async () => {
    const item = await uploadMedia({ bytes: PNG }, ACTOR);
    // A file planted in the folder with an executable type is never served.
    const planted = item.path.replace(/\.png$/, ".html");
    writeFileSync(join(ROOT, planted), "<script>alert(1)</script>");
    for (const path of [planted, `${item.path.slice(0, -4)}.jpg`, "../package.json", "2026/10/..%2f..%2fpackage.json", ".tmp-x", "a/b"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("POST /api/admin/media", () => {
  function upload(file: Blob | null, headers: Record<string, string> = { origin: "http://localhost:3000", accept: "application/json" }) {
    const form = new FormData();
    if (file) form.set("file", file, "photo.png");
    return POST(new Request("http://localhost:3000/api/admin/media", { method: "POST", body: form, headers }));
  }

  it("stores an admin's upload and answers JSON (fetch) or a 303 (no JavaScript)", async () => {
    const res = await upload(new Blob([PNG], { type: "image/png" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; item: { url: string } };
    expect(body.ok).toBe(true);
    expect(body.item.url).toMatch(/^\/uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/);

    const plain = await upload(new Blob([PNG], { type: "image/png" }), { origin: "http://localhost:3000", accept: "text/html" });
    expect(plain.status).toBe(303);
    expect(plain.headers.get("location")).toMatch(/^\/admin\/media\?uploaded=/);
  });

  it("refuses another origin, a non-admin, no file and an SVG — with fixed codes for the no-JS page", async () => {
    expect((await upload(new Blob([PNG]), { origin: "https://evil.example", accept: "application/json" })).status).toBe(403);
    expect((await upload(new Blob([PNG]), { accept: "text/html" })).headers.get("location")).toBe("/admin/media?error=forbidden");
    viewer = { id: "u2", email: "user@example.com", role: "user" };
    expect((await upload(new Blob([PNG]))).status).toBe(404);
    viewer = { id: "u1", email: "admin@example.com", role: "admin" };
    expect(await (await upload(null)).json()).toMatchObject({ ok: false, error: "no_file" });
    const svg = await upload(new Blob(['<svg onload="alert(1)"/>'], { type: "image/svg+xml" }));
    expect(svg.status).toBe(415);
    expect(await svg.json()).toMatchObject({ ok: false, error: "svg" });
    expect((await upload(new Blob(["<svg/>"]), { origin: "http://localhost:3000", accept: "text/html" })).headers.get("location")).toBe("/admin/media?error=svg");
    expect((await store.audit.list({ entity: "media" })).items).toHaveLength(0);
  });
});
