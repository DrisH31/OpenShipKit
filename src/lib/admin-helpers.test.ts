//
// The small pure helpers the dashboard and admin lean on: CSV export escaping
// (formula injection), the audit diff, ServiceError → form state (with plain
// zod messages), audit entries in words, and the MCP config snippets.
//

import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/core/types";
import { plainIssue } from "./action-state";
import { attempt, failureFrom } from "@/server/attempt";
import { createMemoryStore } from "@/adapters/data/memory";
import { seedDatabase } from "@/server/seed";
import { actorWords, describeAudit, editedByPeople, isSeedEntry, userIdsWithoutEmail } from "./audit-words";
import { csvCell, csvRow } from "./csv";
import { diffJson, jsonEqual } from "./json-diff";
import { mcpEndpoint, mcpSnippets } from "./mcp-snippets";

describe("csv", () => {
  it("neutralises cells a spreadsheet would run as formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
  });
  it("quotes commas, quotes and newlines; leaves plain values alone", () => {
    expect(csvCell("a,b")).toBe(`"a,b"`);
    expect(csvCell("say \"hi\"")).toBe(`"say ""hi"""`);
    expect(csvCell("line\nbreak")).toBe(`"line\nbreak"`);
    expect(csvCell("ada@example.com")).toBe("ada@example.com");
    expect(csvCell(null)).toBe("");
    expect(csvRow(["a", 1, null])).toBe("a,1,\r\n");
  });
});

describe("json diff", () => {
  it("lists changed leaves by path", () => {
    const d = diffJson({ title: "A", items: [{ q: "x" }, { q: "y" }] }, { title: "B", items: [{ q: "x" }] });
    expect(d).toEqual([
      { path: "title", kind: "changed", before: "A", after: "B" },
      { path: "items.1", kind: "removed", before: { q: "y" } },
    ]);
  });
  it("treats null before as a create and null after as a delete", () => {
    expect(diffJson(null, { a: 1 })).toEqual([{ path: "", kind: "added", after: { a: 1 } }]);
    expect(diffJson({ a: 1 }, null)).toEqual([{ path: "", kind: "removed", before: { a: 1 } }]);
    expect(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
  });
});

describe("action state", () => {
  const serviceError = (message: string, details?: unknown) => Object.assign(new Error(message), { name: "ServiceError", code: "invalid", details });

  it("says zod's default messages in plain words", () => {
    expect(plainIssue("Too small: expected string to have >=3 characters")).toBe("Use at least 3 characters.");
    expect(plainIssue("Too big: expected string to have <=120 characters")).toBe("Use 120 characters or fewer.");
    expect(plainIssue("Invalid input: expected string, received undefined")).toBe("This is required.");
    expect(plainIssue("Use a path (/pricing)")).toBe("Use a path (/pricing)");
  });

  it("maps a ServiceError's issues to fields, with a summary that points at them", () => {
    const s = failureFrom(serviceError("title: …", [{ path: "title", message: "Too small: expected string to have >=1 characters" }]), "test");
    expect(s.ok).toBe(false);
    expect(s.message).toBe("Check the highlighted field.");
    expect(s.issues).toEqual([{ path: "title", message: "This can’t be empty." }]);
  });

  it("hides anything that isn't a ServiceError behind a generic sentence", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      const s = await attempt("test", async () => {
        throw new Error("connection refused at 10.0.0.3");
      });
      expect(s.ok).toBe(false);
      expect(s.message).not.toContain("10.0.0.3");
    } finally {
      console.error = quiet;
    }
  });

  it("passes data through on success", async () => {
    const s = await attempt("test", async () => ({ message: "ok", data: { key: "osk_x" } }));
    expect(s).toMatchObject({ ok: true, message: "ok", data: { key: "osk_x" } });
  });
});

describe("audit words", () => {
  const base: AuditEntry = {
    id: "a1",
    actor: { type: "agent", id: "k1", label: "agent:Claude on laptop" },
    action: "post.publish",
    entity: "post",
    entityId: "p1",
    before: { title: "Hello", kind: "post", status: "draft" },
    after: { title: "Hello", kind: "post", status: "published" },
    createdAt: "2026-10-06T10:00:00.000Z",
  };
  it("names the change, the thing and where it lives", () => {
    expect(describeAudit(base)).toEqual({ verb: "Published", target: "the post “Hello”", href: "/admin/posts/p1" });
    expect(actorWords(base)).toBe("Agent · Claude on laptop");
  });
  it("doesn't link to something that was deleted", () => {
    expect(describeAudit({ ...base, action: "post.delete", after: null }).href).toBeNull();
  });
  it("labels content sections by their registry label", () => {
    expect(describeAudit({ ...base, action: "content.update", entity: "content", entityId: "hero" }).target).toBe("“Hero”");
  });
  it("names media uploads and deletes by the file's path, linking to the library", () => {
    const item = { path: "2026/10/0123456789abcdef0123456789abcdef.png", url: "/uploads/2026/10/0123456789abcdef0123456789abcdef.png" };
    const media = { ...base, entity: "media", entityId: item.path };
    expect(describeAudit({ ...media, action: "media.upload", before: null, after: item })).toEqual({ verb: "Uploaded", target: `the image “${item.path}”`, href: "/admin/media" });
    expect(describeAudit({ ...media, action: "media.delete", before: item, after: null })).toMatchObject({ verb: "Deleted", target: `the image “${item.path}”` });
  });
  it("says whom a user change was about, from the entry or the page's lookup", () => {
    const user = { ...base, entity: "user", entityId: "u1" };
    const signUp = { ...user, actor: { type: "system" as const, id: null, label: "sign-in" }, action: "user.create", before: null, after: { email: "ana@x.test", role: "user" } };
    expect(describeAudit(signUp)).toEqual({ verb: "Account created for", target: "ana@x.test", href: "/admin/users/u1" });
    expect(actorWords(signUp)).toBe("Sign-up");
    expect(describeAudit({ ...user, action: "user.ban", before: { banned: false }, after: { banned: true } }).target).toBe("a user");
    expect(describeAudit({ ...user, action: "user.ban", before: { banned: false }, after: { banned: true } }, { u1: "ana@x.test" }).target).toBe("ana@x.test");
    expect(describeAudit({ ...user, action: "user.role", before: { role: "user" }, after: { role: "admin" } }, { u1: "ana@x.test" })).toMatchObject({ verb: "Made", target: "ana@x.test an admin" });
    expect(describeAudit({ ...user, action: "user.promote", before: { role: "user" }, after: { role: "admin" } }, { u1: "ana@x.test" }).target).toBe("ana@x.test an admin");
    expect(describeAudit({ ...user, action: "user.role", before: { email: "ana@x.test", role: "admin" }, after: { email: "ana@x.test", role: "user" } })).toMatchObject({ verb: "Took admin rights from", target: "ana@x.test" });
    const ban = (entityId: string) => ({ ...user, entityId, action: "user.ban", before: { banned: false }, after: { banned: true } });
    expect(userIdsWithoutEmail([ban("u2"), { ...signUp, entityId: "u3" }, ban("u2"), base])).toEqual(["u2"]);
  });
});

describe("setup checklist: plan edits", () => {
  it("doesn't count the seed's own rows as the owner setting their prices", async () => {
    // A first boot: an empty database, then the seed (the memory store comes pre-filled, so empty it first).
    const store = createMemoryStore({ fresh: true });
    for (const p of await store.plans.list()) await store.plans.delete(p.key);
    for (const p of (await store.posts.list({ limit: 100 })).items) await store.posts.delete(p.id);
    expect((await seedDatabase(store)).plans).toBeGreaterThan(0);
    const seeded = await store.audit.list({ entity: "plan", limit: 50 });
    expect(seeded.items.length).toBeGreaterThan(0);
    expect(seeded.items.every(isSeedEntry)).toBe(true);
    expect(editedByPeople(seeded.items)).toBe(false);

    const plan = seeded.items[0];
    await store.audit.record({ actor: { type: "user", id: "u1", label: "owner@x.test" }, action: "plan.update", entity: "plan", entityId: plan.entityId, before: plan.after, after: plan.after });
    expect(editedByPeople((await store.audit.list({ entity: "plan", limit: 50 })).items)).toBe(true);
  });
});

describe("mcp snippets", () => {
  it("builds the endpoint from the site URL and puts the key in each config", () => {
    expect(mcpEndpoint("https://app.test/")).toBe("https://app.test/api/mcp");
    const s = mcpSnippets("https://app.test", "osk_abc");
    expect(s.map((x) => x.id)).toEqual(["claude-code", "cursor", "json"]);
    for (const x of s) expect(x.code).toContain("osk_abc");
    expect(JSON.parse(s[1].code).mcpServers.openshipkit.url).toBe("https://app.test/api/mcp");
  });
});
