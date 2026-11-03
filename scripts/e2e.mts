//
// npm run e2e — drive a running OpenShipKit end to end, the way a new admin,
// a visitor and an agent would, then clean up after itself.
//
//   npm run e2e                                         http://localhost:3000 (npm run dev)
//   npm run e2e -- http://localhost:3000 --email-log /tmp/server.log
//   npm run e2e -- https://staging.example.com --email e2e@example.com --email-log server.log
//
// The journey, every step through the same doors a person uses:
//   1. sign up (Better Auth's /api/auth/sign-up/email). With email
//      verification on, the confirmation link is read from the server's log
//      (--email-log: the console email provider prints it there) and opened.
//   2. become an admin through ADMIN_EMAILS (the address must be listed on the
//      server). Not listed, and an admin agent key at hand (--mcp-key, or
//      MCP_DEV_KEY on a local dev server)? It is promoted with the MCP
//      user_set_role tool instead, and the run warns that ADMIN_EMAILS wasn't
//      exercised.
//   3. mint an agent key in /admin/agents, then MCP initialize + content_get.
//   4. edit a content section (the announcement bar) in /admin/content and
//      see it on /; content_get sees the same write.
//   5. create and publish a post in /admin/posts/new; see it on /blog, on its
//      own page (h1, BlogPosting JSON-LD), in the sitemap, the RSS feed and
//      llms.txt.
//   6. send the contact form signed out; see the message in /admin/feedback.
//   7. clean up: delete the post (and check it 404s), put the section back
//      exactly as it was, close the contact message (feedback has no delete),
//      delete the account — which revokes the key it minted (checked: the key
//      is refused afterwards). When the account is the site's only admin (a
//      fresh database, as in CI) the app refuses that by design: the run warns
//      and lists the account as left over. Audit-log entries stay: the log is
//      append-only by design. --keep skips the clean-up, to look at what it made.
//
// The admin forms are submitted WITHOUT JavaScript: the page's own
// <form> (server action fields included) posted as multipart, as a browser with
// scripting off would. So a form that only works with JavaScript fails here,
// and a run proves the no-JS path at the same time.
//
// Which server: anything that answers HTTP — `npm run dev` (verification off,
// MCP_DEV_KEY works), or a production build (`npm run build && npm start`, or
// CI's) with ADMIN_EMAILS listing the --email address and, so the link reaches
// the log, EMAIL_CONSOLE_PRINT_BODIES=true. Never point it at a site with real
// users: it writes (and deletes) for real, and a failed run can leave its post
// or account behind — the output names what to remove.
//
// Settings: E2E_URL, E2E_EMAIL, E2E_EMAIL_LOG, E2E_MCP_KEY from the shell, else
// .env.local, else .env (scripts/load-env.mts); against localhost MCP_DEV_KEY
// is the fallback key. Exit code 0 when every step passes, 1 otherwise.
// Run with tsx (`npm run e2e`). No dependencies: fetch only.
//

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { argv, env, exit } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { loadLocalEnv } from "./load-env.mjs";

interface Options {
  base: string;
  /** The account to sign up; unique per run unless given. */
  email: string;
  /** True when --email / E2E_EMAIL chose the address (it may be in ADMIN_EMAILS). */
  emailGiven: boolean;
  emailLog?: string;
  /** An admin-scope key for the fallbacks (promotion, clean-up when minting fails). */
  fallbackKey?: string;
  keep: boolean;
  timeoutMs: number;
}

interface Result {
  name: string;
  ok: boolean;
  detail: string;
  warn?: boolean;
}

const HELP = `npm run e2e — sign up, administer, publish, contact and call MCP on a running OpenShipKit, then clean up.

Usage: npm run e2e -- [url] [options]

  url                the site's origin (default $E2E_URL or http://localhost:3000)
  --email <address>  the account to create (default $E2E_EMAIL, else e2e-<random>@example.com).
                     List it in ADMIN_EMAILS on the server to test promotion; it must not exist yet
  --email-log <path> the server's log, where the console email provider prints the
                     verification link (default $E2E_EMAIL_LOG). Needed when verification is on
  --mcp-key <key>    an ADMIN agent key, used only as a fallback: to promote the account when
                     ADMIN_EMAILS doesn't list it, and to clean up if minting a key fails
                     (default $E2E_MCP_KEY; against localhost, MCP_DEV_KEY)
  --keep             leave what the run created in place (no clean-up)
  --timeout <ms>     per-request timeout (default 60000; a cold dev server compiles on first hit)

WRITES TO THE SITE. Use a development or staging server, never one with real users.`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

function parseArgs(args: string[]): Options {
  loadLocalEnv("e2e");
  let base = env.E2E_URL ?? "http://localhost:3000";
  let email = env.E2E_EMAIL ?? "";
  let emailLog = env.E2E_EMAIL_LOG;
  let key = env.E2E_MCP_KEY;
  let keep = false;
  let timeoutMs = 60_000;
  const value = (i: number, flag: string): string => {
    const v = args[i + 1];
    if (!v || v.startsWith("--")) {
      console.error(`e2e: ${flag} needs a value`);
      exit(2);
    }
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const take = (): string => (eq > 0 ? arg.slice(eq + 1) : value(i++, flag));
    if (arg === "--") continue;
    else if (flag === "-h" || flag === "--help") {
      console.log(HELP);
      exit(0);
    } else if (flag === "--email") email = take();
    else if (flag === "--email-log") emailLog = take();
    else if (flag === "--mcp-key") key = take();
    else if (flag === "--timeout") timeoutMs = Number(take());
    else if (flag === "--keep") keep = true;
    else if (!arg.startsWith("-")) base = arg;
    else {
      console.error(`e2e: unknown option ${arg} (try --help)`);
      exit(2);
    }
  }
  if (!/^https?:\/\/[^/\s]+/.test(base)) {
    console.error(`e2e: "${base}" is not a URL like https://example.com`);
    exit(2);
  }
  if (email && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) {
    console.error(`e2e: --email "${email}" is not an email address`);
    exit(2);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 60_000;
  const local = URL.canParse(base) && LOCAL_HOSTS.has(new URL(base).hostname);
  if (!key && local && env.MCP_DEV_KEY) key = env.MCP_DEV_KEY;
  return {
    base: base.replace(/\/+$/, ""),
    email: (email || `e2e-${randomBytes(4).toString("hex")}@example.com`).toLowerCase(),
    emailGiven: Boolean(email),
    emailLog: emailLog || undefined,
    fallbackKey: key || undefined,
    keep,
    timeoutMs,
  };
}

const options = parseArgs(argv.slice(2));
const results: Result[] = [];
/** What the run created and hasn't removed yet, for the closing report. */
const leftovers = new Map<string, string>();
/** A run-unique word, so every assertion finds this run's writes and nothing older. */
const RUN = `e2e${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

function record(name: string, ok: boolean, detail: string, warn = false): void {
  results.push({ name, ok, detail, warn });
  const mark = !ok ? "FAIL" : warn ? "warn" : " ok ";
  console.log(`  [${mark}] ${name}  ${detail}`);
}

/** Run one step; a throw is that step's failure. Returns whether it passed. */
async function step(name: string, run: () => Promise<[boolean, string] | [boolean, string, boolean]>): Promise<boolean> {
  try {
    const [ok, detail, warn] = await run();
    record(name, ok, detail, warn ?? false);
    return ok;
  } catch (error) {
    const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    const why = e.name === "TimeoutError" ? `timed out after ${options.timeoutMs} ms` : (e.cause?.code ?? e.cause?.message ?? e.message ?? String(error));
    record(name, false, why);
    return false;
  }
}

// ---------------------------------------------------------------- HTTP with cookies

/** A cookie jar per actor: the admin's browser and an anonymous visitor's. */
class Jar {
  private readonly cookies = new Map<string, string>();

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Take every Set-Cookie of a response; an empty value or Max-Age=0 deletes. */
  take(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const at = pair.indexOf("=");
      if (at < 1) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get size(): number {
    return this.cookies.size;
  }
}

async function request(jar: Jar | null, path: string, init: RequestInit = {}): Promise<Response> {
  const url = /^https?:\/\//.test(path) ? path : `${options.base}${path}`;
  const headers = new Headers(init.headers);
  headers.set("user-agent", "openshipkit-e2e/1.0");
  if (jar && jar.size > 0) headers.set("cookie", jar.header());
  // Better Auth and Next's server actions both compare Origin with the site.
  if ((init.method ?? "GET") !== "GET") headers.set("origin", options.base);
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(options.timeoutMs), ...init, headers });
  jar?.take(res);
  return res;
}

/** GET a page and its HTML; follows same-site redirects (taking cookies at each hop). */
async function page(jar: Jar | null, path: string): Promise<{ res: Response; html: string; path: string }> {
  let at = path;
  for (let hop = 0; hop < 5; hop++) {
    const res = await request(jar, at);
    const to = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && to) {
      at = new URL(to, `${options.base}${at}`).pathname + new URL(to, `${options.base}${at}`).search;
      continue;
    }
    return { res, html: await res.text(), path: at };
  }
  throw new Error(`too many redirects from ${path}`);
}

// ---------------------------------------------------------------- HTML forms, without JavaScript

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of tag.matchAll(/([a-zA-Z_:$][\w:.$-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
  }
  return out;
}

interface HtmlForm {
  action: string;
  /** Name/value pairs a browser would send, in document order (before any submit button). */
  fields: [string, string][];
  /** Named submit buttons: name → values. */
  buttons: Map<string, string[]>;
}

/** Every <form> on the page, with what a browser without JavaScript would submit. */
function parseForms(html: string): HtmlForm[] {
  const forms: HtmlForm[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const form: HtmlForm = { action: attributes(m[1]).action ?? "", fields: [], buttons: new Map() };
    const body = m[2];
    for (const t of body.matchAll(/<(input|button)\b([^>]*)>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>|<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      if (t[1]) {
        const a = attributes(t[2]);
        if (!a.name || "disabled" in a) continue;
        const type = (a.type ?? (t[1].toLowerCase() === "button" ? "submit" : "text")).toLowerCase();
        if (type === "submit" || type === "image") {
          const list = form.buttons.get(a.name) ?? [];
          list.push(a.value ?? "");
          form.buttons.set(a.name, list);
        } else if (type === "checkbox" || type === "radio") {
          if ("checked" in a) form.fields.push([a.name, a.value ?? "on"]);
        } else if (type !== "button" && type !== "reset" && type !== "file") {
          form.fields.push([a.name, a.value ?? ""]);
        }
      } else if (t[3] !== undefined) {
        const a = attributes(t[3]);
        if (a.name && !("disabled" in a)) form.fields.push([a.name, decode(t[4] ?? "").replace(/^\n/, "")]);
      } else if (t[5] !== undefined) {
        const a = attributes(t[5]);
        if (!a.name || "disabled" in a) continue;
        const options = [...(t[6] ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => ({ a: attributes(o[1]), text: decode(o[2]).trim() }));
        const chosen = options.find((o) => "selected" in o.a) ?? options[0];
        if (chosen) form.fields.push([a.name, chosen.a.value ?? chosen.text]);
      }
    }
    forms.push(form);
  }
  return forms;
}

/**
 * The form on the page that has a field (or submit button) with this name —
 * and none named in `without`, to tell apart two forms that share a field
 * name (the password form's "confirm" and the delete-account form's).
 */
function formWith(html: string, field: string, where: string, without: string[] = []): HtmlForm {
  const has = (f: HtmlForm, name: string) => f.fields.some(([n]) => n === name) || f.buttons.has(name);
  const form = parseForms(html).find((f) => has(f, field) && !without.some((name) => has(f, name)));
  if (!form) throw new Error(`no form with a “${field}” field on ${where} (signed out, or the page changed?)`);
  return form;
}

/**
 * Submit a form as a browser with scripting off: its fields (with `set`
 * replacing values by name) plus the chosen submit button, as multipart, to
 * its action (empty = the page itself). Returns the response unfollowed.
 */
async function submit(jar: Jar, pagePath: string, form: HtmlForm, set: Record<string, string>, button?: [string, string]): Promise<Response> {
  const body = new FormData();
  const replaced = new Set<string>();
  for (const [name, value] of form.fields) {
    if (name in set) {
      if (replaced.has(name)) continue; // a radio group or repeated field: one value
      replaced.add(name);
      body.append(name, set[name]);
    } else {
      body.append(name, value);
    }
  }
  for (const [name, value] of Object.entries(set)) if (!replaced.has(name)) body.append(name, value);
  if (button) body.append(button[0], button[1]);
  const target = form.action ? new URL(form.action, `${options.base}${pagePath}`).toString() : `${options.base}${pagePath}`;
  return request(jar, target, { method: "POST", body });
}

/** The visible text of an HTML response (tags stripped), for "does it say X". */
function textOf(html: string): string {
  return decode(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

// ---------------------------------------------------------------- MCP

let mcpKey: string | undefined;

interface ToolReply {
  ok: boolean;
  value: Record<string, unknown>;
  message: string;
}

async function rpc(key: string, message: Record<string, unknown>): Promise<{ status: number; body: { result?: Record<string, unknown>; error?: { message?: string } } | null }> {
  const res = await request(null, "/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(message),
  });
  const raw = await res.text();
  if (!raw.trim()) return { status: res.status, body: null };
  const json = res.headers.get("content-type")?.includes("text/event-stream") ? (raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}") : raw;
  try {
    return { status: res.status, body: JSON.parse(json) as { result?: Record<string, unknown>; error?: { message?: string } } };
  } catch {
    return { status: res.status, body: null };
  }
}

let rpcId = 10;

/** tools/call → the tool's structured result, or its error text. */
async function tool(key: string, name: string, args: Record<string, unknown>): Promise<ToolReply> {
  const { status, body } = await rpc(key, { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } });
  if (status !== 200 || !body) return { ok: false, value: {}, message: `HTTP ${status}` };
  if (body.error) return { ok: false, value: {}, message: body.error.message ?? "JSON-RPC error" };
  const result = body.result ?? {};
  const text = ((result.content as { text?: string }[] | undefined) ?? []).map((c) => c.text ?? "").join(" ");
  if (result.isError) return { ok: false, value: {}, message: text || "tool error" };
  let value = result.structuredContent as Record<string, unknown> | undefined;
  if (!value) {
    try {
      value = JSON.parse(text) as Record<string, unknown>;
    } catch {
      value = {};
    }
  }
  return { ok: true, value, message: text };
}

// ---------------------------------------------------------------- the journey

const admin = new Jar();
const password = `e2e-${randomBytes(18).toString("base64url")}`;
const SECTION = "announcement";
let accountCreated = false;
let priorSection: { stored: boolean; value: unknown } | null = null;
let postId: string | null = null;
const postSlug = `e2e-check-${RUN}`;
const postTitle = `End-to-end check ${RUN}`;

/** The newest verification link for `email` in the log, or null. */
function verificationLink(log: string, email: string): string | null {
  let found: string | null = null;
  for (const block of log.split(/\n(?=─{4,}|-{8,}\s*email)/)) {
    if (!new RegExp(`^To:\\s+${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(block)) continue;
    const link = /(https?:\/\/\S+\/api\/auth\/verify-email\?\S+)/.exec(block)?.[1];
    if (link) found = link;
  }
  return found;
}

async function signUp(): Promise<boolean> {
  const before = options.emailLog && existsSync(options.emailLog) ? readFileSync(options.emailLog, "utf8").length : 0;
  let needsVerification = false;
  const ok = await step("sign up", async () => {
    const res = await request(admin, "/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "E2E Check", email: options.email, password }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string | null; user?: { id?: string }; code?: string; message?: string };
    if (res.status === 422 || body.code === "USER_ALREADY_EXISTS" || body.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      return [false, `${options.email} already has an account — delete it in /admin/users, or pass another --email`];
    }
    if (!res.ok) return [false, `HTTP ${res.status}: ${body.message ?? body.code ?? "refused"}`];
    accountCreated = true;
    leftovers.set("account", `the account ${options.email} (delete it in /admin/users)`);
    needsVerification = !body.token;
    return [true, `${options.email}${needsVerification ? " · verification required" : " · signed in (verification off)"}`];
  });
  if (!ok) return false;
  if (!needsVerification) return true;

  return step("verify the email", async () => {
    if (!options.emailLog) return [false, "verification is on: pass --email-log <the server's log file> so the link can be read (the console email provider prints it; in production set EMAIL_CONSOLE_PRINT_BODIES=true)"];
    let link: string | null = null;
    for (let i = 0; i < 30 && !link; i++) {
      if (existsSync(options.emailLog)) link = verificationLink(readFileSync(options.emailLog, "utf8").slice(Math.max(0, before - 2000)), options.email);
      if (!link) await sleep(500);
    }
    if (!link) return [false, `no verification link for ${options.email} in ${options.emailLog} within 15 s (bodies hidden? EMAIL_CONSOLE_PRINT_BODIES=true in production)`];
    // The link names the site's public origin; open it on the origin under test.
    const at = new URL(link);
    const { res } = await page(admin, `${at.pathname}${at.search}`);
    if (res.status >= 400) return [false, `the link answered HTTP ${res.status}`];
    return [admin.size > 0, admin.size > 0 ? "confirmed and signed in" : "confirmed, but no session cookie came back"];
  });
}

async function becomeAdmin(): Promise<boolean> {
  return step("admin via ADMIN_EMAILS", async () => {
    const dash = await page(admin, "/dashboard");
    if (dash.res.status !== 200 || dash.path.startsWith("/sign-in")) return [false, `/dashboard answered HTTP ${dash.res.status} at ${dash.path} — not signed in`];
    const first = await page(admin, "/admin");
    if (first.res.status === 200 && !first.path.startsWith("/sign-in")) return [true, `${options.email} opened /admin`];
    if (!options.fallbackKey) {
      return [false, `/admin answered HTTP ${first.res.status}: add ${options.email} to ADMIN_EMAILS on the server (and pass --email ${options.email}), or give --mcp-key <admin key> to promote it`];
    }
    const found = await tool(options.fallbackKey, "users_list", { search: options.email });
    const user = ((found.value.items as { id: string; email: string }[] | undefined) ?? []).find((u) => u.email === options.email);
    if (!found.ok || !user) return [false, `not in ADMIN_EMAILS, and the fallback key couldn't find the user (${found.message.slice(0, 120)})`];
    const promoted = await tool(options.fallbackKey, "user_set_role", { id: user.id, role: "admin" });
    if (!promoted.ok) return [false, `not in ADMIN_EMAILS; user_set_role failed: ${promoted.message.slice(0, 160)}`];
    const again = await page(admin, "/admin");
    if (again.res.status !== 200) return [false, `promoted with user_set_role, but /admin still answers HTTP ${again.res.status}`];
    return [true, `${options.email} isn’t in ADMIN_EMAILS (${options.emailGiven ? "check the server’s list" : "pass --email <a listed address> to test it"}); promoted with MCP user_set_role instead`, true];
  });
}

async function mintKey(): Promise<void> {
  const minted = await step("mint an agent key (/admin/agents)", async () => {
    const at = "/admin/agents";
    const { html } = await page(admin, at);
    const form = formWith(html, "scope", at);
    const res = await submit(admin, at, form, { name: `e2e ${RUN}`, scope: "admin" });
    const body = await res.text();
    const key = /\bosk_[A-Za-z0-9_-]{20,}/.exec(body)?.[0];
    if (!key) {
      const said = /(An Admin key needs a fresh sign-in[^<]*|[^<>]*(?:refused|can’t|couldn’t)[^<]*)/.exec(body)?.[1];
      return [false, `HTTP ${res.status}, no key in the response${said ? `: “${decode(said).trim().slice(0, 140)}”` : ""}`];
    }
    mcpKey = key;
    leftovers.set("key", `the agent key “e2e ${RUN}” (revoke it in /admin/agents; deleting the account revokes it too)`);
    return [true, `admin key …${key.slice(-6)} (deleting the account at the end revokes it)`];
  });
  if (!minted && options.fallbackKey) {
    mcpKey = options.fallbackKey;
    record("agent key fallback", true, "using --mcp-key / MCP_DEV_KEY for the MCP steps", true);
  }
}

async function mcpReadSection(): Promise<void> {
  const key = mcpKey;
  if (!key) {
    record("mcp initialize + content_get", false, "no agent key (minting failed and no --mcp-key)");
    return;
  }
  await step("mcp initialize", async () => {
    const { status, body } = await rpc(key, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openshipkit-e2e", version: "1.0.0" } },
    });
    if (status !== 200 || !body?.result) return [false, `HTTP ${status}${body?.error?.message ? `: ${body.error.message}` : ""}`];
    await rpc(key, { jsonrpc: "2.0", method: "notifications/initialized" });
    const info = body.result.serverInfo as { name?: string; version?: string } | undefined;
    return [true, `${info?.name ?? "?"} ${info?.version ?? ""} · protocol ${String(body.result.protocolVersion)}`];
  });
  await step(`mcp content_get ${SECTION}`, async () => {
    const got = await tool(key, "content_get", { key: SECTION });
    if (!got.ok) return [false, got.message.slice(0, 200)];
    priorSection = { stored: got.value.stored === true, value: got.value.value };
    return [true, `stored: ${String(got.value.stored)} (restored exactly at the end)`];
  });
}

async function editSection(): Promise<void> {
  const at = `/admin/content/${SECTION}`;
  const marker = `Announcement from the end-to-end check ${RUN}`;
  const saved = await step(`edit ${SECTION} (${at})`, async () => {
    const { html, res: got } = await page(admin, at);
    if (got.status !== 200) return [false, `HTTP ${got.status}`];
    const form = formWith(html, "value", at);
    const current = JSON.parse(form.fields.find(([n]) => n === "value")?.[1] ?? "{}") as Record<string, unknown>;
    const res = await submit(admin, at, form, { value: JSON.stringify({ ...current, enabled: true, text: marker }) });
    const body = textOf(await res.text());
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    if (!/Saved/.test(body)) return [false, `no “Saved” in the response${/invalid|must|required/i.test(body) ? " (the section’s schema refused it?)" : ""}`];
    leftovers.set("section", `the ${SECTION} section (reset it, or restore it from /admin/audit)`);
    return [true, "saved through the admin form, without JavaScript"];
  });
  if (!saved) return;
  await step("the edit is live on /", async () => {
    const { res, html } = await page(null, "/");
    return [res.status === 200 && html.includes(marker), res.status === 200 ? (html.includes(marker) ? "the new text is in the first byte" : "the new text isn’t on /") : `HTTP ${res.status}`];
  });
  if (mcpKey) {
    const key = mcpKey;
    await step("mcp content_get sees the edit", async () => {
      const got = await tool(key, "content_get", { key: SECTION });
      const text = (got.value.value as { text?: string } | undefined)?.text;
      return [got.ok && text === marker, got.ok ? `text: “${String(text).slice(0, 60)}”` : got.message.slice(0, 160)];
    });
  }
}

async function publishPost(): Promise<void> {
  const at = "/admin/posts/new";
  const published = await step(`create + publish a post (${at})`, async () => {
    const { html, res: got } = await page(admin, at);
    if (got.status !== 200) return [false, `HTTP ${got.status}`];
    const form = formWith(html, "title", at);
    if (!form.buttons.get("intent")?.includes("publish")) return [false, "the editor has no Publish button (intent=publish)"];
    const res = await submit(
      admin,
      at,
      form,
      {
        title: postTitle,
        slug: postSlug,
        description: `A post the end-to-end check publishes and deletes (${RUN}).`,
        body: `## What this is\n\nThe end-to-end check wrote this post to prove that publishing works. It deletes it again.\n\n- run ${RUN}\n`,
        tags: "e2e",
      },
      ["intent", "publish"],
    );
    const to = res.headers.get("location") ?? "";
    const id = /\/admin\/posts\/([^/?#]+)/.exec(to)?.[1];
    if (!id) {
      const said = textOf(await res.text()).match(/(?:Fix|Pick|That|A post|The slug)[^.]{0,140}\./)?.[0];
      return [false, `HTTP ${res.status}${to ? ` → ${to}` : ""}${said ? `: “${said}”` : ""}`];
    }
    postId = decodeURIComponent(id);
    leftovers.set("post", `the post /blog/${postSlug} (delete it in /admin/posts)`);
    return [true, `published /blog/${postSlug}`];
  });
  if (!published) return;

  await step("the post is on /blog", async () => {
    const { res, html } = await page(null, "/blog");
    return [res.status === 200 && html.includes(postSlug), res.status === 200 ? (html.includes(postSlug) ? "listed on the index" : "missing from the index") : `HTTP ${res.status}`];
  });
  await step("the post page", async () => {
    const { res, html } = await page(null, `/blog/${postSlug}`);
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
    if (!h1 || !textOf(h1).includes(postTitle)) return [false, "no <h1> with the title in the server HTML"];
    if (!/"@type"\s*:\s*"BlogPosting"/.test(html)) return [false, "no BlogPosting JSON-LD in the server HTML"];
    if (!new RegExp(`<link[^>]+rel="canonical"[^>]+/blog/${postSlug}"`).test(html)) return [false, "the canonical doesn’t name the post"];
    return [true, "h1, BlogPosting JSON-LD and canonical in the first byte"];
  });
  for (const [name, path] of [
    ["the post is in the sitemap", "/sitemap.xml"],
    ["the post is in the feed", "/blog/rss.xml"],
    ["the post is in llms.txt", "/llms.txt"],
  ] as const) {
    await step(name, async () => {
      const res = await request(null, path);
      const body = await res.text();
      return [res.status === 200 && body.includes(`/blog/${postSlug}`), res.status === 200 ? (body.includes(`/blog/${postSlug}`) ? path : `not in ${path}`) : `HTTP ${res.status}`];
    });
  }
}

async function contact(): Promise<void> {
  const visitor = new Jar();
  const marker = `Contact message from the end-to-end check ${RUN}.`;
  const sent = await step("contact form (signed out, no JavaScript)", async () => {
    const at = "/contact";
    const { html, res: got } = await page(visitor, at);
    if (got.status !== 200) return [false, `HTTP ${got.status}`];
    const form = formWith(html, "message", at);
    const res = await submit(visitor, at, form, { name: "E2E Visitor", email: `visitor-${RUN}@example.com`, message: `${marker} Safe to ignore.` });
    const body = textOf(await res.text());
    if (res.status === 303) return [/sent=1/.test(res.headers.get("location") ?? ""), `HTTP 303 → ${res.headers.get("location")}`];
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    if (!/Message sent/i.test(body)) return [false, `no “Message sent” in the response${/too many|wait/i.test(body) ? " (rate limited: wait ten minutes)" : ""}`];
    leftovers.set("contact", "a contact message in /admin/feedback (mark it closed)");
    return [true, "“Message sent”"];
  });
  if (!sent) return;
  await step("the message is in /admin/feedback", async () => {
    const { res, html } = await page(admin, "/admin/feedback");
    return [res.status === 200 && html.includes(RUN), res.status === 200 ? (html.includes(RUN) ? "listed in the inbox" : "not in the inbox") : `HTTP ${res.status}`];
  });
}

async function cleanUp(): Promise<void> {
  if (options.keep) {
    record("clean-up", true, "skipped (--keep)", true);
    return;
  }
  // Prefer the run's own key; fall back to the operator's. Both are admin keys.
  const key = mcpKey ?? options.fallbackKey;
  if (postId && key) {
    const id = postId;
    await step("clean-up: delete the post", async () => {
      const done = await tool(key, "post_delete", { id });
      if (!done.ok) return [false, done.message.slice(0, 160)];
      const res = await request(null, `/blog/${postSlug}`);
      await res.body?.cancel();
      if (res.status === 404) leftovers.delete("post");
      return [res.status === 404, `post_delete, then /blog/${postSlug} answers HTTP ${res.status}`];
    });
  }
  if (leftovers.has("section") && key && priorSection) {
    const prior = priorSection as { stored: boolean; value: unknown };
    await step(`clean-up: restore ${SECTION}`, async () => {
      const done = prior.stored
        ? await tool(key, "content_update", { key: SECTION, value: prior.value as Record<string, unknown>, mode: "replace" })
        : await tool(key, "content_reset", { key: SECTION });
      if (!done.ok) return [false, done.message.slice(0, 160)];
      const now = await tool(key, "content_get", { key: SECTION });
      const same = now.ok && now.value.stored === prior.stored && JSON.stringify(now.value.value) === JSON.stringify(prior.value);
      if (same) leftovers.delete("section");
      return [same, prior.stored ? "the stored value is back" : "reset to the default (nothing was stored before)"];
    });
  }
  if (leftovers.has("contact") && key) {
    await step("clean-up: close the contact message", async () => {
      const list = await tool(key, "feedback_list", { kind: "contact", limit: 50 });
      const item = ((list.value.items as { id: string; message?: string }[] | undefined) ?? []).find((f) => f.message?.includes(RUN));
      if (!item) return [false, list.ok ? "not found in feedback_list" : list.message.slice(0, 160)];
      const done = await tool(key, "feedback_update", { id: item.id, status: "closed", adminNote: `End-to-end check ${RUN}: a test message, safe to ignore.` });
      if (done.ok) leftovers.delete("contact");
      return [done.ok, done.ok ? "closed with a note (feedback has no delete, by design)" : done.message.slice(0, 160), done.ok];
    });
  }
  if (accountCreated) {
    await step("clean-up: delete the account", async () => {
      const at = "/dashboard/settings";
      const { html } = await page(admin, at);
      const form = formWith(html, "confirm", at, ["newPassword", "currentPassword"]);
      const res = await submit(admin, at, form, { confirm: options.email });
      const to = res.headers.get("location") ?? "";
      if (res.status < 300 || res.status >= 400) {
        const said = textOf(await res.text()).match(/(?:This is the only admin|The last admin|For your safety|You can’t|Type your email)[^.;]{0,160}[.;]/)?.[0];
        // On a fresh database (CI's) the run's ADMIN_EMAILS account is the site's
        // only admin, and the app refuses to delete the last admin by design
        // (services/users.ts). That refusal is the right answer, not a failure:
        // the account and its key stay, and are listed below as left over.
        if (said?.startsWith("This is the only admin")) {
          return [true, `kept: it is the site’s only admin, which can’t be deleted (by design). Its key stays too`, true];
        }
        return [false, `HTTP ${res.status}${said ? `: “${said}”` : ""}`];
      }
      leftovers.delete("account");
      return [true, `deleted, signed out (→ ${to || "/"})`];
    });
    if (!leftovers.has("account") && mcpKey && mcpKey !== options.fallbackKey) {
      const key = mcpKey;
      await step("clean-up: the minted key is revoked", async () => {
        const { status } = await rpc(key, { jsonrpc: "2.0", id: 99, method: "tools/list" });
        if (status === 401) leftovers.delete("key");
        return [status === 401, `the key now gets HTTP ${status}${status === 401 ? " (revoked with its admin)" : ""}`];
      });
    }
  }
}

async function main(): Promise<void> {
  console.log(`End-to-end on ${options.base} · run ${RUN}\n`);
  const up = await step("site reachable", async () => {
    const res = await request(null, "/api/health");
    await res.body?.cancel();
    return [res.status === 200, `/api/health HTTP ${res.status}`];
  });
  if (!up) return;
  try {
    if (!(await signUp())) return;
    if (!(await becomeAdmin())) return;
    await mintKey();
    await mcpReadSection();
    await editSection();
    await publishPost();
    await contact();
  } finally {
    await cleanUp();
  }
}

function report(): number {
  const failed = results.filter((r) => !r.ok);
  const warned = results.filter((r) => r.ok && r.warn);
  console.log(`\n${results.length - failed.length}/${results.length} passed${warned.length ? `, ${warned.length} warning${warned.length === 1 ? "" : "s"}` : ""}.`);
  if (leftovers.size > 0) {
    console.log(`\nLeft on the site${options.keep ? " (--keep)" : ""}:`);
    for (const what of leftovers.values()) console.log(`  - ${what}`);
  }
  return failed.length === 0 ? 0 : 1;
}

main().then(
  () => exit(report()),
  (error: unknown) => {
    console.error("e2e: crashed:", error);
    report();
    exit(1);
  },
);
