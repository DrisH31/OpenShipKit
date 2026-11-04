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
const DIRS = ["src/app", "src/components", "src/server/services", "src/server/mcp", "src/content", "src/lib"];

/**
 * Text that is about one provider on purpose: file, the exact text (a substring of the string or JSX
 * text it sits in), and why. Never a whole file, so a new hard-coded name anywhere still fails.
 */
const FIELD = "each provider's own price-id field in the plan editor, named for that provider";
const SETUP = "the owner's Polar setup steps (the default provider), shown while billing is off";
const SHOWCASE = "the showcase's own copy says which providers the kit supports";
const SIBLING = "describes the sibling project's hosted stack";
const POSTS = "the kit's own seed posts (its launch notes and guides), about the default provider";
const LEGAL = "legal page templates written for Polar as merchant of record, with notes for the others";
const ALLOWED: { file: string; text: string; why: string; /** The whole string it anchors (a post that names providers throughout). */ whole?: true }[] = [
  { file: "src/components/admin/plan-editor-config.ts", text: "From Polar → Products", why: FIELD },
  { file: "src/components/admin/plan-editor-config.ts", text: "the Stripe price’s id", why: FIELD },
  { file: "src/components/admin/plan-editor-config.ts", text: "the Razorpay plan’s id", why: FIELD },
  { file: "src/components/admin/plan-editor-config.ts", text: "The Polar product must use seat-based pricing", why: FIELD },
  { file: "src/components/admin/plan-editor-config.ts", text: '"Polar product id"', why: FIELD },
  { file: "src/components/admin/plan-editor-config.ts", text: '"Stripe price id"', why: FIELD },
  { file: "src/components/admin/plan-editor-config.ts", text: '"Razorpay plan id"', why: FIELD },
  { file: "src/components/billing/format.ts", text: "Create a Polar organisation", why: SETUP },
  { file: "src/components/billing/format.ts", text: "In Polar, add a webhook endpoint", why: SETUP },
  { file: "src/components/billing/format.ts", text: "Polar product id into /admin/plans", why: SETUP },
  { file: "src/components/billing/format.ts", text: "(Polar, Stripe or Razorpay: see .env.example", why: "the developer message lists every provider" },
  { file: "src/components/billing/billing-off-notice.tsx", text: "These are the steps for Polar, the default", why: SETUP, whole: true },
  { file: "src/components/sections/own-stack.tsx", text: '"Polar"', why: SHOWCASE },
  { file: "src/components/site/site-footer.tsx", text: "Polar for payments", why: SIBLING },
  { file: "src/content/defaults.ts", text: "Polar, Stripe or Razorpay", why: SHOWCASE },
  { file: "src/content/defaults.ts", text: "Polar for payments", why: SIBLING },
  { file: "src/content/seed-posts.ts", text: "OpenShipKit is a free, MIT-licensed starter", why: POSTS, whole: true },
  { file: "src/content/seed-posts.ts", text: "OpenShipKit 1.0 is a self-hosted, ground-up rewrite", why: POSTS, whole: true },
  { file: "src/content/seed-posts.ts", text: "OpenShipKit 1.1 takes the kit", why: "the kit's 1.1 release notes name the providers it added", whole: true },
  { file: "src/content/seed-posts.ts", text: "Teams, Stripe and Razorpay beside Polar", why: "the 1.1 release notes' description", whole: true },
  { file: "src/content/defaults.ts", text: "OpenShipKit 1.1 is out: teams, Stripe and Razorpay", why: SHOWCASE },
  { file: "src/content/seed-posts.ts", text: "optional Polar billing", why: POSTS },
  { file: "src/content/seed-posts.ts", text: "our payment provider Polar collects", why: LEGAL, whole: true },
  { file: "src/content/seed-posts.ts", text: "Purchases are processed by Polar", why: LEGAL, whole: true },
];

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

type Hit = { file: string; line: number; raw: string };

/** Each string, template or JSX text naming a provider (the parsed file: comments are never nodes). */
function hits(path: string): Hit[] {
  const text = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Hit[] = [];
  const visit = (node: ts.Node) => {
    if (TEXT.has(node.kind)) {
      const raw = node.getText(file);
      const i = raw.search(NAME);
      if (i >= 0) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file) + i);
        out.push({ file: relative(ROOT, path), line: line + 1, raw });
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
      .flatMap(hits)
      // The allowed text is removed before looking again: a second, hard-coded name elsewhere in the
      // same string still fails.
      .filter((h) => !ALLOWED.some((a) => h.file === a.file && h.raw.includes(a.text) && (a.whole || !NAME.test(h.raw.split(a.text).join("")))))
      .map((h) => `${h.file}:${h.line}: ${h.raw.slice(0, 120)}`);
    expect(found).toEqual([]);
  });

  it("every allowlisted text still exists (a stale entry would hide nothing and mislead)", () => {
    for (const a of ALLOWED) expect(hits(join(ROOT, a.file)).some((h) => h.raw.includes(a.text)), `${a.file}: ${a.text}`).toBe(true);
  });

  it("reads strings and JSX text, never comments, and isn't fooled by a /* inside a string", () => {
    const tmp = join(ROOT, "node_modules", ".provider-copy-probe.tsx");
    writeFileSync(tmp, `// Polar in a comment\nconst a = <input accept="image/*" />;\nconst b = "Stripe";\n`);
    try {
      expect(hits(tmp).map((h) => h.raw)).toEqual(['"Stripe"']);
    } finally {
      unlinkSync(tmp);
    }
  });
});
