//
// Authorization is enforced, not remembered (ROADMAP 1.2).
//
// The proxy only checks that a cookie exists (invariant 5). The real check is
// a guard call at the top of every page, server action and route handler, and
// a guard someone forgot gives no error and no failing test: the page just
// works for whoever finds it. This test reads every such file with the
// TypeScript parser and fails when:
//
//  - an admin page, or an exported function in an admin "use server" file,
//    doesn't call requireAdmin() itself
//  - a dashboard page or action doesn't call requireUser() / requirePlan() / requireAdmin()
//  - a route handler isn't in ROUTES below, or an exported method doesn't make the
//    call its entry promises
//  - a "use server" file sits somewhere it doesn't classify
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
};

/** "use server" files outside admin/ and dashboard/, and why they need no app guard. */
const PUBLIC_ACTIONS: Record<string, string> = {
  "src/app/(marketing)/contact/actions.ts": "the public contact form, without JavaScript: rate limited",
  "src/adapters/auth/better-auth/actions.ts":
    "sign-in, sign-up and account security: Better Auth checks its own session, and the signed-out ones are rate limited",
};

const ADMIN_GUARDS = ["requireAdmin"];
const USER_GUARDS = ["requireUser", "requirePlan", "requireAdmin"];
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(ROOT, path).split("\\").join("/");

type Fn = { name: string; body: ts.Node; sf: ts.SourceFile };

function parse(file: string, source = readFileSync(file, "utf8")): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isDefault = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

/** Exported functions (declarations and `export const x = async () => …`), with `default` for the default export. */
function exportedFunctions(sf: ts.SourceFile): Fn[] {
  const fns: Fn[] = [];
  for (const node of sf.statements) {
    if (ts.isFunctionDeclaration(node) && node.body && isExported(node)) {
      fns.push({ name: isDefault(node) ? "default" : (node.name?.text ?? "default"), body: node.body, sf });
    } else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          fns.push({ name: d.name.text, body: d.initializer.body, sf });
        }
      }
    }
  }
  return fns;
}

/** Names of the functions called anywhere inside `node` (`foo()` and `x.foo()`). */
function calls(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) names.add(e.text);
      else if (ts.isPropertyAccessExpression(e)) names.add(e.name.text);
    }
    n.forEachChild(visit);
  };
  visit(node);
  return names;
}

/** Every function declared at the top level of the file (exported or not), by name. */
function localFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const fns = new Map<string, ts.Node>();
  for (const node of sf.statements) {
    if (ts.isFunctionDeclaration(node) && node.body && node.name) fns.set(node.name.text, node.body);
    else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          fns.set(d.name.text, d.initializer.body);
        }
      }
    }
  }
  return fns;
}

/**
 * Whether a function body makes the call its guard promises: itself, or through
 * a helper declared in the same file (settings' viaAuth()). A helper in another
 * file doesn't count; the guard has to be visible where the action is. An admin
 * route may read the session itself (to answer JSON rather than redirect), but
 * then it must compare the role in the same function.
 */
function guarded(fn: Fn, guard: Exclude<Guard, "public">, seen = new Set<ts.Node>()): boolean {
  if (seen.has(fn.body)) return false;
  seen.add(fn.body);
  const called = calls(fn.body);
  const direct =
    guard === "admin"
      ? ADMIN_GUARDS.some((g) => called.has(g)) || (called.has("getCurrentUser") && /\.role\s*!==\s*"admin"/.test(fn.body.getText()))
      : USER_GUARDS.some((g) => called.has(g)) || called.has("getCurrentUser");
  if (direct) return true;
  const local = localFunctions(fn.sf);
  return [...called].some((name) => {
    const body = local.get(name);
    return body !== undefined && guarded({ name, body, sf: fn.sf }, guard, seen);
  });
}

const isUseServer = (sf: ts.SourceFile) => {
  const first = sf.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
};

/** The problems in one file, as sentences. Exported for the self-test below. */
function problemsIn(file: string, sf: ts.SourceFile): string[] {
  const path = rel(file);
  const base = path.split("/").pop()!;
  const area = path.startsWith("src/app/admin/") ? "admin" : path.startsWith("src/app/dashboard/") ? "user" : null;
  const problems: string[] = [];

  if (base === "page.tsx" && area) {
    const page = exportedFunctions(sf).find((f) => f.name === "default");
    if (!page) problems.push(`${path}: no default-exported page function to check`);
    else if (!guarded(page, area)) problems.push(`${path}: the page doesn't call ${area === "admin" ? "requireAdmin()" : "requireUser()"}`);
  }

  if (isUseServer(sf)) {
    if (area) {
      for (const fn of exportedFunctions(sf)) {
        if (!guarded(fn, area)) problems.push(`${path}: server action ${fn.name}() doesn't call ${area === "admin" ? "requireAdmin()" : "requireUser()"}`);
      }
    } else if (!(path in PUBLIC_ACTIONS)) {
      problems.push(`${path}: a "use server" file outside admin/ and dashboard/ — guard each action, or add it to PUBLIC_ACTIONS with the reason`);
    }
  }

  if (base === "route.ts" && path.startsWith("src/app/")) {
    const entry = ROUTES[path];
    if (!entry) problems.push(`${path}: a route handler not listed in ROUTES — say which guard it needs`);
    else if (entry.guard !== "public") {
      for (const fn of exportedFunctions(sf).filter((f) => HTTP_METHODS.has(f.name))) {
        if (!guarded(fn, entry.guard)) problems.push(`${path}: ${fn.name} doesn't check the ${entry.guard === "admin" ? "admin role" : "session"}`);
      }
    }
  }
  return problems;
}

describe("authorization", () => {
  const files = [...walk(join(SRC, "app")), ...walk(join(SRC, "adapters"))];

  it("every admin and dashboard page, server action and route handler calls its guard", () => {
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

  it("catches the mistakes it exists for", () => {
    const check = (path: string, source: string) => problemsIn(join(ROOT, path), parse(join(ROOT, path), source));

    // An admin action that forgot its guard, next to one that has it.
    expect(
      check(
        "src/app/admin/x/actions.ts",
        `"use server";
         export async function ok() { await requireAdmin(); }
         export async function forgot() { await doTheThing(); }`,
      ),
    ).toEqual(["src/app/admin/x/actions.ts: server action forgot() doesn't call requireAdmin()"]);

    // requireUser() isn't enough for the admin.
    expect(check("src/app/admin/x/page.tsx", `export default async function Page() { await requireUser(); }`)).toHaveLength(1);
    // A guard in a helper that the page never calls doesn't count.
    expect(
      check("src/app/dashboard/x/page.tsx", `async function unused() { await requireUser(); } export default async function Page() { return null; }`),
    ).toHaveLength(1);
    // A same-file helper that guards counts (settings' viaAuth()); one that doesn't, doesn't.
    expect(
      check(
        "src/app/dashboard/x/actions.ts",
        `"use server";
         async function via() { await requireUser(); }
         async function plain() { await write(); }
         export async function ok() { return via(); }
         export async function forgot() { return plain(); }`,
      ),
    ).toEqual(["src/app/dashboard/x/actions.ts: server action forgot() doesn't call requireUser()"]);
    // An arrow-function action is checked too.
    expect(check("src/app/dashboard/x/actions.ts", `"use server"; export const save = async () => { await write(); };`)).toHaveLength(1);
    // A session read with no role check is not an admin guard.
    expect(check("src/app/api/admin/media/route.ts", `export async function POST() { const u = await getCurrentUser(); }`)).toHaveLength(1);
    // A new route nobody classified.
    expect(check("src/app/api/new/route.ts", `export async function GET() {}`)).toEqual([
      "src/app/api/new/route.ts: a route handler not listed in ROUTES — say which guard it needs",
    ]);
    // A stray "use server" file.
    expect(check("src/app/(marketing)/x/actions.ts", `"use server"; export async function a() {}`)).toHaveLength(1);
  });
});
