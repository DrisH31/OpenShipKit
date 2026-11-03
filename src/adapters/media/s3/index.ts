import "server-only";

//
// MEDIA_STORAGE=s3: uploaded images in any S3-compatible bucket, such as Garage
// or MinIO on your own server, Cloudflare R2, or AWS S3. Requests are signed
// with SigV4 (aws4fetch) over fetch: no AWS SDK.
//
//   S3_ENDPOINT           https://<account>.r2.cloudflarestorage.com, http://garage:3900,
//                         https://s3.<region>.amazonaws.com …
//   S3_BUCKET             the bucket (create it first; keep it private)
//   S3_ACCESS_KEY_ID      a key that can read, write, delete and list in it
//   S3_SECRET_ACCESS_KEY
//   S3_REGION             default "auto" (R2); us-east-1 for MinIO, the bucket's region for AWS
//   S3_PREFIX             default "uploads/": where in the bucket the yyyy/mm/… paths go
//
// The bucket stays private: images are still served from /uploads/… by the
// app (src/app/uploads), with the same immutable caching, nosniff and
// sandboxing CSP as from disk, so a page never depends on the bucket's own
// headers or URL. Paths are validated by the caller (media-storage.ts) before
// they reach here. Requests use path style (endpoint/bucket/key), which every
// S3-compatible store accepts.
//

import { AwsClient } from "aws4fetch";

export type StoredObject = { size: number; modified: Date };

export interface S3MediaConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

export interface S3MediaStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<StoredObject>;
  head(path: string): Promise<StoredObject | null>;
  get(path: string): Promise<{ bytes: Buffer; object: StoredObject } | null>;
  remove(path: string): Promise<boolean>;
  list(): Promise<({ path: string } & StoredObject)[]>;
}

const TIMEOUT_MS = 20_000;

/** Every <Contents> of a ListObjectsV2 reply, and the continuation token. Exported for the tests. */
export function parseListing(xml: string): { items: { key: string; size: number; modified: Date }[]; next: string | null } {
  const tag = (block: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? null;
  const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const items = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].flatMap(([, block]) => {
    const key = tag(block, "Key");
    const size = Number(tag(block, "Size"));
    const modified = new Date(tag(block, "LastModified") ?? "");
    return key && Number.isFinite(size) && !Number.isNaN(modified.getTime()) ? [{ key: unescape(key), size, modified }] : [];
  });
  const truncated = tag(xml, "IsTruncated") === "true";
  const token = tag(xml, "NextContinuationToken");
  // Truncated with no token to continue from: listing on would silently drop the rest of the library.
  if (truncated && !token) throw new Error("S3 listing is truncated but has no NextContinuationToken");
  return { items, next: truncated && token ? unescape(token) : null };
}

export function createS3MediaStore(config: S3MediaConfig, fetcher?: typeof fetch): S3MediaStore {
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: config.region });
  const base = `${config.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(config.bucket)}`;
  const keyOf = (path: string) => `${config.prefix}${path}`;
  const urlOf = (path: string) => `${base}/${keyOf(path).split("/").map(encodeURIComponent).join("/")}`;
  // aws4fetch signs and then calls fetch; tests pass their own.
  const send = async (url: string, init: RequestInit) => {
    const signed = await client.sign(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return (fetcher ?? fetch)(signed);
  };
  const objectOf = (res: Response): StoredObject => ({
    size: Number(res.headers.get("content-length") ?? 0),
    modified: new Date(res.headers.get("last-modified") ?? Date.now()),
  });
  const fail = async (what: string, res: Response): Promise<never> => {
    // The status and S3's error code; never the URL's query (it can hold a signature) or the body at length.
    const code = /<Code>([^<]+)<\/Code>/.exec(await res.text().catch(() => ""))?.[1];
    throw new Error(`S3 ${what} failed: HTTP ${res.status}${code ? ` ${code}` : ""}`);
  };

  return {
    async put(path, bytes, contentType) {
      const res = await send(urlOf(path), { method: "PUT", body: bytes as BodyInit, headers: { "content-type": contentType, "content-length": String(bytes.byteLength) } });
      if (!res.ok) await fail("upload", res);
      return { size: bytes.byteLength, modified: new Date() };
    },
    async head(path) {
      const res = await send(urlOf(path), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) await fail("stat", res);
      return objectOf(res);
    },
    async get(path) {
      const res = await send(urlOf(path), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) await fail("read", res);
      const bytes = Buffer.from(await res.arrayBuffer());
      return { bytes, object: { size: bytes.byteLength, modified: new Date(res.headers.get("last-modified") ?? Date.now()) } };
    },
    async remove(path) {
      // S3 answers 204 whether or not the object existed: ask first, so the caller learns which.
      if (!(await this.head(path))) return false;
      const res = await send(urlOf(path), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail("delete", res);
      return true;
    },
    async list() {
      const out: ({ path: string } & StoredObject)[] = [];
      let token: string | null = null;
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix: config.prefix, ...(token ? { "continuation-token": token } : {}) });
        const res = await send(`${base}?${query}`, { method: "GET" });
        if (!res.ok) await fail("list", res);
        const page = parseListing(await res.text());
        for (const item of page.items) {
          if (item.key.startsWith(config.prefix)) out.push({ path: item.key.slice(config.prefix.length), size: item.size, modified: item.modified });
        }
        token = page.next;
      } while (token);
      return out;
    },
  };
}
