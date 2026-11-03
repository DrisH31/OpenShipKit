//
// What people and agents read must name the billing provider in use, not one
// written into the code: a Stripe or Razorpay customer was told "Payments are
// handled by Polar" and sent to a Manage billing button Razorpay doesn't have,
// and the admin overview said payments were off while Stripe was live (Phase 3
// review). Copy takes the name from PROVIDER_LABEL / the provider's `label`,
// and the portal from `hasPortal`.
//
// This reads every string, template and JSX text in the app, the components,
// the services and the MCP tools (parsed with TypeScript, so comments never
// count) and fails on a provider name, except where the text is about that
// one provider on purpose (ALLOWED, each with its reason).
//

import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const DIRS = ["src/app", "src/components", "src/server/services", "src/server/mcp"];

/** file → why naming a provider there is right. Matched as a path prefix. */
const ALLOWED: Record<string, string> = {
  "src/components/admin/plan-editor-config.ts": "each provider's own price-id field is labelled with its name",
  "src/components/billing/format.ts": "billingSetupSteps: the owner's Polar setup, the default provider's own steps",
  "src/components/billing/billing-off-notice.tsx": "the owner's notice introduces those Polar steps and names the alternatives",
  "src/components/sections/": "the OpenShipKit showcase copy says which providers the kit supports",
  "src/components/site/": "the showcase header and footer credits",
  "src/server/mcp/tools/plans.ts": "the per-provider price-id fields an agent edits",
  "src/server/mcp/tools/shared.ts": "the per-provider price-id fields an agent edits",
  "src/server/mcp/tools/site.ts": "the guide tool documents every provider's price-id field",
};

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const NAME = /\b(Polar|Stripe|Razorpay)\b/;
const TEXT = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText]);

/** "file:line: text" for each string, template or JSX text naming a provider (the parsed file: comments are never nodes). */
function hits(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (TEXT.has(node.kind)) {
      const raw = node.getText(file);
      const i = raw.search(NAME);
      if (i >= 0) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file) + i);
        out.push(`${relative(ROOT, path)}:${line + 1}: ${text.split("\n")[line].trim().slice(0, 120)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

describe("provider names in copy", () => {
  it("come from the provider in use, outside the files about one provider on purpose", () => {
    const found = DIRS.flatMap((d) => files(join(ROOT, d)))
      .filter((p) => !Object.keys(ALLOWED).some((a) => relative(ROOT, p).startsWith(a)))
      .flatMap(hits);
    expect(found).toEqual([]);
  });

  it("reads strings and JSX text, never comments, and isn't fooled by a /* inside a string", () => {
    const tmp = join(ROOT, "node_modules", ".provider-copy-probe.tsx");
    writeFileSync(tmp, `// Polar in a comment\nconst a = <input accept="image/*" />;\nconst b = "Stripe";\n`);
    try {
      expect(hits(tmp).map((h) => h.split(": ").slice(1).join(": "))).toEqual(['const b = "Stripe";']);
    } finally {
      unlinkSync(tmp);
    }
  });
});
