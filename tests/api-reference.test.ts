//
// docs/api.md is generated (src/server/api-reference.ts): this fails when it
// is out of date, and `npm run docs:api` (WRITE_API_DOCS=1) rewrites it. It
// also fails on a route handler the reference doesn't list, or an entry whose
// route is gone, so a new endpoint can't ship undocumented.
//

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/data", () => ({ getData: async () => ({}) }));
const { ENDPOINTS, renderApiReference } = await import("@/server/api-reference");
const { TOOLS } = await import("@/server/mcp/tools");

const ROOT = resolve(__dirname, "..");
const DOC = join(ROOT, "docs/api.md");

function routes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (name === "route.ts") out.push(relative(ROOT, p));
  }
  return out;
}

describe("the API reference", () => {
  it("lists every route handler, and nothing that's gone", () => {
    expect(ENDPOINTS.map((e) => e.file).sort()).toEqual(routes(join(ROOT, "src/app")).sort());
  });

  it("each endpoint's methods are exactly the handler's exported ones", () => {
    for (const e of ENDPOINTS) {
      const src = readFileSync(join(ROOT, e.file), "utf8");
      const exported = [...src.matchAll(/export (?:async )?(?:function|const) (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b|export \{([^}]*)\} from/g)]
        .flatMap((m) => (m[1] ? [m[1]] : m[2].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!)))
        .filter((n) => /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(n));
      // A listed HEAD may be Next's own, derived from GET; every other method must be exported, and only those.
      const listed = e.methods.filter((m) => m !== "HEAD" || exported.includes("HEAD"));
      expect([...new Set(exported)].sort(), e.file).toEqual([...listed].sort());
      if (e.methods.includes("HEAD")) expect(exported.includes("GET") || exported.includes("HEAD"), e.file).toBe(true);
    }
  });

  it("docs/api.md is what the code generates (npm run docs:api rewrites it)", () => {
    const next = renderApiReference();
    if (process.env.WRITE_API_DOCS) writeFileSync(DOC, next);
    expect(readFileSync(DOC, "utf8")).toBe(next);
  });

  it("documents every MCP tool with its fields, and a body's fields from its schema", () => {
    const doc = renderApiReference();
    for (const t of TOOLS) expect(doc, t.name).toContain(`### ${t.name}`);
    expect(doc).toMatch(/### POST \/api\/billing\/checkout[\s\S]*\| `planKey` \| string \| yes \|[\s\S]*\| `interval` \| "month" \\\| "year" \\\| "one_time" \| yes \|/);
  });
});
