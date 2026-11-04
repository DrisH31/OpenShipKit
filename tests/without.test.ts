//
// Switching features off (OPENSHIPKIT_WITHOUT=blog,mcp): their routes answer
// 404 and every surface that links to them drops the link, through the same
// path list the site profile uses (src/core/profile.ts).
//

import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import type { DataStore } from "@/core/data";
import { FEATURES, FEATURE_PATHS, forProfile, isHiddenPath, navigationForProfile } from "@/core/profile";
import { FEATURE_NAMES, resolveWithout } from "@/server/env-rules";

let store: DataStore = createMemoryStore({ fresh: true });
vi.mock("@/server/data", () => ({ getData: async () => store }));
afterEach(() => vi.unstubAllEnvs());

describe("the feature switch", () => {
  it("names the same features in core and in the env rules", () => {
    expect([...FEATURE_NAMES].sort()).toEqual([...FEATURES].sort());
  });

  it("reads OPENSHIPKIT_WITHOUT, refusing a name it doesn't know", () => {
    expect(resolveWithout({})).toEqual([]);
    expect(resolveWithout({ OPENSHIPKIT_WITHOUT: " Blog , mcp,blog" })).toEqual(["blog", "mcp"]);
    expect(() => resolveWithout({ OPENSHIPKIT_WITHOUT: "blgo" })).toThrow(/isn't a feature/);
  });

  it("hides a switched-off feature's paths, whatever the profile, and nothing else", () => {
    expect(isHiddenPath("/blog", "saas", ["blog"])).toBe(true);
    expect(isHiddenPath("/blog/hello?x=1", "saas", ["blog"])).toBe(true);
    expect(isHiddenPath("/blog-ish", "saas", ["blog"])).toBe(false);
    expect(isHiddenPath("/changelog", "saas", ["blog"])).toBe(false); // the changelog stays
    expect(isHiddenPath("/admin/agents", "saas", ["mcp"])).toBe(true);
    expect(isHiddenPath("/pricing", "saas", ["blog"])).toBe(false);
    expect(isHiddenPath("/pricing", "site", ["blog"])).toBe(true);
    expect(forProfile("saas", [{ href: "/blog" }, { href: "/contact" }], ["blog"])).toEqual([{ href: "/contact" }]);
  });

  it("drops the links from navigation, and a footer column left empty", () => {
    const nav = {
      header: [{ label: "Blog", href: "/blog" }, { label: "Pricing", href: "/pricing" }],
      headerCta: null,
      footer: [
        { title: "Read", links: [{ label: "Blog", href: "/blog" }, { label: "RSS", href: "/blog/rss.xml" }] },
        { title: "Company", links: [{ label: "Contact", href: "/contact" }] },
      ],
    };
    const out = navigationForProfile("saas", nav as never, ["blog"]);
    expect(out.header.map((l) => l.href)).toEqual(["/pricing"]);
    expect(out.footer.map((c) => c.title)).toEqual(["Company"]);
  });

  it("every feature owns at least one path", () => {
    for (const f of FEATURES) expect(FEATURE_PATHS[f].length).toBeGreaterThan(0);
  });
});

describe("switched-off routes answer 404", () => {
  it("the blog feed and the MCP endpoint", async () => {
    vi.stubEnv("OPENSHIPKIT_WITHOUT", "blog,mcp");
    const rss = await import("@/app/(marketing)/blog/rss.xml/route");
    expect((await rss.GET()).status).toBe(404);
    const mcp = await import("@/app/api/mcp/route");
    const res = await mcp.POST(new Request("http://localhost/api/mcp", { method: "POST", body: "{}" }));
    expect(res.status).toBe(404);
  });
});

describe("switched off beyond links", () => {
  it("writing a blog post is a switched-off link; a changelog entry isn't", () => {
    expect(isHiddenPath("/admin/posts/new?kind=post", "saas", ["blog"])).toBe(true);
    expect(isHiddenPath("/admin/posts/new?kind=changelog", "saas", ["blog"])).toBe(false);
    expect(isHiddenPath("/admin/posts/new?kind=post", "saas", [])).toBe(false);
  });

  it("with the blog off, blog posts can't be created or published (edit, restore), but existing ones can be edited, unpublished, deleted", async () => {
    store = createMemoryStore({ fresh: true });
    const { createPost, updatePost, setPostStatus, deletePost } = await import("@/server/services/posts");
    const { restoreAuditEntry } = await import("@/server/services/audit");
    const actor = { type: "system" as const, id: null, label: "test" };
    const live = await createPost({ kind: "post", title: "Live one", body: "x", status: "published" }, actor);
    const draft = await createPost({ kind: "post", title: "Draft one", body: "x" }, actor);
    vi.stubEnv("OPENSHIPKIT_WITHOUT", "blog");
    await expect(createPost({ kind: "post", title: "Hello", body: "x" }, actor)).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/blog is switched off/) });
    await expect(createPost({ kind: "changelog", title: "1.1", body: "x" }, actor)).resolves.toMatchObject({ kind: "changelog" });
    await expect(setPostStatus(draft.id, "published", actor)).rejects.toMatchObject({ code: "invalid" });
    await expect(updatePost(live.id, { title: "Typo fixed" }, actor)).resolves.toMatchObject({ title: "Typo fixed" });
    await expect(setPostStatus(live.id, "draft", actor)).resolves.toMatchObject({ status: "draft" });
    // Restoring the "published" before of that unpublish would publish it again: refused.
    const entry = (await store.audit.list({ entity: "post", entityId: live.id, limit: 10 })).items.find((e) => (e.after as { status?: string } | null)?.status === "draft")!;
    await expect(restoreAuditEntry(entry.id, actor)).rejects.toMatchObject({ code: "invalid" });
    await deletePost(live.id, actor);
  });

  it("the setup checklist drops a step whose action is switched off", async () => {
    vi.stubEnv("OPENSHIPKIT_WITHOUT", "mcp");
    store = createMemoryStore({ fresh: true });
    const { getSetupSteps } = await import("@/server/setup-steps");
    const steps = await getSetupSteps(true);
    expect(steps.map((s) => s.id)).not.toContain("mcp");
    for (const s of steps) if (s.action) expect(isHiddenPath(s.action.href, "saas", ["mcp"]), s.id).toBe(false);
    vi.stubEnv("OPENSHIPKIT_WITHOUT", "");
    expect((await getSetupSteps(true)).map((s) => s.id)).toContain("mcp");
  });

  it("every method of the MCP endpoint answers 404 with mcp off", async () => {
    vi.stubEnv("OPENSHIPKIT_WITHOUT", "mcp");
    const mcp = await import("@/app/api/mcp/route");
    expect((await mcp.GET()).status).toBe(404);
    expect((await mcp.DELETE()).status).toBe(404);
  });
});

describe("the admin posts list follows the blog switch", () => {
  it("opens on the changelog with the blog off, and every link names a kind that isn't the default", async () => {
    const { defaultPostKind, postsListHref } = await import("@/app/admin/posts/list-href");
    expect(defaultPostKind()).toBe("post");
    expect(postsListHref("post")).toBe("/admin/posts");
    expect(postsListHref("changelog", { deleted: "1" })).toBe("/admin/posts?kind=changelog&deleted=1");
    vi.stubEnv("OPENSHIPKIT_WITHOUT", "blog");
    expect(defaultPostKind()).toBe("changelog");
    expect(postsListHref("post")).toBe("/admin/posts?kind=post");
    expect(postsListHref("changelog")).toBe("/admin/posts");
  });
});
