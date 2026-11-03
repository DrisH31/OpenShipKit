//
// Authorization is enforced, not remembered (ROADMAP 1.2).
//
// The proxy only checks that a cookie exists (invariant 5). The real check is
// a guard call at the top of every page, server action and route handler, and
// a guard someone forgot gives no error and no failing test: the page just
// works for whoever finds it. This test reads every such file with the
// TypeScript parser and FAILS CLOSED: what it can't analyse is a failure,
// never a pass.
//
// It fails when:
//  - an admin page or action (anything under app/admin or app/api/admin, route
//    groups ignored) doesn't call requireAdmin() before anything else;
//  - a dashboard page or action doesn't call requireUser() / requirePlan() /
//    requireAdmin() before anything else;
//  - a route handler isn't in ROUTES below, or one of its methods doesn't guard first;
//  - a "use server" file, or a "use server" function inside any file, sits
//    outside admin/ and dashboard/ without a PUBLIC_ACTIONS entry saying why;
//  - an export it must check is something it can't read: a re-export from
//    another file, `export *`, or a value that isn't a function defined here
//    (`export const POST = withAuth(…)`). Define the handler in the file instead.
//
// "Before anything else" is evaluation order: `privacyLens(await requireAdmin())`
// guards first. The calls allowed ahead of a guard are the pure request checks in
// SAFE_BEFORE_GUARD, and helpers from the same file or function that call only
// those. getCurrentUser() counts as a guard only when the same function then
// checks the result (for admin, its role).
//
// A new public route or action is allowed, but only on purpose: add it to
// ROUTES / PUBLIC_ACTIONS with the reason it needs no session.
//

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

type Guard = "admin" | "user" | "public";

/**
 * Every route handler, and what each of its exported methods must call.
 * `public` routes give the reason no session is needed.
 */
const ROUTES: Record<string, { guard: Guard; why?: string }> = {
  "src/app/admin/subscribers/export/route.ts": { guard: "admin" },
  "src/app/api/admin/media/route.ts": { guard: "admin" },
  "src/app/api/billing/checkout/route.ts": { guard: "user" },
  "src/app/api/billing/portal/route.ts": { guard: "user" },
  "src/app/api/billing/webhook/route.ts": { guard: "public", why: "Polar signs it; the billing adapter verifies the signature and re-fetches the object (invariant 4)" },
  "src/app/api/mcp/route.ts": { guard: "public", why: "an agent key, not a session: authenticateMcp() checks the bearer key and its scope" },
  "src/app/api/auth/[...auth]/route.ts": { guard: "public", why: "Better Auth's own endpoints: sign-in, callbacks, verification links" },
  "src/app/api/demo/route.ts": { guard: "public", why: "signs a visitor in as the read-only demo admin; off unless DEMO_ADMIN_EMAIL is set" },
  "src/app/api/forms/contact/route.ts": { guard: "public", why: "the public contact form: rate limited, Origin-checked" },
  "src/app/api/forms/newsletter/route.ts": { guard: "public", why: "the public newsletter form: rate limited, Origin-checked" },
  "src/app/api/health/route.ts": { guard: "public", why: "what uptime monitors read; says nothing about any person" },
  "src/app/api/indexnow/[key]/route.ts": { guard: "public", why: "the IndexNow key file search engines fetch" },
  "src/app/uploads/[...path]/route.ts": { guard: "public", why: "uploaded images are public media" },
  "src/app/llms.txt/route.ts": { guard: "public", why: "public site summary" },
  "src/app/llms-full.txt/route.ts": { guard: "public", why: "public posts, in full" },
  "src/app/(marketing)/blog/rss.xml/route.ts": { guard: "public", why: "public feed" },
  "src/app/(marketing)/blog/[slug]/og/route.ts": { guard: "public", why: "a published post's Open Graph image" },
  "src/app/(marketing)/changelog/rss.xml/route.ts": { guard: "public", why: "public feed" },
  "src/app/(marketing)/changelog/[slug]/og/route.ts": { guard: "public", why: "a published entry's Open Graph image" },
  "src/app/favicon.ico/route.tsx": { guard: "public", why: "the site's favicon" },
  "src/app/icon-maskable/[size]/route.tsx": { guard: "public", why: "the web app manifest's icon" },
};

/** "use server" code outside admin/ and dashboard/, and why it needs no app guard. */
const PUBLIC_ACTIONS: Record<string, string> = {
  "src/app/(marketing)/contact/actions.ts": "the public contact form, without JavaScript: rate limited",
  "src/adapters/auth/better-auth/actions.ts":
    "sign-in, sign-up and account security: Better Auth checks its own session, and the signed-out ones are rate limited",
};

/**
 * Pure checks that may run ahead of the guard: they read the request, compare
 * the Origin, or build a response, and write nothing. Add a name only if that's
 * true of it.
 */
const SAFE_BEFORE_GUARD = new Set([
  "requireSaasProfile", // 404s under the site profile
  "saasOnlyResponse",
  "isBillingEnabled",
  "isSameOrigin",
  "wantsJson",
  "json",
  "seeOther",
  "withParam",
  "readFields", // reads the form body, capped
  "safeParse",
]);

const ADMIN_GUARDS = new Set(["requireAdmin"]);
const USER_GUARDS = new Set(["requireUser", "requirePlan", "requireAdmin"]);
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(ROOT, path).split("\\").join("/");

/** Which guard a path needs: route groups like (marketing) don't count as segments. */
function areaOf(path: string): Exclude<Guard, "public"> | null {
  const segments = path.split("/").filter((s) => !/^\(.*\)$/.test(s));
  const at = segments.join("/");
  if (at.startsWith("src/app/admin/") || at.startsWith("src/app/api/admin/")) return "admin";
  if (at.startsWith("src/app/dashboard/")) return "user";
  return null;
}

function parse(file: string, source = readFileSync(file, "utf8")): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

type FnNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
const isFnNode = (n: ts.Node | undefined): n is FnNode => !!n && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n));

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/** Functions declared directly in a block or file, by name (declarations and `const f = () => …`). */
function functionsIn(statements: readonly ts.Statement[]): Map<string, FnNode> {
  const out = new Map<string, FnNode>();
  for (const s of statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) out.set(s.name.text, s);
    else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && isFnNode(d.initializer)) out.set(d.name.text, d.initializer);
    }
  }
  return out;
}

type Export = { name: string; fn?: FnNode; problem?: string };

/** Every value export of a file. Anything that isn't a function defined in this file comes back with a problem. */
function exportsOf(sf: ts.SourceFile): Export[] {
  const local = functionsIn(sf.statements);
  const out: Export[] = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      const name = hasModifier(s, ts.SyntaxKind.DefaultKeyword) ? "default" : (s.name?.text ?? "default");
      out.push(s.body ? { name, fn: s } : { name, problem: "has no body to check" });
    } else if (ts.isVariableStatement(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      for (const d of s.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText();
        out.push(isFnNode(d.initializer) ? { name, fn: d.initializer } : { name, problem: "isn't a function defined in this file" });
      }
    } else if (ts.isClassDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      out.push({ name: s.name?.text ?? "default", problem: "is a class" });
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      if (s.moduleSpecifier) {
        const from = (s.moduleSpecifier as ts.StringLiteral).text;
        if (!s.exportClause || !ts.isNamedExports(s.exportClause)) out.push({ name: "*", problem: `is re-exported from "${from}"` });
        else for (const e of s.exportClause.elements) if (!e.isTypeOnly) out.push({ name: e.name.text, problem: `is re-exported from "${from}"` });
      } else if (s.exportClause && ts.isNamedExports(s.exportClause)) {
        for (const e of s.exportClause.elements) {
          if (e.isTypeOnly) continue;
          const target = local.get((e.propertyName ?? e.name).text);
          out.push(target ? { name: e.name.text, fn: target } : { name: e.name.text, problem: "isn't a function defined in this file" });
        }
      }
    } else if (ts.isExportAssignment(s)) {
      const e = s.expression;
      const fn = isFnNode(e) ? e : ts.isIdentifier(e) ? local.get(e.text) : undefined;
      out.push(fn ? { name: "default", fn } : { name: "default", problem: "isn't a function defined in this file" });
    }
  }
  return out;
}

/** Names of the calls a function makes, in evaluation order (receiver and arguments before the call), not entering nested functions. */
function callsInOrder(body: ts.Node): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node) => {
    if (n !== body && isFnNode(n)) return; // a callback runs later, if ever
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isPropertyAccessExpression(e)) visit(e.expression);
      for (const a of n.arguments) visit(a);
      names.push(ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "(an expression)");
      return;
    }
    n.forEachChild(visit);
  };
  visit(body); // an expression body (`() => wipe()`) is itself a call
  return names;
}

/** Whether `getCurrentUser()`'s result is checked in this function: a null check, and for admin the role. */
function checksSession(fn: FnNode, guard: Exclude<Guard, "public">): boolean {
  const text = fn.body?.getText() ?? "";
  const m = /(?:const|let)\s+(\w+)\s*=\s*await\s+getCurrentUser\(/.exec(text);
  if (!m) return false;
  const v = m[1];
  const nullCheck = new RegExp(`!\\s*${v}\\b|\\b${v}\\s*[=!]==?\\s*null`).test(text);
  return guard === "admin" ? nullCheck && new RegExp(`\\b${v}\\.role\\s*!==\\s*"admin"`).test(text) : nullCheck;
}

type Scope = Map<string, FnNode>;

/** A call that can't write: on the safe list, or a local helper whose own calls are all safe. */
function isSafe(name: string, scope: Scope, seen: Set<FnNode>): boolean {
  if (SAFE_BEFORE_GUARD.has(name)) return true;
  const fn = scope.get(name);
  if (!fn || seen.has(fn) || !fn.body) return false;
  seen.add(fn);
  return callsInOrder(fn.body).every((n) => isSafe(n, scope, seen));
}

/** Null when `fn` guards before anything else; otherwise why not. */
function guardProblem(fn: FnNode, guard: Exclude<Guard, "public">, fileScope: Scope, seen = new Set<FnNode>()): string | null {
  if (!fn.body) return "has no body to check";
  if (seen.has(fn)) return "calls itself before any guard";
  seen.add(fn);
  const scope: Scope = new Map([...fileScope, ...(ts.isBlock(fn.body) ? functionsIn(fn.body.statements) : [])]);
  const guards = guard === "admin" ? ADMIN_GUARDS : USER_GUARDS;
  const want = guard === "admin" ? "requireAdmin()" : "requireUser()";
  for (const name of callsInOrder(fn.body)) {
    if (guards.has(name)) return null;
    if (name === "getCurrentUser") return checksSession(fn, guard) ? null : `reads the session with getCurrentUser() but doesn't check it${guard === "admin" ? " (and its role)" : ""}`;
    const helper = scope.get(name);
    if (helper && guardProblem(helper, guard, fileScope, seen) === null) return null;
    if (isSafe(name, scope, new Set())) continue;
    return `calls ${name}() before ${want}`;
  }
  return `doesn't call ${want}`;
}

const isUseServer = (block: { statements: ts.NodeArray<ts.Statement> } | undefined) => {
  const first = block?.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
};

/** Functions anywhere in the file whose body opens with "use server" (inline server actions). */
function inlineActions(sf: ts.SourceFile): { name: string; fn: FnNode }[] {
  const found: { name: string; fn: FnNode }[] = [];
  const visit = (n: ts.Node) => {
    if (isFnNode(n) && n.body && ts.isBlock(n.body) && isUseServer(n.body)) {
      const name = n.name?.getText() ?? (ts.isVariableDeclaration(n.parent) ? n.parent.name.getText() : "(an inline action)");
      found.push({ name, fn: n });
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return found;
}

/** The problems in one file, as sentences. */
function problemsIn(file: string, sf: ts.SourceFile): string[] {
  const path = rel(file);
  const base = path.split("/").pop()!;
  const area = areaOf(path);
  const fileScope = functionsIn(sf.statements);
  const problems: string[] = [];

  if (/^page\.tsx?$/.test(base) && area) {
    const page = exportsOf(sf).find((e) => e.name === "default");
    if (!page) problems.push(`${path}: no default-exported page to check`);
    else if (!page.fn) problems.push(`${path}: the page ${page.problem}, so its guard can't be checked`);
    else {
      const why = guardProblem(page.fn, area, fileScope);
      if (why) problems.push(`${path}: the page ${why}`);
    }
  }

  const useServerFile = isUseServer(sf);
  if (useServerFile) {
    if (area) {
      for (const e of exportsOf(sf)) {
        if (!e.fn) problems.push(`${path}: server action ${e.name} ${e.problem}, so its guard can't be checked`);
        else {
          const why = guardProblem(e.fn, area, fileScope);
          if (why) problems.push(`${path}: server action ${e.name}() ${why}`);
        }
      }
    } else if (!(path in PUBLIC_ACTIONS)) {
      problems.push(`${path}: a "use server" file outside admin/ and dashboard/: guard each action, or add it to PUBLIC_ACTIONS with the reason`);
    }
  }

  if (!useServerFile) {
    for (const action of inlineActions(sf)) {
      if (area) {
        const why = guardProblem(action.fn, area, fileScope);
        if (why) problems.push(`${path}: inline server action ${action.name}() ${why}`);
      } else if (!(path in PUBLIC_ACTIONS)) {
        problems.push(`${path}: inline server action ${action.name}() outside admin/ and dashboard/: guard it, or add the file to PUBLIC_ACTIONS with the reason`);
      }
    }
  }

  if (/^route\.tsx?$/.test(base) && path.startsWith("src/app/")) {
    const entry = ROUTES[path];
    if (!entry) problems.push(`${path}: a route handler not listed in ROUTES: say which guard it needs`);
    else if (entry.guard !== "public") {
      for (const e of exportsOf(sf)) {
        if (!HTTP_METHODS.has(e.name) && e.name !== "*") continue;
        if (!e.fn) problems.push(`${path}: ${e.name} ${e.problem}, so its guard can't be checked: define the handler in this file`);
        else {
          const why = guardProblem(e.fn, entry.guard, fileScope);
          if (why) problems.push(`${path}: ${e.name} ${why}`);
        }
      }
    }
  }
  return problems;
}

describe("authorization", () => {
  const files = walk(SRC);

  it("every admin and dashboard page, server action and route handler calls its guard first", () => {
    const problems = files.flatMap((file) => problemsIn(file, parse(file)));
    expect(problems).toEqual([]);
  });

  it("ROUTES and PUBLIC_ACTIONS name only files that exist, and every public entry says why", () => {
    const present = new Set(files.map(rel));
    for (const [path, entry] of Object.entries(ROUTES)) {
      expect(present.has(path), `${path} is listed in ROUTES but doesn't exist`).toBe(true);
      if (entry.guard === "public") expect(entry.why, `${path} is public without a reason`).toBeTruthy();
    }
    for (const path of Object.keys(PUBLIC_ACTIONS)) expect(present.has(path), `${path} doesn't exist`).toBe(true);
  });

  describe("catches the mistakes it exists for", () => {
    const check = (path: string, source: string) => problemsIn(join(ROOT, path), parse(join(ROOT, path), source));

    it("a missing guard, a wrong guard, and an unguarded arrow action", () => {
      expect(
        check(
          "src/app/admin/x/actions.ts",
          `"use server";
           export async function ok() { await requireAdmin(); }
           export async function forgot() { await doTheThing(); }`,
        ),
      ).toEqual(["src/app/admin/x/actions.ts: server action forgot() calls doTheThing() before requireAdmin()"]);
      expect(check("src/app/admin/x/page.tsx", `export default async function Page() { await requireUser(); }`)).toEqual([
        "src/app/admin/x/page.tsx: the page calls requireUser() before requireAdmin()",
      ]);
      expect(check("src/app/dashboard/x/actions.ts", `"use server"; export const save = async () => { await write(); };`)).toHaveLength(1);
    });

    it("a guard after the write, or in a callback that may never run", () => {
      expect(check("src/app/admin/x/actions.ts", `"use server"; export async function a() { deleteAll(); await requireAdmin(); }`)).toEqual([
        "src/app/admin/x/actions.ts: server action a() calls deleteAll() before requireAdmin()",
      ]);
      expect(check("src/app/admin/x/actions.ts", `"use server"; export async function a() { const later = async () => requireAdmin(); await wipe(); }`)).toHaveLength(1);
      // Evaluation order: the guard inside the argument runs first.
      expect(check("src/app/admin/x/page.tsx", `export default async function Page() { const lens = privacyLens(await requireAdmin()); }`)).toEqual([]);
    });

    it("a same-file helper that guards counts; one that doesn't, and a safe-looking one that writes, don't", () => {
      expect(
        check(
          "src/app/dashboard/x/actions.ts",
          `"use server";
           async function via() { await requireUser(); }
           async function plain() { await write(); }
           export async function ok() { return via(); }
           export async function forgot() { return plain(); }`,
        ),
      ).toEqual(["src/app/dashboard/x/actions.ts: server action forgot() calls plain() before requireUser()"]);
      // A local closure that only builds a response may run first; one that writes may not.
      expect(check("src/app/api/admin/media/route.ts", `export async function POST() { const fail = () => json(1); if (x) return fail(); await requireAdmin(); }`)).toEqual([]);
      expect(check("src/app/api/admin/media/route.ts", `export async function POST() { const fail = () => wipe(); fail(); await requireAdmin(); }`)).toHaveLength(1);
    });

    it("exports it can't read fail instead of passing", () => {
      expect(check("src/app/api/admin/media/route.ts", `export { POST } from "@/modules/x/route";`)).toEqual([
        'src/app/api/admin/media/route.ts: POST is re-exported from "@/modules/x/route", so its guard can\'t be checked: define the handler in this file',
      ]);
      expect(check("src/app/api/admin/media/route.ts", `export * from "@/modules/x/route";`)).toHaveLength(1);
      expect(check("src/app/api/admin/media/route.ts", `export const POST = withX(async () => {});`)).toHaveLength(1);
      expect(check("src/app/admin/x/actions.ts", `"use server"; async function nuke() { await wipe(); } export { nuke };`)).toEqual([
        "src/app/admin/x/actions.ts: server action nuke() calls wipe() before requireAdmin()",
      ]);
      expect(check("src/app/admin/x/actions.ts", `"use server"; export { nuke } from "./elsewhere";`)).toHaveLength(1);
      // Non-method exports of a route (runtime, dynamic) are fine.
      expect(check("src/app/api/admin/media/route.ts", `export const runtime = "nodejs"; export async function POST() { await requireAdmin(); }`)).toEqual([]);
    });

    it("getCurrentUser() only counts with its result checked (and the role, for admin)", () => {
      expect(check("src/app/api/admin/media/route.ts", `export async function POST() { const u = await getCurrentUser(); }`)).toHaveLength(1);
      expect(check("src/app/api/admin/media/route.ts", `export async function POST() { const u = await getCurrentUser(); if (!u) return 1; }`)).toHaveLength(1);
      expect(check("src/app/api/admin/media/route.ts", `export async function POST() { const u = await getCurrentUser(); if (!u || u.role !== "admin") return 1; }`)).toEqual([]);
      expect(check("src/app/api/billing/portal/route.ts", `export async function POST() { const u = await getCurrentUser(); return go(u); }`)).toHaveLength(1);
      expect(check("src/app/api/billing/portal/route.ts", `export async function POST() { const u = await getCurrentUser(); if (!u) return no(); }`)).toEqual([]);
    });

    it("route groups, inline server actions, and unclassified routes and action files", () => {
      expect(check("src/app/(shop)/admin/x/page.tsx", `export default async function Page() { return null; }`)).toHaveLength(1);
      expect(
        check("src/app/admin/x/page.tsx", `export default async function Page() { await requireAdmin(); async function save() { "use server"; await wipe(); } }`),
      ).toEqual(["src/app/admin/x/page.tsx: inline server action save() calls wipe() before requireAdmin()"]);
      expect(check("src/app/(marketing)/x/page.tsx", `export default function P() { async function go() { "use server"; await wipe(); } }`)).toHaveLength(1);
      expect(check("src/app/api/new/route.ts", `export async function GET() {}`)).toEqual([
        "src/app/api/new/route.ts: a route handler not listed in ROUTES: say which guard it needs",
      ]);
      expect(check("src/app/(marketing)/x/actions.ts", `"use server"; export async function a() {}`)).toHaveLength(1);
      expect(check("src/lib/x.ts", `"use server"; export async function a() {}`)).toHaveLength(1);
    });
  });
});
