//
// IndexNow: off unless INDEXNOW_KEY is set and the site URL is public; a post
// write announces exactly the URLs that are (or just stopped being) live; a
// failing or hanging engine never makes a save fail; and the key file route
// answers only the configured key. fetch is mocked: nothing leaves the test.
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/core/data";
import { createMemoryStore } from "@/adapters/data/memory";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));

const { INDEXNOW_ENDPOINT, changedPostPaths, indexNowEnabled, pingIndexNow } = await import("./indexnow");
const { createPost, deletePost, updatePost } = await import("./posts");
const { GET: keyFile } = await import("@/app/api/indexnow/[key]/route");

const ACTOR = { type: "system" as const, id: null, label: "test" };
const KEY = "0123456789abcdef0123456789abcdef";

let fetchMock: ReturnType<typeof vi.fn>;

/** Wait for fire-and-forget pings to settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function sentBodies(): { host: string; key: string; keyLocation: string; urlList: string[] }[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

beforeEach(() => {
  store = createMemoryStore({ fresh: true });
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INDEXNOW_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://acme.dev");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("indexNowEnabled", () => {
  it("needs a well-formed key and a public https origin", () => {
    expect(indexNowEnabled()).toBe(true);
    for (const url of ["http://localhost:3000", "https://localhost", "https://example.com", "https://www.example.org", "https://staging.test", "https://192.168.1.10", "http://acme.dev"]) {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", url);
      expect(indexNowEnabled(), url).toBe(false);
    }
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://acme.dev");
    vi.stubEnv("INDEXNOW_KEY", "");
    expect(indexNowEnabled()).toBe(false);
    vi.stubEnv("INDEXNOW_KEY", "short");
    expect(indexNowEnabled()).toBe(false);
    vi.stubEnv("INDEXNOW_KEY", "has spaces in it!");
    expect(indexNowEnabled()).toBe(false);
  });
});

describe("pingIndexNow", () => {
  it("posts the host, key, key location and absolute URLs, deduplicated", async () => {
    await pingIndexNow(["/blog/a", "/blog/a", "/changelog/b", "https://elsewhere.dev/x"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(sentBodies()[0]).toEqual({
      host: "acme.dev",
      key: KEY,
      keyLocation: `https://acme.dev/${KEY}.txt`,
      urlList: ["https://acme.dev/blog/a", "https://acme.dev/changelog/b"],
    });
  });

  it("sends nothing when off", async () => {
    vi.stubEnv("INDEXNOW_KEY", "");
    await pingIndexNow(["/blog/a"]);
    vi.stubEnv("INDEXNOW_KEY", KEY);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    await pingIndexNow(["/blog/a"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws: a refusal or a network failure is only logged", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403, statusText: "Forbidden" }));
    await expect(pingIndexNow(["/blog/a"])).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("403"));
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(pingIndexNow(["/blog/a"])).resolves.toBeUndefined();
  });
});

describe("changedPostPaths", () => {
  const post = (status: "draft" | "published", slug = "a", kind: "post" | "changelog" | "page" = "post") => ({ kind, slug, status });
  it("announces live URLs and URLs that just stopped being live; never a draft", () => {
    expect(changedPostPaths(null, post("draft"))).toEqual([]);
    expect(changedPostPaths(post("draft"), post("draft"))).toEqual([]);
    expect(changedPostPaths(null, post("published"))).toEqual(["/blog/a"]);
    expect(changedPostPaths(post("draft"), post("published"))).toEqual(["/blog/a"]);
    expect(changedPostPaths(post("published"), post("draft"))).toEqual(["/blog/a"]);
    expect(changedPostPaths(post("published"), post("published", "b"))).toEqual(["/blog/a", "/blog/b"]);
    expect(changedPostPaths(post("published"), null)).toEqual(["/blog/a"]);
    expect(changedPostPaths(null, post("published", "v2", "changelog"))).toEqual(["/changelog/v2"]);
    expect(changedPostPaths(null, post("published", "privacy", "page"))).toEqual(["/legal/privacy"]);
  });
});

describe("post writes", () => {
  it("ping on publish, edit, unlist, unpublish and delete of a published post — not for drafts", async () => {
    const draft = await createPost({ title: "Hello", body: "x" }, ACTOR);
    await updatePost(draft.id, { title: "Hello there" }, ACTOR);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    await updatePost(draft.id, { status: "published" }, ACTOR);
    await updatePost(draft.id, { title: "Hello, world" }, ACTOR);
    await updatePost(draft.id, { listed: false }, ACTOR);
    await updatePost(draft.id, { status: "draft" }, ACTOR);
    await updatePost(draft.id, { status: "published" }, ACTOR);
    await deletePost(draft.id, ACTOR);
    await settle();
    expect(sentBodies().map((b) => b.urlList)).toEqual(Array(6).fill(["https://acme.dev/blog/hello"]));
  });

  it("a hanging or failing engine never fails the save", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    const post = await createPost({ title: "Fast save", status: "published", body: "x" }, ACTOR);
    expect(post.status).toBe("published");
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(updatePost(post.id, { title: "Still fast" }, ACTOR)).resolves.toMatchObject({ title: "Still fast" });
  });
});

describe("GET /<key>.txt (via /api/indexnow/[key])", () => {
  const get = (key: string) => keyFile(new Request(`http://localhost/api/indexnow/${key}`), { params: Promise.resolve({ key }) });

  it("answers the configured key as plain text, and nothing else", async () => {
    const res = await get(KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(KEY);
    expect((await get(`${KEY}.txt`)).status).toBe(200);
    expect((await get("0000000000000000")).status).toBe(404);
    vi.stubEnv("INDEXNOW_KEY", "");
    expect((await get(KEY)).status).toBe(404);
  });
});
