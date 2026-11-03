//
// Authorization is enforced, not remembered (ROADMAP 1.2).
//
// The proxy only checks that a cookie exists (invariant 5). The real check is
// a guard call at the top of every page, server action and route handler, and
// a guard someone forgot gives no error and no failing test: the page just
// works for whoever finds it. This test reads every such file with the
// TypeScript parser and FAILS CLOSED: what it can't analyse is a failure,
// never a pass. It is a static check of the shapes below, not a proof: its
// self-tests include every way round it that review has found, and a new way
// round belongs there before the fix.
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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
  "src/app/api/health/live/route.ts": { guard: "public", why: "liveness: answers without touching the database" },
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

type Export = { name: string; fn?: FnNode; scope?: Scope; problem?: string };
type Scope = Map<string, FnNode>;

/**
 * The file a relative or "@/" import names, if it is in this repository: a module's
 * route handler (modules/README.md mounts one with `export { POST } from "…/modules/…"`).
 */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? join(dirname(fromFile), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every value export of a file. A function defined here is analysed here; a
 * re-export from another file in the repository is followed once and that
 * file's function is analysed with that file's helpers. Anything else comes
 * back with a problem: it fails, it never passes unread.
 */
function exportsOf(sf: ts.SourceFile, follow = true): Export[] {
  const local = functionsIn(sf.statements);
  const out: Export[] = [];
  const reexport = (name: string, imported: string, from: string): Export => {
    const target = follow ? resolveImport(sf.fileName, from) : null;
    if (!target) return { name, problem: `is re-exported from "${from}", which can't be read` };
    const tsf = parse(target);
    const hit = exportsOf(tsf, false).find((e) => e.name === imported);
    return hit?.fn ? { name, fn: hit.fn, scope: functionsIn(tsf.statements) } : { name, problem: `is re-exported from "${from}", where ${imported} isn't a function defined in that file` };
  };
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
        if (!s.exportClause || !ts.isNamedExports(s.exportClause)) out.push({ name: "*", problem: `is every export of "${from}", which can't be checked one by one` });
        else for (const e of s.exportClause.elements) if (!e.isTypeOnly) out.push(reexport(e.name.text, (e.propertyName ?? e.name).text, from));
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

type Call = { name: string; node: ts.CallExpression | ts.NewExpression };

/** The calls under `root`, in evaluation order (receiver and arguments before the call), not entering nested functions. */
function callsInOrder(root: ts.Node): Call[] {
  const calls: Call[] = [];
  const visit = (n: ts.Node) => {
    if (n !== root && isFnNode(n)) return; // a callback runs later, if ever
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isPropertyAccessExpression(e)) visit(e.expression);
      for (const a of n.arguments) visit(a);
      calls.push({ name: ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "(an expression)", node: n });
      return;
    }
    if (ts.isNewExpression(n)) {
      // `new Wiper()` runs a constructor: it is a call like any other.
      for (const a of n.arguments ?? []) visit(a);
      calls.push({ name: `new ${n.expression.getText()}`, node: n });
      return;
    }
    n.forEachChild(visit);
  };
  visit(root);
  return calls;
}

/**
 * How a guard call sits in its statement. It counts only when nothing between
 * the call and the statement can skip it or swallow its result: await,
 * parentheses, a declaration, `return`, or an argument of another call
 * (`privacyLens(await requireAdmin())`). Not `a || guard()`, `f ? x : guard()`
 * or `x ?? guard()`. Unawaited, its refusal is never seen.
 */
function guardPlacement(call: ts.CallExpression, statement: ts.Node, fn: FnNode): "ok" | "conditional" | "unawaited" {
  let awaited = false;
  let n: ts.Node = call;
  while (n !== statement && n !== fn) {
    const parent: ts.Node = n.parent;
    if (ts.isAwaitExpression(parent)) awaited = true;
    else if (ts.isReturnStatement(parent) || parent === fn) awaited = true; // returned: the caller awaits it
    else if (ts.isCallExpression(parent)) {
      if (parent.expression === n || parent.questionDotToken) return "conditional";
      if (!awaited) return "unawaited"; // an argument that isn't awaited is a floating promise
    } else if (!(ts.isParenthesizedExpression(parent) || ts.isVariableDeclaration(parent) || ts.isVariableDeclarationList(parent) || ts.isExpressionStatement(parent) || ts.isVariableStatement(parent))) {
      return "conditional";
    }
    n = parent;
  }
  return awaited ? "ok" : "unawaited";
}

/** A statement that leaves the function: `return …`, `throw …`, or a block ending in one. */
function exits(node: ts.Statement): boolean {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
  if (ts.isBlock(node)) {
    const last = node.statements[node.statements.length - 1];
    return !!last && exits(last);
  }
  return false;
}

/** The top-level `||` branches of a condition, parentheses stripped: `!u || u.role !== "admin"` → two. */
function disjuncts(e: ts.Expression): string[] {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) return [...disjuncts(e.left), ...disjuncts(e.right)];
  return [e.getText().replace(/\s+/g, " ").trim()];
}

/**
 * After a session read, the statements up to its refusal: only pure checks
 * (SAFE_BEFORE_GUARD, or local helpers that call nothing else) may run until
 * an `if` that leaves the function has refused a missing user. For admin,
 * also a role other than admin; for apiUser(), `instanceof Response`. A
 * branch counts only as the whole condition or one of its `||` parts:
 * `!u && f` refuses nothing when f is false. Null when it holds, else why not.
 */
function sessionRefusalProblem(
  name: "getCurrentUser" | "apiUser",
  v: string,
  after: readonly ts.Statement[],
  guard: Exclude<Guard, "public">,
  scope: Scope,
): string | null {
  if (name === "apiUser" && guard !== "user") return "reads the session with apiUser(), which checks sign-in but not the admin role";
  const needs = new Set(name === "apiUser" ? ["response"] : guard === "admin" ? ["missing", "role"] : ["missing"]);
  for (const st of after) {
    if (ts.isIfStatement(st) && exits(st.thenStatement)) {
      for (const d of disjuncts(st.expression)) {
        if (name === "apiUser" && d === `${v} instanceof Response`) needs.delete("response");
        if (name === "getCurrentUser" && (d === `!${v}` || d === `${v} == null` || d === `${v} === null`)) needs.delete("missing");
        if (name === "getCurrentUser" && (d === `${v}.role !== "admin"` || d === `${v}?.role !== "admin"`)) needs.delete("role");
      }
      if (needs.size === 0) return null;
    }
    const unsafe = callsInOrder(st).find((c) => !isSafe(c.name, scope, new Set()));
    if (unsafe) return `calls ${unsafe.name}() after reading the session with ${name}() but before refusing with an if that returns or throws`;
  }
  const missing = needs.has("role") && !needs.has("missing") ? " a role other than admin" : guard === "admin" && name === "getCurrentUser" ? " a missing user and a role other than admin" : "";
  return `reads the session with ${name}() but doesn't refuse${missing} with an if that returns or throws`;
}

/** A call that can't write: on the safe list, or a local helper whose own calls are all safe. */
function isSafe(name: string, scope: Scope, seen: Set<FnNode>): boolean {
  if (SAFE_BEFORE_GUARD.has(name)) return true;
  const fn = scope.get(name);
  if (!fn || seen.has(fn) || !fn.body) return false;
  seen.add(fn);
  return callsInOrder(fn.body).every((c) => isSafe(c.name, scope, seen));
}

const SESSION_READS = new Set(["getCurrentUser", "apiUser"]);

/**
 * Null when `fn` guards before anything else; otherwise why not. The guard must
 * be a bare call, awaited (or returned), in a top-level statement of the
 * function or of a top-level try block: one inside an if, a loop or a
 * short-circuit may not run. A throwing guard inside a try can have its refusal
 * swallowed by the catch; a session read there counts only when the catch leaves
 * the function too (an error reading the session mustn't fall through to the work).
 */
function guardProblem(fn: FnNode, guard: Exclude<Guard, "public">, fileScope: Scope, seen = new Set<FnNode>()): string | null {
  const body = fn.body;
  if (!body) return "has no body to check";
  if (seen.has(fn)) return "calls itself before any guard";
  seen.add(fn);
  const scope: Scope = new Map([...fileScope, ...(ts.isBlock(body) ? functionsIn(body.statements) : [])]);
  const guards = guard === "admin" ? ADMIN_GUARDS : USER_GUARDS;
  const want = guard === "admin" ? "requireAdmin()" : "requireUser()";

  type Entry = { node: ts.Node; siblings: readonly ts.Statement[]; tryStatement?: ts.TryStatement };
  const entries: Entry[] = [];
  if (!ts.isBlock(body)) entries.push({ node: body, siblings: [] });
  else {
    for (const st of body.statements) {
      if (ts.isTryStatement(st)) {
        for (const inner of st.tryBlock.statements) entries.push({ node: inner, siblings: st.tryBlock.statements, tryStatement: st });
        if (st.catchClause) entries.push({ node: st.catchClause, siblings: [] });
        if (st.finallyBlock) entries.push({ node: st.finallyBlock, siblings: [] });
      } else entries.push({ node: st, siblings: body.statements });
    }
  }

  for (const { node: statement, siblings, tryStatement } of entries) {
    const topLevel = !ts.isBlock(body) || ts.isVariableStatement(statement) || ts.isExpressionStatement(statement) || ts.isReturnStatement(statement);
    for (const { name, node } of callsInOrder(statement)) {
      const bare = ts.isCallExpression(node) && ts.isIdentifier(node.expression); // o.requireAdmin() or o?.requireAdmin() is someone else's method
      const helper = bare ? scope.get(name) : undefined;
      const isGuard = bare && (guards.has(name) || SESSION_READS.has(name) || (helper !== undefined && guardProblem(helper, guard, fileScope, seen) === null));
      if (isGuard) {
        const placement = topLevel ? guardPlacement(node as ts.CallExpression, statement, fn) : "conditional";
        if (placement === "conditional") return `calls ${name}() only conditionally (inside an if, a loop or a short-circuit), so it may not run`;
        if (placement === "unawaited") return `calls ${name}() without awaiting it, so its refusal is never seen`;
        if (!SESSION_READS.has(name)) {
          return tryStatement?.catchClause ? `calls ${name}() inside a try, whose catch can swallow its refusal` : null;
        }
        // `const` only: a `let` could be reassigned (`u = u ?? someoneElse`) between the check and the work.
        const isConst = ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
        const decl = isConst ? (statement as ts.VariableStatement).declarationList.declarations.find((d) => d.initializer && d.getText().includes(`${name}(`)) : undefined;
        const variable = decl && ts.isIdentifier(decl.name) ? decl.name.text : null;
        if (!variable) return `reads the session with ${name}() without keeping it in a const, so its check can't be followed`;
        const after = siblings.slice(siblings.indexOf(statement as ts.Statement) + 1);
        const refusal = sessionRefusalProblem(name as "getCurrentUser" | "apiUser", variable, after, guard, scope);
        if (refusal) return refusal;
        if (tryStatement?.catchClause && !exits(tryStatement.catchClause.block)) {
          return `reads the session with ${name}() inside a try whose catch doesn't return or throw, so an error there falls through to the work`;
        }
        return null;
      }
      if (isSafe(name, scope, new Set())) continue;
      return `calls ${name}() before ${want}`;
    }
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
          const why = guardProblem(e.fn, area, e.scope ?? fileScope);
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
          const why = guardProblem(e.fn, entry.guard, e.scope ?? fileScope);
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

  it("every opt-in module's route handler guards before it works, mounted or not", () => {
    const routes = walk(join(ROOT, "modules")).filter((f) => /\/routes\/[^/]+\.ts$/.test(rel(f)));
    expect(routes.length).toBeGreaterThan(0);
    const problems = routes.flatMap((file) => {
      const sf = parse(file);
      return exportsOf(sf)
        .filter((e) => HTTP_METHODS.has(e.name))
        .map((e) => (e.fn ? guardProblem(e.fn, "user", functionsIn(sf.statements)) : (e.problem ?? "unreadable")))
        .filter((why): why is string => why !== null)
        .map((why) => `${rel(file)}: ${why}`);
    });
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
        'src/app/api/admin/media/route.ts: POST is re-exported from "@/modules/x/route", which can\'t be read, so its guard can\'t be checked: define the handler in this file',
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

    it("a guard that isn't awaited, is conditional, or sits in a try with a catch doesn't count", () => {
      expect(check("src/app/admin/x/actions.ts", `"use server"; export async function a() { requireAdmin(); await deleteAll(); }`)).toEqual([
        "src/app/admin/x/actions.ts: server action a() calls requireAdmin() without awaiting it, so its refusal is never seen",
      ]);
      expect(check("src/app/admin/x/actions.ts", `"use server"; export async function a(f: boolean) { if (f) await requireAdmin(); await wipe(); }`)).toEqual([
        "src/app/admin/x/actions.ts: server action a() calls requireAdmin() only conditionally (inside an if, a loop or a short-circuit), so it may not run",
      ]);
      expect(check("src/app/admin/x/actions.ts", `"use server"; export async function a() { try { await requireAdmin(); } catch {} await wipe(); }`)).toEqual([
        "src/app/admin/x/actions.ts: server action a() calls requireAdmin() inside a try, whose catch can swallow its refusal",
      ]);
      // A checked session read inside a try is fine: it returns null rather than throwing.
      expect(check("src/app/api/billing/portal/route.ts", `export async function POST() { try { const u = await getCurrentUser(); if (!u) return no(); await go(u); } catch { return err(); } }`)).toEqual([]);
    });

    it("refuses the ways round a guard that review found (each probe was a pass before)", () => {
      const A = "src/app/admin/x/actions.ts";
      const D = "src/app/dashboard/x/actions.ts";
      const probes: Record<string, [string, string]> = {
        shortCircuit: [A, `"use server"; export async function a(f: boolean) { f || await requireAdmin(); await wipe(); }`],
        ternary: [A, `"use server"; export async function a(f: boolean) { const x = f ? null : await requireAdmin(); await wipe(); }`],
        nullish: [A, `"use server"; export async function a(f: unknown) { const x = f ?? await requireAdmin(); await wipe(); }`],
        optionalCall: [A, `"use server"; export async function a(o: any) { await o?.requireAdmin(); await wipe(); }`],
        someonesMethod: [A, `"use server"; export async function a(o: any) { await o.requireAdmin(); await wipe(); }`],
        nullCheckThatDoesntStop: [D, `"use server"; export async function a() { const u = await getCurrentUser(); if (!u) log("x"); await wipe(u); }`],
        responseCheckThatDoesntStop: ["src/app/api/billing/checkout/route.ts", `export async function POST(r: Request) { const u = await apiUser(r); if (u instanceof Response) log(u); await wipe(); }`],
        apiUserForAdmin: ["src/app/api/admin/media/route.ts", `export async function POST(r: Request) { const u = await apiUser(r); if (u instanceof Response) return u; await wipe(); }`],
        catchSwallows: [D, `"use server"; export async function a() { try { const u = await getCurrentUser(); if (!u) throw new Error("no"); } catch {} await wipe(); }`],
        checkInACallback: [D, `"use server"; export async function a() { const u = await getCurrentUser(); const later = () => { if (!u) return; }; await wipe(u); }`],
        workBeforeTheCheck: [D, `"use server"; export async function a() { const u = await getCurrentUser(); await wipe(); if (!u) return; }`],
        workBeforeTheResponseCheck: ["src/app/api/billing/checkout/route.ts", `export async function POST(r: Request) { const u = await apiUser(r); await wipe(); if (u instanceof Response) return u; }`],
        loadBeforeTheCheck: [D, `"use server"; export async function a() { const u = await getCurrentUser(); const data = await load(u?.id); if (!u) return; }`],
        andInTheCheck: [D, `"use server"; export async function a(f: boolean) { const u = await getCurrentUser(); if (!u && f) return; await wipe(u); }`],
        andInTheRoleCheck: ["src/app/api/admin/media/route.ts", `export async function POST() { const u = await getCurrentUser(); if (!u || (u.role !== "admin" && u.id === "x")) return 1; await wipe(); }`],
        reassignable: [D, `"use server"; export async function a(fake: unknown) { let u = await getCurrentUser(); if (!u) return; u = u ?? fake; await wipe(u); }`],
        constructorFirst: [A, `"use server"; export async function a() { new Wiper(); await requireAdmin(); }`],
      };
      for (const [label, [path, source]] of Object.entries(probes)) expect(check(path, source), label).toHaveLength(1);
      // The real shapes still pass.
      expect(check(A, `"use server"; export async function a() { await requireAdmin(); }`)).toEqual([]);
      expect(check(D, `"use server"; export async function a() { const u = await getCurrentUser(); if (!u) { log("x"); return; } await wipe(u); }`)).toEqual([]);
      expect(check(D, `"use server"; export async function a() { try { const u = await getCurrentUser(); if (!u) return no(); await go(u); } catch (e) { log(e); return err(); } }`)).toEqual([]);
    });

    it("follows a re-export into the module file, and checks apiUser() and its Response check there", () => {
      // A route listed as needing a user (same folder depth as a real module mount) re-exporting a real module handler.
      const at = "src/app/api/billing/checkout/route.ts";
      expect(check(at, `export { POST } from "../../../../../modules/ai/routes/chat";`)).toEqual([]);
      expect(check(at, `export { POST } from "../../../../../modules/nope/route";`)).toEqual([
        `${at}: POST is re-exported from "../../../../../modules/nope/route", which can't be read, so its guard can't be checked: define the handler in this file`,
      ]);
      // apiUser() without its instanceof Response check isn't a guard.
      expect(check(at, `export async function POST(r: Request) { const u = await apiUser(r); await go(u); }`)).toEqual([
        `${at}: POST calls go() after reading the session with apiUser() but before refusing with an if that returns or throws`,
      ]);
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
