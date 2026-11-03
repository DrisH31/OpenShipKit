//
// The MCP server, driven through its protocol handler against a fresh memory
// store: the JSON-RPC surface, scopes, refusals, the content → audit → restore
// loop, the post lifecycle, the admin-only lines (personal data, what plans
// charge), the dev-key and Origin rules, and that docs/mcp.md
// documents every registered tool.
//

import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/core/data";
import type { AgentScope } from "@/core/types";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { createMemoryStore } from "@/adapters/data/memory";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
vi.mock("@/server/auth", () => ({ getAuth: async () => ({ id: "better-auth", deleteIdentity: undefined }) }));
// React's cache() is a request-scoped memo; in tests run the function each time.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const { handleMcpMessage, LATEST_PROTOCOL_VERSION, PROTOCOL_VERSIONS } = await import("@/server/mcp/protocol");
const { TOOLS } = await import("@/server/mcp/tools");
const { authBlockedFor, authenticateMcp, noteAuthFailure, originAllowed, DEV_KEY_ID } = await import("@/server/mcp/auth");
const { mintAgentKey } = await import("@/server/services/agent-keys");
type Ctx = NonNullable<Awaited<ReturnType<typeof authenticateMcp>>>;

const SYSTEM = { type: "system" as const, id: null, label: "test" };

/** The raw bearer token of each minted test key, by key id. */
const rawKeys = new Map<string, string>();

async function keyCtx(scope: AgentScope, name = `${scope} agent`): Promise<Ctx> {
  const { key, agentKey } = await mintAgentKey(name, scope, SYSTEM);
  rawKeys.set(agentKey.id, key);
  const ctx = await authenticateMcp(key);
  if (!ctx) throw new Error("minted key did not authenticate");
  return ctx;
}

let nextId = 1;
async function rpc(ctx: Ctx, method: string, params?: Record<string, unknown>) {
  const reply = await handleMcpMessage({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }, ctx);
  if (!reply) throw new Error(`no reply to ${method}`);
  return reply as { id: number; result?: Record<string, unknown>; error?: { code: number; message: string } };
}

interface CallResult {
  structuredContent: Record<string, unknown>;
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function call(ctx: Ctx, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  const reply = await rpc(ctx, "tools/call", { name, arguments: args });
  if (reply.error) throw new Error(`${name}: rpc error ${reply.error.message}`);
  return reply.result as unknown as CallResult;
}

/** Call a tool that must succeed; return its structured output. */
async function ok<T = Record<string, unknown>>(ctx: Ctx, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await call(ctx, name, args);
  expect(result.isError, `${name}: ${JSON.stringify(result.structuredContent)}`).toBeUndefined();
  return result.structuredContent as T;
}

let admin: Ctx;
let writer: Ctx;
let reader: Ctx;

beforeEach(async () => {
  store = createMemoryStore({ fresh: true });
  admin = await keyCtx("admin");
  writer = await keyCtx("write");
  reader = await keyCtx("read");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("protocol", () => {
  it("initialize negotiates the version and sends instructions", async () => {
    const known = await rpc(reader, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(known.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "openshipkit" },
    });
    expect(String(known.result?.instructions)).toContain("guide");

    for (const v of PROTOCOL_VERSIONS) expect((await rpc(reader, "initialize", { protocolVersion: v })).result?.protocolVersion).toBe(v);
    expect((await rpc(reader, "initialize", { protocolVersion: "1999-01-01" })).result?.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect((await rpc(reader, "initialize")).result?.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("answers ping, ignores notifications and responses", async () => {
    expect((await rpc(reader, "ping")).result).toEqual({});
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, reader)).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }, reader)).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 9, result: {} }, reader)).toBeNull();
  });

  it("uses JSON-RPC error codes for protocol mistakes", async () => {
    expect(await handleMcpMessage({ id: 1, method: "ping" }, reader)).toMatchObject({ error: { code: -32600 } });
    expect(await handleMcpMessage("ping", reader)).toMatchObject({ id: null, error: { code: -32600 } });
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: { x: 1 }, method: "ping" }, reader)).toMatchObject({ error: { code: -32600 } });
    expect((await rpc(reader, "resources/list")).error?.code).toBe(-32601);
    expect((await rpc(reader, "tools/call", { name: "no_such_tool", arguments: {} })).error?.code).toBe(-32602);
    expect((await rpc(reader, "tools/call", { arguments: {} })).error?.code).toBe(-32602);
    expect((await rpc(reader, "tools/call", { name: "guide", arguments: [1] })).error?.code).toBe(-32602);
  });

  it("returns text content and structuredContent together", async () => {
    const result = await call(reader, "content_get", { key: "hero" });
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });
});

describe("tool registry", () => {
  it("every tool is well-formed", async () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const listed = (await rpc(admin, "tools/list")).result?.tools as Record<string, unknown>[];
    expect(listed.map((t) => t.name)).toEqual(names);
    for (const tool of listed) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(String(tool.description).length, String(tool.name)).toBeGreaterThan(60);
      expect(tool.title).toBeTruthy();
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.inputSchema).not.toHaveProperty("$schema");
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
    }
    // A read key never reaches a tool that changes anything.
    for (const t of TOOLS) if (!t.annotations.readOnlyHint) expect(t.scope, t.name).not.toBe("read");
  });

  it("covers the whole site", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const name of [
      "site_overview", "guide", "content_list", "content_get", "content_update", "content_reset",
      "posts_list", "post_get", "post_create", "post_update", "post_publish", "post_unpublish", "post_delete",
      "media_list", "media_upload",
      "plans_list", "plan_get", "plan_upsert", "plan_update", "plan_delete",
      "feedback_list", "feedback_update", "audit_list", "audit_restore", "render_markdown_preview",
      "users_list", "user_get", "user_set_role", "user_set_banned", "subscribers_list", "subscriber_unsubscribe",
      "agent_keys_list", "agent_key_revoke",
    ]) expect(names.has(name), name).toBe(true);
  });

  it("docs/mcp.md names every registered tool", () => {
    const doc = readFileSync(resolve(__dirname, "../docs/mcp.md"), "utf8");
    const missing = TOOLS.map((t) => t.name).filter((name) => !doc.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });
});

describe("scopes", () => {
  it("tools/list shows only what the key may call", async () => {
    const names = async (ctx: Ctx) => ((await rpc(ctx, "tools/list")).result?.tools as { name: string }[]).map((t) => t.name);
    const read = await names(reader);
    const write = await names(writer);
    const all = await names(admin);
    expect(read).toContain("content_get");
    expect(read).not.toContain("content_update");
    expect(write).toContain("content_update");
    expect(write).not.toContain("users_list");
    expect(all).toContain("agent_key_revoke");
    expect(read.length).toBeLessThan(write.length);
    expect(write.length).toBeLessThan(all.length);
  });

  it("tools/call re-checks the scope", async () => {
    const denied = await call(reader, "content_update", { key: "hero", value: { title: "Nope" } });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ error: "forbidden" });
    expect(String(denied.structuredContent.message)).toContain("write");
    expect((await call(writer, "users_list")).structuredContent).toMatchObject({ error: "forbidden" });
    expect((await ok<{ value: { title: string } }>(reader, "content_get", { key: "hero" })).value.title).toBe(DEFAULT_CONTENT.hero.title);
  });
});

describe("arguments and refusals", () => {
  it("invalid arguments come back as a readable tool error", async () => {
    const wrongType = await call(writer, "content_update", { key: "hero", value: "not an object" });
    expect(wrongType.isError).toBe(true);
    expect(wrongType.structuredContent).toMatchObject({ error: "invalid" });
    expect(wrongType.structuredContent.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "value" })]));

    const unknownKey = await call(writer, "content_get", { key: "sidebar" });
    expect(unknownKey.structuredContent).toMatchObject({ error: "invalid" });

    const extra = await call(reader, "content_get", { key: "hero", sneaky: true });
    expect(extra.structuredContent).toMatchObject({ error: "invalid" });

    const missing = await call(writer, "post_publish", {});
    expect(missing.structuredContent).toMatchObject({ error: "invalid" });
  });

  it("a value that fails the section schema is refused field by field", async () => {
    const tooLong = await call(writer, "content_update", { key: "hero", value: { title: "x".repeat(500) } });
    expect(tooLong.isError).toBe(true);
    expect(tooLong.structuredContent).toMatchObject({ error: "invalid" });
    expect(String(tooLong.structuredContent.message)).toContain("title");
  });

  it("service refusals are passed through; unexpected errors are hidden and logged", async () => {
    expect((await call(reader, "post_get", { id: "missing" })).structuredContent).toMatchObject({ error: "not_found" });
    expect((await call(reader, "plan_get", { key: "nope" })).structuredContent).toMatchObject({ error: "not_found" });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store.posts, "list").mockRejectedValue(new Error("connection reset: secret-host:5432"));
    const crashed = await call(reader, "posts_list");
    expect(crashed.isError).toBe(true);
    expect(crashed.structuredContent).toMatchObject({ error: "server_error" });
    expect(JSON.stringify(crashed)).not.toContain("secret-host");
    expect(log).toHaveBeenCalled();
  });
});

describe("content", () => {
  it("merge → live value → audit → restore", async () => {
    const before = await ok<{ stored: boolean }>(reader, "content_get", { key: "hero" });
    expect(before.stored).toBe(false);

    await ok(writer, "content_update", { key: "hero", mode: "merge", value: { title: "Ship it this weekend" } });
    const after = await ok<{ value: { title: string; subtitle: string }; stored: boolean }>(reader, "content_get", { key: "hero" });
    expect(after.stored).toBe(true);
    expect(after.value.title).toBe("Ship it this weekend");
    expect(after.value.subtitle).toBe(DEFAULT_CONTENT.hero.subtitle);

    const audit = await ok<{ items: { id: string; action: string; actor: string; restorable: boolean }[] }>(reader, "audit_list", { entity: "content", entityId: "hero" });
    expect(audit.items[0]).toMatchObject({ action: "content.update", actor: "agent:write agent", restorable: true });

    const withValues = await ok<{ items: { before: unknown; after: { title: string } }[] }>(reader, "audit_list", { entity: "content", entityId: "hero", includeValues: true });
    expect(withValues.items[0].after.title).toBe("Ship it this weekend");

    // Back to the default, which the site shows: still live.
    expect((await ok<{ live: boolean }>(writer, "audit_restore", { id: audit.items[0].id })).live).toBe(true);
    const restored = await ok<{ value: { title: string }; stored: boolean }>(reader, "content_get", { key: "hero" });
    expect(restored.value.title).toBe(DEFAULT_CONTENT.hero.title);
    expect(restored.stored).toBe(false);
  });

  it("replace, list and reset", async () => {
    await ok(writer, "content_update", {
      key: "announcement",
      mode: "replace",
      value: { enabled: true, text: "We shipped dark mode", link: { label: "Read", href: "/changelog" } },
    });
    const list = await ok<{ items: { key: string; stored: boolean }[] }>(reader, "content_list");
    expect(list.items.find((i) => i.key === "announcement")?.stored).toBe(true);
    await ok(writer, "content_reset", { key: "announcement" });
    expect((await ok<{ stored: boolean }>(reader, "content_get", { key: "announcement" })).stored).toBe(false);
  });

  it("only an admin key moves site.contactEmail, where contact-form messages go", async () => {
    const forbidden = { error: "forbidden" };
    const contactEmail = async () => (await ok<{ value: { contactEmail: string } }>(reader, "content_get", { key: "site" })).value.contactEmail;
    const site = (await ok<{ value: Record<string, unknown> }>(reader, "content_get", { key: "site" })).value;

    // The rest of the section is a write key's.
    await ok(writer, "content_update", { key: "site", value: { tagline: "Ship faster" } });
    await ok(admin, "content_update", { key: "site", value: { contactEmail: "owner@example.com" } });
    expect(await contactEmail()).toBe("owner@example.com");
    await ok(writer, "content_update", { key: "site", mode: "replace", value: { ...site, contactEmail: "owner@example.com", name: "Renamed" } });

    // Pointing it elsewhere, by merge, replace, reset or restore, is refused.
    expect((await call(writer, "content_update", { key: "site", value: { contactEmail: "attacker@example.net" } })).structuredContent).toMatchObject(forbidden);
    expect((await call(writer, "content_update", { key: "site", mode: "replace", value: { ...site } })).structuredContent).toMatchObject(forbidden);
    expect((await call(writer, "content_reset", { key: "site" })).structuredContent).toMatchObject(forbidden);
    // A value that fails the schema is still reported as invalid, not forbidden.
    expect((await call(writer, "content_update", { key: "site", value: { contactEmail: "not an email" } })).structuredContent).toMatchObject({ error: "invalid" });
    expect(await contactEmail()).toBe("owner@example.com");

    // An undo that would put another address back is held to the same rule.
    // (Entries are found by what they hold: several can share a millisecond.)
    type SiteValue = { contactEmail?: string; tagline?: string } | null;
    type SiteEntry = { id: string; before: SiteValue; after: SiteValue };
    const siteAudit = async () => (await ok<{ items: SiteEntry[] }>(reader, "audit_list", { entity: "content", entityId: "site", includeValues: true, limit: 200 })).items;
    await ok(admin, "content_update", { key: "site", value: { contactEmail: "attacker@example.net" } });
    await ok(admin, "content_update", { key: "site", value: { contactEmail: "owner@example.com" } });
    const back = (await siteAudit()).find((e) => e.before?.contactEmail === "attacker@example.net" && e.after?.contactEmail === "owner@example.com")!;
    expect((await call(writer, "audit_restore", { id: back.id })).structuredContent).toMatchObject(forbidden);
    expect(await contactEmail()).toBe("owner@example.com");

    // A restore that leaves the address as it is stays a write key's.
    await ok(writer, "content_update", { key: "site", value: { tagline: "Ship today" } });
    const retag = (await siteAudit()).find((e) => e.after?.tagline === "Ship today")!;
    await ok(writer, "audit_restore", { id: retag.id });
    expect((await ok<{ value: { tagline: string } }>(reader, "content_get", { key: "site" })).value.tagline).toBe(retag.before?.tagline);
    expect(await contactEmail()).toBe("owner@example.com");
  });
});

describe("posts", () => {
  it("draft → publish → edit → unpublish keeps every other field", async () => {
    const created = await ok<{ id: string; status: string; url: string }>(writer, "post_create", {
      title: "Hello agents",
      body: "## Why\n\nBecause.",
      description: "A first post",
      tags: ["news"],
    });
    expect(created.status).toBe("draft");
    expect(created.url).toMatch(/\/blog\/hello-agents$/);

    const published = await ok<{ status: string; publishedAt: string; body: string; tags: string[]; description: string }>(writer, "post_publish", { id: created.id });
    expect(published).toMatchObject({ status: "published", body: "## Why\n\nBecause.", tags: ["news"], description: "A first post" });
    expect(published.publishedAt).toBeTruthy();

    const edited = await ok<{ title: string; body: string; status: string; publishedAt: string }>(writer, "post_update", { id: created.id, title: "Hello, agents" });
    expect(edited).toMatchObject({ title: "Hello, agents", body: "## Why\n\nBecause.", status: "published", publishedAt: published.publishedAt });

    const draft = await ok<{ status: string; body: string }>(writer, "post_unpublish", { id: created.id });
    expect(draft).toMatchObject({ status: "draft", body: "## Why\n\nBecause." });

    const bySlug = await ok<{ id: string }>(reader, "post_get", { kind: "post", slug: "hello-agents" });
    expect(bySlug.id).toBe(created.id);
    const listed = await ok<{ items: { id: string; bodyChars: number }[] }>(reader, "posts_list", { status: "draft" });
    expect(listed.items.find((p) => p.id === created.id)?.bodyChars).toBe(16);
  });

  it("refuses a published post dated in the future (there is no scheduling)", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const past = "2026-01-02T09:00:00Z";
    const draft = await ok<{ id: string }>(writer, "post_create", { title: "Later", body: "Soon", publishedAt: future });

    const refused = await call(writer, "post_publish", { id: draft.id, publishedAt: future });
    expect(refused.structuredContent).toMatchObject({ error: "invalid", details: [expect.objectContaining({ path: "publishedAt" })] });
    // Its stored future date is judged too: publishing it as it stands is refused.
    expect((await call(writer, "post_publish", { id: draft.id })).structuredContent).toMatchObject({ error: "invalid" });
    expect((await call(writer, "post_update", { id: draft.id, status: "published" })).structuredContent).toMatchObject({ error: "invalid" });
    expect((await call(writer, "post_create", { title: "Ahead", body: "x", status: "published", publishedAt: future })).structuredContent).toMatchObject({ error: "invalid" });
    expect((await ok<{ status: string }>(reader, "post_get", { id: draft.id })).status).toBe("draft");

    const backdated = await ok<{ status: string; publishedAt: string }>(writer, "post_publish", { id: draft.id, publishedAt: past });
    expect(backdated).toMatchObject({ status: "published" });
    expect(Date.parse(backdated.publishedAt)).toBe(Date.parse(past));
  });

  it("delete is undone by audit_restore", async () => {
    const created = await ok<{ id: string }>(writer, "post_create", { title: "Short lived", body: "Text" });
    await ok(writer, "post_delete", { id: created.id });
    expect((await call(reader, "post_get", { id: created.id })).structuredContent).toMatchObject({ error: "not_found" });
    const audit = await ok<{ items: { id: string; action: string }[] }>(reader, "audit_list", { entity: "post", entityId: created.id });
    const deletion = audit.items.find((e) => e.action === "post.delete");
    // It was a draft, so the restored post is not public.
    expect((await ok<{ live: boolean }>(writer, "audit_restore", { id: deletion!.id })).live).toBe(false);
    expect((await ok<{ body: string }>(reader, "post_get", { kind: "post", slug: "short-lived" })).body).toBe("Text");
    // Undoing the create removes it: nothing is live.
    const creation = audit.items.find((e) => e.action === "post.create");
    expect((await ok<{ live: boolean }>(writer, "audit_restore", { id: creation!.id })).live).toBe(false);
  });

  it("listed is its own question: unlisting keeps a post live, every other tool keeps it, restore brings it back", async () => {
    const created = await ok<{ id: string; listed: boolean }>(writer, "post_create", { title: "Old guide", body: "Text", status: "published" });
    expect(created.listed).toBe(true);
    const unlisted = await ok<{ listed: boolean; status: string; body: string }>(writer, "post_update", { id: created.id, listed: false });
    expect(unlisted).toMatchObject({ listed: false, status: "published", body: "Text" });
    // Tools that send the full field set don't reset it.
    expect((await ok<{ listed: boolean }>(writer, "post_update", { id: created.id, title: "Old guide (2024)" })).listed).toBe(false);
    expect((await ok<{ listed: boolean }>(writer, "post_unpublish", { id: created.id })).listed).toBe(false);
    expect((await ok<{ listed: boolean; status: string }>(writer, "post_publish", { id: created.id })).listed).toBe(false);

    const off = await ok<{ items: { id: string; listed: boolean }[] }>(reader, "posts_list", { listed: false });
    expect(off.items.map((p) => p.id)).toEqual([created.id]);
    expect((await ok<{ items: { id: string }[] }>(reader, "posts_list", { listed: true })).items.map((p) => p.id)).not.toContain(created.id);

    const audit = await ok<{ items: { id: string; before: { listed?: boolean } | null; after: { listed?: boolean } | null }[] }>(reader, "audit_list", {
      entity: "post",
      entityId: created.id,
      includeValues: true,
    });
    const unlisting = audit.items.find((e) => e.before?.listed === true && e.after?.listed === false);
    await ok(writer, "audit_restore", { id: unlisting!.id });
    expect((await ok<{ listed: boolean }>(reader, "post_get", { id: created.id })).listed).toBe(true);
  });

  it("previews Markdown without saving", async () => {
    const preview = await ok<{ html: string; toc: unknown[] }>(reader, "render_markdown_preview", { markdown: "## Hello\n\nWorld" });
    expect(preview.html).toContain("Hello");
    expect(preview.toc.length).toBe(1);
  });
});

describe("media", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  it("uploads base64 (sniffed, audited), lists it, and refuses SVG, junk and a read key", async () => {
    // A throwaway folder inside the project's gitignored .data/.
    const root = resolve(".data", `test-mcp-uploads-${randomUUID()}`);
    vi.stubEnv("UPLOADS_DIR", root);
    try {
      const item = await ok<{ url: string; absoluteUrl: string; contentType: string; size: number }>(writer, "media_upload", { data: `data:image/png;base64,${PNG}` });
      expect(item).toMatchObject({ contentType: "image/png", size: 70 });
      expect(item.url).toMatch(/^\/uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/);
      expect(item.absoluteUrl.endsWith(item.url)).toBe(true);

      const listed = await ok<{ items: { url: string }[] }>(reader, "media_list");
      expect(listed.items.map((i) => i.url)).toEqual([item.url]);

      const svg = await call(writer, "media_upload", { data: Buffer.from('<svg onload="alert(1)"/>').toString("base64") });
      expect(svg.structuredContent).toMatchObject({ error: "invalid", details: { reason: "svg" } });
      expect((await call(writer, "media_upload", { data: "not base64 at all!" })).structuredContent).toMatchObject({ error: "invalid" });
      expect((await call(writer, "media_upload", { data: PNG, contentType: "image/jpeg" })).structuredContent).toMatchObject({ error: "invalid", details: { reason: "mismatch" } });
      expect((await call(reader, "media_upload", { data: PNG })).structuredContent).toMatchObject({ error: "forbidden" });

      const audit = await ok<{ items: { action: string }[] }>(reader, "audit_list", { entity: "media", includeValues: true });
      expect(audit.items.map((e) => e.action)).toEqual(["media.upload"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("plans", () => {
  it("upsert, update one field, delete and restore", async () => {
    const plan = await ok<{ plan: { key: string; prices: unknown[] } }>(admin, "plan_upsert", {
      key: "team",
      name: "Team",
      prices: [{ interval: "month", amountCents: 4900 }],
    });
    expect(plan.plan).toMatchObject({ key: "team", prices: [{ interval: "month", amountCents: 4900, currency: "usd", polarProductId: null }] });

    const updated = await ok<{ plan: { name: string; prices: { amountCents: number }[] } }>(writer, "plan_update", { key: "team", name: "Teams" });
    expect(updated.plan.name).toBe("Teams");
    expect(updated.plan.prices[0].amountCents).toBe(4900);

    expect((await call(writer, "plan_update", { key: "team" })).structuredContent).toMatchObject({ error: "invalid" });

    await ok(admin, "plan_delete", { key: "team" });
    const audit = await ok<{ items: { id: string; action: string }[] }>(reader, "audit_list", { entity: "plan", entityId: "team" });
    expect((await ok<{ live: boolean }>(admin, "audit_restore", { id: audit.items.find((e) => e.action === "plan.delete")!.id })).live).toBe(true);
    expect((await ok<{ name: string }>(reader, "plan_get", { key: "team" })).name).toBe("Teams");
  });

  it("a write key edits copy but not what customers are charged", async () => {
    const forbidden = { error: "forbidden" };
    const price = { interval: "month", amountCents: 4900, currency: "usd", polarProductId: "prod_team" };
    expect((await call(writer, "plan_upsert", { key: "team", name: "Team", prices: [price] })).structuredContent).toMatchObject(forbidden);
    await ok(admin, "plan_upsert", { key: "team", name: "Team", prices: [price] });

    // Copy, features and visibility are a write key's; the same prices sent back are not a change.
    await ok(writer, "plan_update", { key: "team", features: ["Five seats"], active: false, prices: [price] });
    await ok(writer, "plan_upsert", { key: "team", name: "Team", prices: [price], highlighted: true });

    // Remapping the Polar product, the amount, the trial, dropping the prices, or deleting: admin only.
    for (const change of [
      { prices: [{ ...price, polarProductId: "prod_cheap" }] },
      { prices: [{ ...price, amountCents: 100 }] },
      { prices: [] },
      { trialDays: 30 },
    ]) {
      const refused = await call(writer, "plan_update", { key: "team", ...change });
      expect(refused.structuredContent, JSON.stringify(change)).toMatchObject(forbidden);
    }
    expect((await call(writer, "plan_upsert", { key: "team", name: "Team" })).structuredContent).toMatchObject(forbidden);
    expect((await call(writer, "plan_delete", { key: "team" })).structuredContent).toMatchObject(forbidden);
    expect((await ok<{ prices: { polarProductId: string }[]; trialDays: null }>(reader, "plan_get", { key: "team" }))).toMatchObject({
      prices: [{ polarProductId: "prod_team", amountCents: 4900 }],
      trialDays: null,
    });

    // An undo that would put old prices back is held to the same rule.
    // (Entries are found by what they hold: several can share a millisecond, so list order alone is not enough.)
    type PlanEntry = { id: string; action: string; after: { name: string; prices: { polarProductId: string }[] } | null };
    const planAudit = async () => (await ok<{ items: PlanEntry[] }>(reader, "audit_list", { entity: "plan", entityId: "team", includeValues: true, limit: 200 })).items;
    await ok(admin, "plan_update", { key: "team", prices: [{ ...price, polarProductId: "prod_team_v2" }] });
    const remap = (await planAudit()).find((e) => e.after?.prices[0]?.polarProductId === "prod_team_v2")!;
    expect((await call(writer, "audit_restore", { id: remap.id })).structuredContent).toMatchObject(forbidden);
    await ok(admin, "audit_restore", { id: remap.id });
    expect((await ok<{ prices: { polarProductId: string }[] }>(reader, "plan_get", { key: "team" })).prices[0].polarProductId).toBe("prod_team");

    // The writer's own copy edits stay undoable by the writer.
    await ok(writer, "plan_update", { key: "team", name: "Teams" });
    const rename = (await planAudit()).find((e) => e.action === "plan.update" && e.after?.name === "Teams")!;
    await ok(writer, "audit_restore", { id: rename.id });
    expect((await ok<{ name: string }>(reader, "plan_get", { key: "team" })).name).toBe("Team");
  });
});

describe("feedback", () => {
  it("lists and triages", async () => {
    const item = await store.feedback.create({ kind: "bug", message: "The button is broken", email: "a@example.com" });
    const list = await ok<{ items: { id: string }[] }>(reader, "feedback_list", { status: "new" });
    expect(list.items.map((i) => i.id)).toContain(item.id);
    const triaged = await ok<{ status: string; adminNote: string }>(writer, "feedback_update", { id: item.id, status: "planned", adminNote: "Next sprint" });
    expect(triaged).toMatchObject({ status: "planned", adminNote: "Next sprint" });
    expect((await call(writer, "feedback_update", { id: item.id })).structuredContent).toMatchObject({ error: "invalid" });
  });
});

describe("personal data", () => {
  it("only an admin key sees feedback senders' emails and names", async () => {
    await store.feedback.create({ kind: "contact", message: "Call me back", email: "sender@example.com", name: "Sam Sender" });
    for (const ctx of [reader, writer]) {
      const list = await ok<{ items: Record<string, unknown>[] }>(ctx, "feedback_list");
      expect(JSON.stringify(list)).not.toContain("sender@example.com");
      expect(JSON.stringify(list)).not.toContain("Sam Sender");
      expect(list.items[0]).toMatchObject({ hasEmail: true, hasName: true, message: "Call me back" });
    }
    const full = await ok<{ items: { email: string; name: string }[] }>(admin, "feedback_list");
    expect(full.items[0]).toMatchObject({ email: "sender@example.com", name: "Sam Sender" });
  });

  it("a read key can't get an email through the audit log", async () => {
    const { recordAudit } = await import("@/server/services/audit");
    const person = { type: "user" as const, id: "u_owner", label: "owner@example.com" };
    await recordAudit(person, "user.delete", "user", "u_gone", { id: "u_gone", email: "gone@example.com", name: "Gone" }, null);
    await recordAudit(person, "content.update", "content", "hero", { title: "Old" }, { title: "New" });
    const webhook = { type: "system" as const, id: null, label: "webhook:polar" };
    await recordAudit(webhook, "billing.customer_link", "billing_customer", "u_paying", null, { provider: "polar", customerId: "cus_polar_123" });
    await recordAudit(webhook, "something.happened", "something_new", "x1", null, { secret: "cus_polar_123" });
    await store.subscribers.add("listed@example.com", "footer");
    await ok(admin, "subscriber_unsubscribe", { email: "listed@example.com" });

    for (const ctx of [reader, writer]) {
      const all = await ok<{ items: { entity: string; actor: string; valuesWithheld?: string }[] }>(ctx, "audit_list", { includeValues: true, limit: 200 });
      const text = JSON.stringify(all);
      for (const email of ["gone@example.com", "listed@example.com", "owner@example.com"]) expect(text).not.toContain(email);
      expect(all.items.find((e) => e.entity === "user")).toMatchObject({ actor: "user:u_owner", valuesWithheld: expect.any(String) });
      expect(all.items.find((e) => e.entity === "subscriber")?.valuesWithheld).toBeTruthy();
      // Billing links (a user id against a Polar customer id) are withheld too, as is any entity not listed as safe.
      expect(all.items.find((e) => e.entity === "billing_customer")?.valuesWithheld).toBeTruthy();
      expect(all.items.find((e) => e.entity === "something_new")?.valuesWithheld).toBeTruthy();
      expect(text).not.toContain("cus_polar_123");
      // Content values are not personal data and still come through.
      expect(all.items.find((e) => e.entity === "content")).toMatchObject({ actor: "user:u_owner", after: { title: "New" } });
      expect(JSON.stringify(await ok(ctx, "site_overview"))).not.toContain("owner@example.com");
    }

    const full = JSON.stringify(await ok(admin, "audit_list", { includeValues: true, limit: 200 }));
    for (const email of ["gone@example.com", "listed@example.com", "owner@example.com", "cus_polar_123"]) expect(full).toContain(email);
  });
});

describe("admin tools", () => {
  it("guards the last admin and the calling key", async () => {
    const identity = { provider: "better-auth" as const, providerUserId: "p1", email: "owner@example.com", name: "Owner", image: null, emailVerified: true };
    const owner = await store.users.upsertFromIdentity(identity, { makeAdmin: true });
    const users = await ok<{ items: { id: string }[] }>(admin, "users_list");
    expect(users.items.map((u) => u.id)).toContain(owner.id);
    expect((await ok<{ user: { email: string } }>(admin, "user_get", { idOrEmail: "owner@example.com" })).user.email).toBe("owner@example.com");
    expect((await call(admin, "user_set_role", { id: owner.id, role: "user" })).structuredContent).toMatchObject({ error: "forbidden" });

    const keys = await ok<{ items: { id: string; you: boolean }[] }>(admin, "agent_keys_list");
    const mine = keys.items.find((k) => k.you)!;
    expect(mine.id).toBe(admin.key.id);
    expect((await call(admin, "agent_key_revoke", { id: admin.key.id })).structuredContent).toMatchObject({ error: "forbidden" });

    expect(await authenticateMcp(rawKeys.get(reader.key.id)!)).not.toBeNull();
    await ok(admin, "agent_key_revoke", { id: reader.key.id });
    expect(await authenticateMcp(rawKeys.get(reader.key.id)!)).toBeNull();
    const after = await ok<{ items: { id: string; active: boolean }[] }>(admin, "agent_keys_list");
    expect(after.items.find((k) => k.id === reader.key.id)?.active).toBe(false);
  });

  it("manages the email list", async () => {
    await store.subscribers.add("reader@example.com", "footer");
    const subs = await ok<{ items: { email: string }[] }>(admin, "subscribers_list");
    expect(subs.items.map((s) => s.email)).toContain("reader@example.com");
    expect((await ok<{ status: string }>(admin, "subscriber_unsubscribe", { email: "Reader@Example.com" })).status).toBe("unsubscribed");
    expect((await call(admin, "subscriber_unsubscribe", { email: "nobody@example.com" })).structuredContent).toMatchObject({ error: "not_found" });
  });

  it("site_overview and guide orient the agent", async () => {
    const overview = await ok<{ stack: { auth: string }; stats: object }>(reader, "site_overview");
    expect(overview.stack.auth).toBe("better-auth");
    const guide = await ok<{ content: { keys: { key: string; schema: object }[] }; plans: object; yourKey: { scope: string } }>(reader, "guide");
    expect(guide.content.keys.map((k) => k.key)).toContain("hero");
    expect(guide.yourKey.scope).toBe("read");
    expect(JSON.stringify(guide).toLowerCase()).not.toContain("stripe");
    const part = await ok<Record<string, unknown>>(reader, "guide", { topic: "plans" });
    expect(part).toHaveProperty("plans");
    expect(part).not.toHaveProperty("content");
  });
});

describe("authentication", () => {
  const DEV = "osk_dev_local_only_key_for_testing_0000000000000000";

  it("unknown and malformed keys open nothing", async () => {
    expect(await authenticateMcp(null)).toBeNull();
    expect(await authenticateMcp(`osk_${"x".repeat(43)}`)).toBeNull();
    expect(await authenticateMcp("not-a-key")).toBeNull();
    expect(await authenticateMcp("x".repeat(500))).toBeNull();
  });

  it("MCP_DEV_KEY works only in the local demo, outside production", async () => {
    vi.stubEnv("MCP_DEV_KEY", DEV);
    vi.stubEnv("DATABASE_URL", "");
    const dev = await authenticateMcp(DEV);
    expect(dev?.key).toMatchObject({ id: DEV_KEY_ID, scope: "admin" });
    expect(await authenticateMcp(DEV.slice(0, -1) + "1")).toBeNull();

    vi.stubEnv("NODE_ENV", "production");
    expect(await authenticateMcp(DEV)).toBeNull();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/app");
    expect(await authenticateMcp(DEV)).toBeNull();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("MCP_DEV_KEY", "short");
    expect(await authenticateMcp("short")).toBeNull();
  });

  it("allows no Origin, the site's origin and listed origins only", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com/");
    expect(originAllowed(null)).toBe(true);
    expect(originAllowed("https://app.example.com")).toBe(true);
    expect(originAllowed("https://evil.example")).toBe(false);
    expect(originAllowed("null")).toBe(false);
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "http://localhost:6274, https://inspector.example.com/");
    expect(originAllowed("http://localhost:6274")).toBe(true);
    expect(originAllowed("https://inspector.example.com")).toBe(true);
  });

  it("blocks an IP after 20 failed keys a minute, and only that IP", () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 20; i++) expect(noteAuthFailure(ip)).toBe(0);
    expect(authBlockedFor(ip)).toBe(0);
    const blocked = noteAuthFailure(ip);
    expect(blocked).toBeGreaterThan(0);
    expect(authBlockedFor(ip)).toBeGreaterThan(0);
    expect(authBlockedFor("198.51.100.8")).toBe(0);
    // Once the block's time has passed the IP may try again.
    expect(authBlockedFor(ip, Date.now() + blocked * 1000 + 1)).toBe(0);
  });
});
