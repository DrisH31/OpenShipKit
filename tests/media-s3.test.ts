//
// Uploads in an S3-compatible bucket (ROADMAP 3.4), through the real media
// facade (src/server/services/media-storage.ts) with MEDIA_STORAGE=s3, against
// a minimal S3 server on a real socket: PUT, GET, HEAD, DELETE and paginated
// ListObjectsV2, every request SigV4-signed.
//

import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseListing } from "@/adapters/media/s3";

type Obj = { bytes: Buffer; type: string; modified: Date };
const objects = new Map<string, Obj>();
const seen: { method: string; auth: string; url: string }[] = [];
let server: Server;
let port = 0;
const PAGE = 2; // small pages, so listing must follow continuation tokens

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({ method: req.method ?? "", auth: String(req.headers.authorization ?? ""), url: url.pathname });
    const key = decodeURIComponent(url.pathname.replace(/^\/media-bucket\/?/, ""));
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "GET" && !key) {
        const prefix = url.searchParams.get("prefix") ?? "";
        const after = url.searchParams.get("continuation-token") ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
        const page = keys.slice(0, PAGE);
        const more = keys.length > PAGE;
        res.setHeader("content-type", "application/xml");
        res.end(
          `<?xml version="1.0"?><ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${page[page.length - 1]}</NextContinuationToken>` : ""}` +
            page.map((k) => `<Contents><Key>${k}</Key><Size>${objects.get(k)!.bytes.length}</Size><LastModified>${objects.get(k)!.modified.toISOString()}</LastModified></Contents>`).join("") +
            `</ListBucketResult>`,
        );
        return;
      }
      const obj = objects.get(key);
      if (req.method === "PUT") {
        objects.set(key, { bytes: Buffer.concat(chunks), type: String(req.headers["content-type"]), modified: new Date() });
        res.statusCode = 200;
        res.end();
      } else if (req.method === "HEAD" || req.method === "GET") {
        if (!obj) {
          res.statusCode = 404;
          res.end(req.method === "GET" ? "<Error><Code>NoSuchKey</Code></Error>" : undefined);
          return;
        }
        res.setHeader("content-length", String(obj.bytes.length));
        res.setHeader("last-modified", obj.modified.toUTCString());
        res.setHeader("content-type", obj.type);
        res.end(req.method === "GET" ? obj.bytes : undefined);
      } else if (req.method === "DELETE") {
        objects.delete(key);
        res.statusCode = 204;
        res.end();
      } else {
        res.statusCode = 405;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  objects.clear();
  seen.length = 0;
});

async function s3Facade() {
  vi.stubEnv("MEDIA_STORAGE", "");
  vi.stubEnv("S3_BUCKET", "media-bucket"); // S3_BUCKET alone switches storage to s3
  vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${port}`);
  vi.stubEnv("S3_ACCESS_KEY_ID", "GKtestkey");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("S3_REGION", "garage");
  vi.stubEnv("UPLOADS_DIR", "/nonexistent/should-not-be-used");
  return import("@/server/services/media-storage");
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0dd3b2890000000049454e44ae426082", "hex");

describe("media in an S3-compatible bucket", () => {
  it("writes, reads, stats, lists and removes through the same functions as the disk", async () => {
    const media = await s3Facade();
    const item = await media.writeMediaFile(PNG, "image/png", new Date(Date.UTC(2026, 10, 3)));
    expect(item.path).toMatch(/^2026\/11\/[0-9a-f]{32}\.png$/);
    expect(item).toMatchObject({ url: `/uploads/${item.path}`, contentType: "image/png", size: PNG.length });
    expect([...objects.keys()]).toEqual([`uploads/${item.path}`]); // under the default prefix
    expect(objects.get(`uploads/${item.path}`)?.type).toBe("image/png");

    expect(await media.statMedia(item.path)).toMatchObject({ size: PNG.length });
    expect((await media.readMedia(item.path))?.bytes.equals(PNG)).toBe(true);
    expect(await media.statMedia("2026/11/" + "0".repeat(32) + ".png")).toBeNull();

    expect(await media.removeMediaFile(item.path)).toBe(true);
    expect(await media.removeMediaFile(item.path)).toBe(false);
    expect(await media.readMedia(item.path)).toBeNull();
  });

  it("S3_PREFIX names a folder however it's written", async () => {
    for (const [prefix, folder] of [["/media/", "media/"], ["media", "media/"], ["/", ""]] as const) {
      objects.clear();
      vi.resetModules();
      vi.stubEnv("S3_PREFIX", prefix);
      const media = await s3Facade();
      const item = await media.writeMediaFile(PNG, "image/png");
      expect([...objects.keys()], prefix).toEqual([`${folder}${item.path}`]);
    }
  });

  it("signs every request with SigV4 for the configured region", async () => {
    const media = await s3Facade();
    await media.writeMediaFile(PNG, "image/png");
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) expect(r.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=GKtestkey\/\d{8}\/garage\/s3\/aws4_request, SignedHeaders=.+, Signature=[0-9a-f]{64}$/);
  });

  it("lists every page, newest first, and skips keys that aren't ours", async () => {
    const media = await s3Facade();
    const a = await media.writeMediaFile(PNG, "image/png", new Date(Date.UTC(2026, 0, 5)));
    await new Promise((r) => setTimeout(r, 15));
    const b = await media.writeMediaFile(PNG, "image/png", new Date(Date.UTC(2026, 1, 5)));
    await new Promise((r) => setTimeout(r, 15));
    const c = await media.writeMediaFile(PNG, "image/png", new Date(Date.UTC(2026, 2, 5)));
    objects.set("uploads/notes.txt", { bytes: Buffer.from("x"), type: "text/plain", modified: new Date() });
    objects.set("other/2026/01/" + "a".repeat(32) + ".png", { bytes: PNG, type: "image/png", modified: new Date() });
    const listed = await media.listMediaFiles();
    expect(listed.map((i) => i.path)).toEqual([c.path, b.path, a.path]); // 3 of ours over 3 pages; strays skipped
  });

  it("never sends a path that isn't one of ours to the bucket", async () => {
    const media = await s3Facade();
    for (const bad of ["../secrets", "2026/11/../../x.png", "2026/11/.env", "uploads/2026/11/x.png"]) {
      expect(await media.readMedia(bad)).toBeNull();
      expect(await media.removeMediaFile(bad)).toBe(false);
    }
    expect(seen).toEqual([]);
  });

  it("reports a refusal with S3's code and status, never the signed URL", async () => {
    const { createS3MediaStore } = await import("@/adapters/media/s3");
    const store = createS3MediaStore(
      { endpoint: "http://127.0.0.1:1", bucket: "b", region: "auto", accessKeyId: "k", secretAccessKey: "s", prefix: "uploads/" },
      async () => new Response("<Error><Code>AccessDenied</Code><Message>no</Message></Error>", { status: 403 }),
    );
    await expect(store.put("2026/11/" + "b".repeat(32) + ".png", PNG, "image/png")).rejects.toThrow(/^S3 upload failed: HTTP 403 AccessDenied$/);
  });

  it("parses a listing, escaped keys and the continuation token included", () => {
    expect(
      parseListing(
        "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;1</NextContinuationToken><Contents><Key>uploads/a&amp;b</Key><Size>3</Size><LastModified>2026-11-03T00:00:00.000Z</LastModified></Contents></ListBucketResult>",
      ),
    ).toEqual({ items: [{ key: "uploads/a&b", size: 3, modified: new Date("2026-11-03T00:00:00.000Z") }], next: "t&1" });
  });
});

describe("listing edge cases", () => {
  it("refuses a truncated listing with no continuation token rather than silently dropping the rest", () => {
    expect(() => parseListing("<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>")).toThrow(/truncated/);
  });
});
