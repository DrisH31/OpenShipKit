//
// npm run smoke — check a running OpenShipKit from the outside, the way a
// visitor, a search engine and an agent see it.
//
//   npm run smoke                                       http://localhost:3000
//   npm run smoke -- https://example.com
//   npm run smoke -- https://example.com --mcp-key osk_…   also initialize + tools/list over MCP, and unlisted posts
//   npm run smoke -- https://example.com --indexnow-key <key>   also the IndexNow key file
//
// Checks: the public pages answer 200 with their content and JSON-LD in the
// server HTML — the core pages below, every other page the sitemap lists
// outside the blog, changelog and legal collections (so a new marketing page
// is checked once it's in STATIC_PATHS), and one blog post; /pricing is one of
// the core pages, except on a server whose /api/health reports the "site"
// profile, where it must be a 404 and absent from the sitemap; feeds, sitemap, robots.txt and llms.txt are well-formed;
// /api/health is ok; /dashboard sends a signed-out visitor to sign-in; /admin
// is not visible signed out; an unknown path is a 404; security headers are
// set; /api/mcp refuses a request without a key (and, with a key,
// initializes and lists tools).
//
// Media and IndexNow: a made-up file under /uploads/ (a well-formed name that
// was never stored, another extension, a dot-file) is a 404 — the public media
// route serves stored images and nothing else. A made-up /<name>.txt is a 404
// too (the IndexNow key file answers only its own name). With
// --indexnow-key <key>, /<key>.txt must answer 200 with exactly the key: the
// engines verify it there, and a mismatch makes every ping a silent 403.
// Smoke can't know the key on its own, so without the flag that check is skipped.
//
// Unlisted posts (with an MCP key that works): which posts are unlisted can't
// be seen from outside, so smoke asks the read-only posts_list tool. Each
// unlisted post or changelog entry (up to 5 of each) must answer 200 without
// noindex, be in the sitemap, the RSS feed and llms-full.txt, and be absent
// from /blog (or /changelog) and the landing page's latest posts. A sitemap
// or feed filtered on `listed` fails nothing else and costs the post its
// rankings weeks later (AGENTS.md, "Rules that cost traffic" 9). Without a
// key, or with none unlisted, it is skipped.
//
// And the failures that cost a template traffic before (AGENTS.md, "Rules
// that cost traffic"), each checked on every public page it loads: exactly
// one <main> (a page that adds its own inside the layout's ships two
// landmarks); no Set-Cookie to an anonymous visitor; a meta description that
// fits a results page (a warning past 160 characters: the end is cut off);
// the og:image of / and of a post answers with an image (a card that 404s
// unfurls as nothing); every internal link on / resolves (a nav link to a
// page that doesn't exist is a 404 crawlers keep finding); and the 404 page is
// noindex with NO canonical (a canonical there declares the dead URL a
// duplicate of another page).
//
// Starter content: once the site is renamed (its og:site_name is no longer
// OpenShipKit's), a starter post or changelog entry still in OpenShipKit's words
// is served noindex and left out of the sitemap, feeds and llms files
// (isStarterContent in src/content/seed-posts.ts). Smoke fetches each starter
// slug and warns, without failing, while any is still live like that.
//
// What a crawler sees, on every public page it checks: no `noindex` (in a
// robots meta tag or an X-Robots-Tag header), and a canonical that is absolute,
// on the site's origin (the sitemap's) and names the page itself (query and
// trailing slash aside). /sign-in and /sign-up must be `noindex` instead.
// Sitemap or canonical URLs on localhost fail when smoke targets a real origin
// (NEXT_PUBLIC_SITE_URL wasn't set); another origin is only a warning (a site
// checked through an internal address behind its proxy).
//
// Settings: SMOKE_URL and SMOKE_MCP_KEY from the shell, else .env.local, else
// .env (never overriding the shell; scripts/load-env.mts, shared by every CLI). Against a localhost URL with no key,
// MCP_DEV_KEY is tried; a development key the server refuses (a production
// build, or a real Postgres) is a warning, not a failure.
//
// Exit code 0 when every check passes, 1 otherwise — use it after a deploy.
// Run with tsx (`npm run smoke`, or `npx tsx scripts/smoke.mts <url>`): it
// imports the shared env loader and the starter slugs from src/content, which
// plain Node type stripping can't resolve. No other dependencies: fetch only.
// Read-only: it never signs in or submits a form; the only tool it calls is
// posts_list, which reads.
//

import { argv, env, exit } from "node:process";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { SEED_POSTS } from "@/content/seed-posts";
import { loadLocalEnv } from "./load-env.mjs";

interface Options {
  base: string;
  mcpKey?: string;
  /** True when mcpKey is MCP_DEV_KEY, tried because nothing else was given. */
  mcpKeyIsDevFallback: boolean;
  /** The site's INDEXNOW_KEY, to check /<key>.txt (only when passed: smoke can't know it). */
  indexNowKey?: string;
  timeoutMs: number;
}

interface Result {
  name: string;
  ok: boolean;
  detail: string;
  /** A warning is reported but doesn't fail the run. */
  warn?: boolean;
}

const HELP = `npm run smoke — check a running OpenShipKit site.

Usage: npm run smoke -- [url] [--mcp-key <key>] [--indexnow-key <key>] [--timeout <ms>]

  url                   the site's origin (default $SMOKE_URL or http://localhost:3000)
  --mcp-key <key>       an agent key: also run MCP initialize + tools/list, and check unlisted
                        posts through the read-only posts_list tool (default $SMOKE_MCP_KEY;
                        against localhost, MCP_DEV_KEY)
  --indexnow-key <key>  the site's INDEXNOW_KEY: check that /<key>.txt answers with it
  --timeout <ms>        per-request timeout (default 30000; a cold dev server compiles on first hit)

SMOKE_URL, SMOKE_MCP_KEY and MCP_DEV_KEY are read from the shell, .env.local or .env.`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

/** True for a loopback origin such as http://localhost:3000. */
function isLocal(url: string): boolean {
  return URL.canParse(url) && LOCAL_HOSTS.has(new URL(url).hostname);
}

function parseArgs(args: string[]): Options {
  loadLocalEnv("smoke");
  let base = env.SMOKE_URL ?? "http://localhost:3000";
  let mcpKey = env.SMOKE_MCP_KEY;
  let indexNowKey: string | undefined;
  let timeoutMs = 30_000;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      exit(0);
    } else if (arg === "--mcp-key") {
      mcpKey = args[++i];
    } else if (arg.startsWith("--mcp-key=")) {
      mcpKey = arg.slice("--mcp-key=".length);
    } else if (arg === "--indexnow-key") {
      indexNowKey = args[++i];
    } else if (arg.startsWith("--indexnow-key=")) {
      indexNowKey = arg.slice("--indexnow-key=".length);
    } else if (arg === "--timeout") {
      timeoutMs = Number(args[++i]);
    } else if (!arg.startsWith("-")) {
      base = arg;
    } else {
      console.error(`smoke: unknown option ${arg} (try --help)`);
      exit(2);
    }
  }
  if (!/^https?:\/\/[^/\s]+/.test(base)) {
    console.error(`smoke: "${base}" is not a URL like https://example.com`);
    exit(2);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 30_000;
  let mcpKeyIsDevFallback = false;
  if (!mcpKey && isLocal(base) && env.MCP_DEV_KEY) {
    mcpKey = env.MCP_DEV_KEY;
    mcpKeyIsDevFallback = true;
  }
  return { base: base.replace(/\/+$/, ""), mcpKey: mcpKey || undefined, mcpKeyIsDevFallback, indexNowKey: indexNowKey?.trim() || undefined, timeoutMs };
}

const options = parseArgs(argv.slice(2));
const results: Result[] = [];

function record(name: string, ok: boolean, detail: string, warn = false): void {
  results.push({ name, ok, detail, warn });
}

async function get(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${options.base}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs),
    headers: { "user-agent": "openshipkit-smoke/1.0", ...(init.headers ?? {}) },
    ...init,
  });
}

/** Run one check; a thrown error (timeout, refused connection) is a failure, not a crash. */
async function check(name: string, run: () => Promise<[boolean, string] | [boolean, string, boolean]>): Promise<void> {
  try {
    const [ok, detail, warn] = await run();
    record(name, ok, detail, warn ?? false);
  } catch (error) {
    const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    const why = e.name === "TimeoutError" ? `timed out after ${options.timeoutMs} ms` : (e.cause?.code ?? e.cause?.message ?? e.message ?? String(error));
    record(name, false, why);
  }
}

/** Every <script type="application/ld+json"> block, parsed. Throws on invalid JSON. */
function jsonLd(html: string): unknown[] {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  return blocks.map((m) => JSON.parse(m[1]));
}

/** The @type values in JSON-LD, including inside @graph arrays. */
function ldTypes(blocks: unknown[]): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n["@type"] === "string") out.push(n["@type"]);
    if (Array.isArray(n["@type"])) out.push(...n["@type"].filter((t): t is string => typeof t === "string"));
    if (n["@graph"]) visit(n["@graph"]);
  };
  blocks.forEach(visit);
  return out;
}

/** Paths `page()` has already checked, so the sitemap pass doesn't repeat them. */
const checkedPages = new Set<string>();

/** The site's public origin: the sitemap's (NEXT_PUBLIC_SITE_URL), or the smoke URL's until the sitemap is read. */
let siteOrigin = new URL(options.base).origin;

/** Pages that must stay out of search results. */
const NOINDEX_PATHS = new Set(["/sign-in", "/sign-up"]);

/** The attributes of every `<tag …>` in the HTML (names lower-cased; values unquoted and entity-decoded for &amp;). */
function tags(html: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "gi"))) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[a[1].toLowerCase()] = (a[2] ?? a[3] ?? a[4] ?? "").replace(/&amp;/g, "&");
    }
    out.push(attrs);
  }
  return out;
}

/** A path without its trailing slash ("/" stays "/"). */
const bare = (path: string): string => path.replace(/\/+$/, "") || "/";

/** Every robots directive the page sends: robots/googlebot/bingbot meta tags and the X-Robots-Tag header, comma-joined. */
function robotsDirectives(html: string, res: Response): string {
  return [
    ...tags(html, "meta")
      .filter((m) => /^(robots|googlebot|bingbot)$/i.test(m.name ?? ""))
      .map((m) => m.content ?? ""),
    res.headers.get("x-robots-tag") ?? "",
  ].join(", ");
}

/** True when the directives keep the page out of search results. */
const isNoindex = (robots: string): boolean => /\b(noindex|none)\b/i.test(robots);

/**
 * What a crawler is told about the page: null when it's right, otherwise the
 * problem. Public pages: indexable, with an absolute canonical naming this page
 * on the site's origin. NOINDEX_PATHS: noindex.
 */
function crawlerProblem(path: string, html: string, res: Response): string | null {
  const robots = robotsDirectives(html, res);
  const noindex = isNoindex(robots);
  if (NOINDEX_PATHS.has(bare(path))) return noindex ? null : "should be noindex (an auth page in search results)";
  if (noindex) return `noindex on a public page (robots: “${robots.replace(/^[,\s]+|[,\s]+$/g, "")}”)`;

  const canonical = tags(html, "link").find((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))?.href;
  if (!canonical) return "no <link rel=canonical>";
  if (!/^https?:\/\//i.test(canonical) || !URL.canParse(canonical)) return `canonical “${canonical}” is not an absolute URL`;
  const url = new URL(canonical);
  if (isLocal(url.origin) && !isLocal(options.base)) return `canonical is on ${url.origin} — set NEXT_PUBLIC_SITE_URL to the public origin`;
  if (url.origin !== siteOrigin) return `canonical is on ${url.origin}, the sitemap on ${siteOrigin}`;
  const want = bare(new URL(path, siteOrigin).pathname);
  if (bare(url.pathname) !== want) return `canonical points at ${url.pathname}, not ${want}`;
  return null;
}

async function page(path: string, needs: { jsonLd?: boolean } = {}): Promise<void> {
  checkedPages.add(path);
  await check(`page ${path}`, async () => {
    const res = await get(path);
    if (res.status !== 200) return [false, `HTTP ${res.status}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}`];
    const html = await res.text();
    const title = /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1]?.trim();
    if (!title) return [false, "no <title>"];
    if (!/<h1[\s>]/.test(html)) return [false, "no <h1> in the server HTML"];
    if (!/<meta[^>]+name="description"/.test(html)) return [false, "no meta description"];
    let types: string[] = [];
    try {
      types = ldTypes(jsonLd(html));
    } catch {
      return [false, "a JSON-LD block is not valid JSON"];
    }
    if (needs.jsonLd && types.length === 0) return [false, "no JSON-LD in the server HTML"];
    const crawler = crawlerProblem(path, html, res);
    if (crawler) return [false, crawler];
    const mains = (html.match(/<main[\s>]/g) ?? []).length;
    if (mains > 1) return [false, `${mains} <main> elements (a page inside the layout must not add its own)`];
    const cookies = res.headers.getSetCookie();
    if (cookies.length > 0) return [false, `sets ${cookies.length} cookie${cookies.length === 1 ? "" : "s"} for an anonymous visitor (${cookies.map((c) => c.split("=")[0]).join(", ")})`];
    const summary = `“${title.slice(0, 60)}”${types.length ? ` · JSON-LD: ${[...new Set(types)].join(", ")}` : ""}`;
    const description = decodeEntities(tags(html, "meta").find((m) => (m.name ?? "").toLowerCase() === "description")?.content ?? "");
    if (description.length > DESCRIPTION_MAX && !NOINDEX_PATHS.has(bare(path))) {
      return [true, `${summary} · meta description is ${description.length} characters: results pages cut it near ${DESCRIPTION_MAX} — say the claim first, or shorten it`, true];
    }
    if (mains === 0) return [true, `${summary} · no <main> landmark`, true];
    return [true, summary];
  });
}

/** Where results pages cut a description off (characters, roughly; Google measures pixels). */
const DESCRIPTION_MAX = 160;

/** The few entities a meta content attribute carries, decoded, so lengths count characters. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(quot|apos|lt|gt|nbsp);/g, (_, n: string) => ({ quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0" })[n] ?? "")
    .replace(/&amp;/g, "&");
}

/** The og:image of a page, as a path on the smoke origin (its origin is the site's public one). */
async function ogImage(path: string): Promise<void> {
  await check(`og:image ${path}`, async () => {
    const res = await get(path);
    if (res.status !== 200) return [false, `the page answered HTTP ${res.status}`];
    const image = tags(await res.text(), "meta").find((m) => m.property === "og:image")?.content;
    if (!image) return [false, "no og:image"];
    if (!URL.canParse(image, siteOrigin)) return [false, `og:image “${image}” isn’t a URL`];
    const url = new URL(image, siteOrigin);
    const img = await get(`${url.pathname}${url.search}`);
    const type = img.headers.get("content-type") ?? "";
    await img.body?.cancel();
    return [img.status === 200 && type.startsWith("image/"), `${url.pathname} → HTTP ${img.status} ${type.split(";")[0]}`];
  });
}

/**
 * Every same-site link on the home page resolves (2xx or a redirect): the nav,
 * the footer and the body copy. A link to a page that doesn't exist is a 404
 * a crawler finds on every page that carries the nav.
 */
async function homeLinks(): Promise<void> {
  await check("links on / resolve", async () => {
    const res = await get("/");
    const html = await res.text();
    const paths = new Set<string>();
    for (const a of tags(html, "a")) {
      const href = a.href ?? "";
      if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
      if (!URL.canParse(href, siteOrigin)) continue;
      const url = new URL(href, siteOrigin);
      if (url.origin !== siteOrigin && url.origin !== new URL(options.base).origin) continue;
      if (url.pathname.startsWith("/api/")) continue;
      paths.add(url.pathname);
    }
    const broken: string[] = [];
    for (const path of [...paths].slice(0, 60)) {
      const r = await get(path);
      await r.body?.cancel();
      if (r.status >= 400) broken.push(`${path} (HTTP ${r.status})`);
    }
    return [broken.length === 0, broken.length ? `broken: ${broken.join(", ")}` : `${Math.min(paths.size, 60)} internal links, all answer`];
  });
}

/**
 * The profile the server reports in /api/health (`stack.profile`). A server
 * from before the profile existed reports none: treat it as "saas", which is
 * what it is.
 */
async function serverProfile(): Promise<string> {
  try {
    const res = await get("/api/health");
    const body = (await res.json()) as { stack?: { profile?: unknown } };
    return typeof body.stack?.profile === "string" ? body.stack.profile : "saas";
  } catch {
    return "saas";
  }
}

/**
 * /pricing is a page under the saas profile and must not exist under "site"
 * (docs/site-profile.md): a 404, and absent from the sitemap. Checking it
 * unconditionally failed every smoke run against a content site.
 */
async function pricing(sitemapLocs: string[]): Promise<void> {
  const profile = await serverProfile();
  if (profile !== "site") {
    await page("/pricing", { jsonLd: true });
    return;
  }
  await check("no /pricing (site profile)", async () => {
    const res = await get("/pricing");
    await res.body?.cancel();
    if (res.status !== 404) return [false, `HTTP ${res.status} — /pricing should be a 404 under OPENSHIPKIT_PROFILE=site`];
    const listed = sitemapLocs.some((l) => URL.canParse(l) && bare(new URL(l).pathname) === "/pricing");
    return listed ? [false, "HTTP 404, but the sitemap lists /pricing"] : [true, "HTTP 404, not in the sitemap"];
  });
}

async function text(path: string, name: string, test: (body: string, res: Response) => string | null): Promise<string | null> {
  let body: string | null = null;
  await check(name, async () => {
    const res = await get(path);
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    body = await res.text();
    const problem = test(body, res);
    return problem ? [false, problem] : [true, `${res.headers.get("content-type")?.split(";")[0] ?? "?"} · ${body.length} bytes`];
  });
  return body;
}

async function main(): Promise<void> {
  console.log(`Smoke-testing ${options.base}\n`);

  // Reachability first: if this fails nothing else will pass.
  await check("site reachable", async () => {
    const res = await get("/");
    return [res.status < 500, `HTTP ${res.status}`];
  });
  if (!results[0].ok) return;

  // The sitemap first: its origin is the site's public one, which every canonical must use.
  const sitemap = await text("/sitemap.xml", "sitemap.xml", (b) => (/<urlset[\s>]/.test(b) && /<loc>/.test(b) ? null : "no <urlset>/<loc>"));
  const locs = sitemap ? [...(sitemap as string).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()) : [];
  if (sitemap) {
    await check("sitemap origins", async () => {
      const origins = [...new Set(locs.map((l) => (URL.canParse(l) ? new URL(l).origin : l)))];
      const expected = new URL(options.base).origin;
      if (origins.length === 1 && URL.canParse(origins[0])) siteOrigin = origins[0];
      if (origins.length === 1 && origins[0] === expected) return [true, `${locs.length} URLs on ${expected}`];
      if (origins.length !== 1) return [false, `URLs use ${origins.length} origins: ${origins.join(", ")}`];
      // localhost URLs on a real site: NEXT_PUBLIC_SITE_URL was never set, so every canonical and feed is wrong too.
      if (isLocal(origins[0]) && !isLocal(expected)) return [false, `URLs use ${origins[0]} — set NEXT_PUBLIC_SITE_URL to ${expected}`];
      // A different origin is right when the site sits behind a proxy and NEXT_PUBLIC_SITE_URL is the public one.
      return [true, `URLs use ${origins.join(", ")} (smoke ran against ${expected}) — check NEXT_PUBLIC_SITE_URL`, true];
    });
  }

  // Public pages: content and structured data in the first byte, and what a crawler is told.
  await page("/", { jsonLd: true });
  await pricing(locs);
  await page("/blog", { jsonLd: true });
  await page("/changelog");
  await page("/contact");
  await page("/sign-in");
  await page("/sign-up");

  // Feeds and crawler files.
  await text("/blog/rss.xml", "feed /blog/rss.xml", (b) => (/<rss[\s>]/.test(b) && /<channel>/.test(b) ? null : "not an RSS document"));
  await text("/changelog/rss.xml", "feed /changelog/rss.xml", (b) => (/<rss[\s>]/.test(b) ? null : "not an RSS document"));
  await text("/robots.txt", "robots.txt", (b) => (/^sitemap:\s*\S+/im.test(b) ? null : "no Sitemap: line"));
  await text("/llms.txt", "llms.txt", (b) => (/^# \S/.test(b.trimStart()) ? null : "doesn’t start with a # title"));
  await text("/llms-full.txt", "llms-full.txt", (b) => (b.trim().length > 0 ? null : "empty"));

  if (sitemap) {
    // Every other listed page outside the collections (a page added to
    // STATIC_PATHS lands here), fetched from the smoke origin by its path.
    // Collection entries can run to thousands, so one blog post stands for them.
    const paths = [...new Set(locs.flatMap((l) => (URL.canParse(l) ? [new URL(l).pathname] : [])))];
    for (const path of paths) {
      if (/^\/(blog|changelog|legal)\//.test(path) || checkedPages.has(path)) continue;
      await page(path);
    }
    const post = paths.find((p) => /^\/blog\/(?!tag\/|rss)[^/]+$/.test(p));
    if (post) await page(post, { jsonLd: true });
  }

  await starterContent();
  await ogImage("/");
  if (sitemap) {
    const post = locs.map((l) => (URL.canParse(l) ? new URL(l).pathname : "")).find((p) => /^\/blog\/(?!tag\/|rss)[^/]+$/.test(p));
    if (post) await ogImage(post);
  }
  await homeLinks();
  await uploadsAndKeyFile();

  // Health.
  await check("api/health", async () => {
    const res = await get("/api/health");
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    const body = (await res.json()) as Record<string, unknown>;
    return [body.ok === true || body.status === "ok", JSON.stringify(body).slice(0, 120)];
  });

  // Signed-out boundaries.
  await check("dashboard needs sign-in", async () => {
    const res = await get("/dashboard");
    const to = res.headers.get("location") ?? "";
    return [res.status >= 300 && res.status < 400 && /\/sign-in/.test(to), `HTTP ${res.status}${to ? ` → ${to}` : ""}`];
  });
  await check("admin hidden signed out", async () => {
    const res = await get("/admin");
    const to = res.headers.get("location") ?? "";
    const hidden = res.status === 404 || (res.status >= 300 && res.status < 400 && /\/sign-in/.test(to));
    return [hidden, `HTTP ${res.status}${to ? ` → ${to}` : ""}`];
  });
  await check("unknown path is 404", async () => {
    const res = await get("/this-page-does-not-exist-smoke");
    if (res.status !== 404) return [false, `HTTP ${res.status}`];
    const html = await res.text();
    if (!isNoindex(robotsDirectives(html, res))) return [false, "HTTP 404, but not noindex"];
    const canonical = tags(html, "link").some((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"));
    return [!canonical, canonical ? "HTTP 404 with a canonical (it inherits one from a layout?)" : "HTTP 404, noindex, no canonical"];
  });

  // Headers from next.config.ts.
  await check("security headers", async () => {
    const res = await get("/");
    const h = res.headers;
    const missing = ["x-content-type-options", "referrer-policy", "x-frame-options"].filter((k) => !h.get(k));
    if (h.get("x-powered-by")) missing.push("(x-powered-by should be off)");
    const https = options.base.startsWith("https://");
    if (https && !h.get("strict-transport-security")) missing.push("strict-transport-security");
    return [missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `ok${https ? " (with HSTS)" : ""}`];
  });

  // MCP.
  await check("mcp refuses no key", async () => {
    const res = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    return [res.status === 401, `HTTP ${res.status}`];
  });
  if (options.mcpKey && (await mcpSession(options.mcpKey, options.mcpKeyIsDevFallback))) {
    await unlistedPosts(options.mcpKey, sitemap ? new Set(locs.flatMap((l) => (URL.canParse(l) ? [bare(new URL(l).pathname)] : []))) : null);
  }
}

/** IndexNow's key format (src/server/services/indexnow.ts). */
const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/**
 * /uploads/ serves stored images and nothing else, and the IndexNow key file
 * answers only its own name (see the header). With --indexnow-key, the key
 * file answers with exactly the key.
 */
async function uploadsAndKeyFile(): Promise<void> {
  await check("uploads: made-up files are 404", async () => {
    const probes = [
      "/uploads/2000/01/00000000000000000000000000000000.png", // the stored-name shape, never stored
      "/uploads/2000/01/smoke.html", // an extension outside the allow-list
      "/uploads/.smoke", // a dot-file
    ];
    const wrong: string[] = [];
    for (const path of probes) {
      const res = await get(path);
      await res.body?.cancel();
      if (res.status !== 404) wrong.push(`${path} → HTTP ${res.status}`);
    }
    return [wrong.length === 0, wrong.length ? wrong.join(", ") : `${probes.length} made-up paths, all 404`];
  });
  await check("key file: a made-up name is 404", async () => {
    const res = await get("/smoke-not-the-indexnow-key.txt");
    await res.body?.cancel();
    return [res.status === 404, `HTTP ${res.status}`];
  });
  const key = options.indexNowKey;
  if (!key) return;
  await check("indexnow key file", async () => {
    if (!INDEXNOW_KEY_PATTERN.test(key)) return [false, "--indexnow-key must be 8–128 characters of A–Z, a–z, 0–9 or '-' (the app turns IndexNow off otherwise)"];
    const res = await get(`/${key}.txt`);
    if (res.status !== 200) return [false, `/<key>.txt → HTTP ${res.status}: is INDEXNOW_KEY set to this key on the server, and the next.config.ts rewrite in place?`];
    const body = (await res.text()).trim();
    if (body !== key) return [false, "/<key>.txt answers, but not with the key: engines refuse every ping (403)"];
    return [true, `/<key>.txt answers with the key · ${res.headers.get("content-type")?.split(";")[0] ?? "?"}`];
  });
}

/** The starter posts and changelog entry (src/content/seed-posts.ts), as public paths. */
const STARTER_PATHS = SEED_POSTS.filter((p) => p.kind === "post" || p.kind === "changelog").map((p) => `/${p.kind === "post" ? "blog" : "changelog"}/${p.slug}`);

/**
 * Warn while a renamed site still serves starter posts in OpenShipKit's words.
 * The app marks exactly those noindex (isStarterContent, on a site whose name
 * isn't the showcase's), so a starter slug answering 200 with noindex is one.
 * Never a failure: the posts do no SEO harm, they just aren't yours.
 */
async function starterContent(): Promise<void> {
  await check("starter content", async () => {
    const home = await get("/");
    const meta = tags(await home.text(), "meta");
    const name = (meta.find((m) => m.property === "og:site_name") ?? meta.find((m) => m.name === "application-name"))?.content?.trim();
    if (!name) return [true, "no og:site_name on / — can’t tell whether the site is renamed", true];
    if (name === DEFAULT_CONTENT.site.name) return [true, `the site is still named ${name} (the showcase), so the starter posts are its own`];
    const live: string[] = [];
    const unchecked: string[] = [];
    for (const path of STARTER_PATHS) {
      const res = await get(path);
      if (res.status === 200) {
        if (isNoindex(robotsDirectives(await res.text(), res))) live.push(path);
      } else if (res.status !== 404) {
        unchecked.push(`${path} HTTP ${res.status}`);
      }
    }
    const also = unchecked.length ? ` (couldn’t check ${unchecked.join(", ")})` : "";
    if (live.length === 0) return [true, `renamed to “${name}”; no starter post is still live${also}`, unchecked.length > 0];
    const n = live.length;
    return [
      true,
      `${n} starter post${n === 1 ? " is" : "s are"} still OpenShipKit’s text: noindex and out of the sitemap, feeds and llms files; rewrite or delete ${n === 1 ? "it" : "them"} (${live.join(", ")})${also}`,
      true,
    ];
  });
}

async function mcp(message: unknown, key?: string): Promise<Response> {
  return get("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(message),
  });
}

/** A JSON-RPC reply body: plain JSON, or the first `data:` event of an SSE stream. */
async function rpcBody(res: Response): Promise<{ result?: Record<string, unknown>; error?: { message?: string } }> {
  const raw = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? (raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}")
    : raw;
  return JSON.parse(json) as { result?: Record<string, unknown>; error?: { message?: string } };
}

/** Initialize and list tools. True when the key works (so tool calls can follow). */
async function mcpSession(key: string, devFallback: boolean): Promise<boolean> {
  let refused = false;
  let working = false;
  await check(devFallback ? "mcp initialize (MCP_DEV_KEY)" : "mcp initialize", async () => {
    const res = await mcp(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openshipkit-smoke", version: "1.0.0" } } },
      key,
    );
    // MCP_DEV_KEY only works in development on the embedded database: refused elsewhere, by design.
    if (devFallback && res.status === 401) {
      refused = true;
      return [true, "MCP_DEV_KEY refused (a production build or a real Postgres ignores it) — pass --mcp-key <key>", true];
    }
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    const body = await rpcBody(res);
    if (body.error) return [false, body.error.message ?? "JSON-RPC error"];
    const info = body.result?.serverInfo as { name?: string; version?: string } | undefined;
    return [Boolean(body.result?.protocolVersion), `${info?.name ?? "?"} ${info?.version ?? ""} · protocol ${String(body.result?.protocolVersion)}`];
  });
  if (refused) return false;
  await check("mcp tools/list", async () => {
    await mcp({ jsonrpc: "2.0", method: "notifications/initialized" }, key);
    const res = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, key);
    if (res.status !== 200) return [false, `HTTP ${res.status}`];
    const body = await rpcBody(res);
    if (body.error) return [false, body.error.message ?? "JSON-RPC error"];
    const tools = (body.result?.tools ?? []) as { name: string }[];
    const names = tools.map((t) => t.name);
    working = names.includes("posts_list");
    return [tools.length > 0, `${tools.length} tools: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}`];
  });
  return working;
}

/** What posts_list returns per item (src/server/mcp/tools/shared.ts, postSummary). */
interface PostSummary {
  kind: string;
  slug: string;
  url: string;
}

/** The published, unlisted items of one kind, newest first (at most `limit`), through the read-only posts_list tool. */
async function listUnlisted(key: string, kind: "post" | "changelog", limit: number): Promise<PostSummary[]> {
  const res = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "posts_list", arguments: { kind, status: "published", listed: false, limit } } }, key);
  if (res.status !== 200) throw new Error(`posts_list → HTTP ${res.status}`);
  const body = await rpcBody(res);
  if (body.error) throw new Error(`posts_list: ${body.error.message ?? "JSON-RPC error"}`);
  const result = body.result as { isError?: boolean; structuredContent?: { items?: PostSummary[]; message?: string } } | undefined;
  if (result?.isError) throw new Error(`posts_list: ${result.structuredContent?.message ?? "refused"}`);
  return result?.structuredContent?.items ?? [];
}

/** The same-site paths an HTML fragment links to. */
function linkedPaths(html: string): Set<string> {
  const out = new Set<string>();
  for (const a of tags(html, "a")) {
    const href = a.href ?? "";
    if (!href || !URL.canParse(href, siteOrigin)) continue;
    const url = new URL(href, siteOrigin);
    if (url.origin === siteOrigin || url.origin === new URL(options.base).origin) out.add(bare(url.pathname));
  }
  return out;
}

/** `text` matched literally inside a RegExp. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The HTML of the page's <main> (the list itself, not the header and footer, which may link anything). */
function mainOf(html: string): string {
  return /<main\b[\s\S]*?<\/main>/.exec(html)?.[0] ?? html;
}

/** The landing page's latest-posts band, or "" when it isn't shown. */
function latestPostsOf(html: string): string {
  const at = html.indexOf('aria-labelledby="latest-posts-title"');
  if (at < 0) return "";
  const end = html.indexOf("</section>", at);
  return html.slice(at, end < 0 ? undefined : end);
}

/**
 * Unlisted is "live but not promoted" (docs/seo.md, "Unlisted is not hidden"):
 * each unlisted item answers 200 without noindex and is in the sitemap, its
 * RSS feed and llms-full.txt, but not on its list page or the landing page.
 * A starter item a renamed site hides (noindex, out of the sitemap) is the
 * starter rule, not this one: skipped here, warned about above.
 */
async function unlistedPosts(key: string, sitemapPaths: Set<string> | null): Promise<void> {
  for (const kind of ["post", "changelog"] as const) {
    const listPath = kind === "post" ? "/blog" : "/changelog";
    await check(`unlisted ${kind === "post" ? "posts" : "changelog entries"}`, async () => {
      const items = await listUnlisted(key, kind, 5);
      if (items.length === 0) return [true, `none unlisted — nothing to check`];
      const [feedRes, fullRes, listRes] = await Promise.all([get(`${listPath}/rss.xml`), get("/llms-full.txt"), get(listPath)]);
      const feed = feedRes.status === 200 ? await feedRes.text() : null;
      const full = fullRes.status === 200 ? await fullRes.text() : null;
      const listed = linkedPaths(mainOf(await listRes.text()));
      const promoted = kind === "post" ? linkedPaths(latestPostsOf(await (await get("/")).text())) : new Set<string>();
      // The feed carries the newest 50 (src/components/seo/rss.ts): an older unlisted item can be absent for that reason alone.
      const feedFull = feed !== null && (feed.match(/<item>/g) ?? []).length >= 50;
      const problems: string[] = [];
      let skipped = 0;
      for (const item of items) {
        const path = bare(URL.canParse(item.url) ? new URL(item.url).pathname : `${listPath}/${item.slug}`);
        const res = await get(path);
        const html = res.status === 200 ? await res.text() : "";
        if (res.status !== 200) {
          problems.push(`${path} → HTTP ${res.status} (unlisted must stay live)`);
          continue;
        }
        if (isNoindex(robotsDirectives(html, res))) {
          if (STARTER_PATHS.includes(path)) {
            skipped++;
            continue;
          }
          problems.push(`${path} is noindex (unlisted must stay indexable)`);
        }
        if (sitemapPaths && !sitemapPaths.has(path)) problems.push(`${path} is missing from the sitemap`);
        // The absolute URL, not followed by more of a slug (/blog/a must not match /blog/a-b).
        const url = new RegExp(`${escapeRegExp(`${siteOrigin}${path}`)}(?![\\w-])`);
        const linked = (text: string | null) => text !== null && url.test(text);
        if (feed !== null && !linked(feed) && !feedFull) problems.push(`${path} is missing from ${listPath}/rss.xml`);
        if (full !== null && !linked(full)) problems.push(`${path} is missing from llms-full.txt`);
        if (listed.has(path)) problems.push(`${path} is listed on ${listPath}`);
        if (promoted.has(path)) problems.push(`${path} is in the landing page’s latest posts`);
      }
      if (feed === null) problems.push(`${listPath}/rss.xml → HTTP ${feedRes.status}`);
      if (full === null) problems.push(`llms-full.txt → HTTP ${fullRes.status}`);
      const checked = items.length - skipped;
      const also = skipped ? ` (${skipped} hidden starter item${skipped === 1 ? "" : "s"} skipped)` : "";
      if (problems.length) return [false, problems.join("; ")];
      return [true, `${checked} checked: live, indexable, in the sitemap, feed and llms-full.txt, off ${listPath}${kind === "post" ? " and the landing page" : ""}${also}`];
    });
  }
}

function report(): number {
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const mark = !r.ok ? "FAIL" : r.warn ? "warn" : " ok ";
    console.log(`  [${mark}] ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  const warned = results.filter((r) => r.ok && r.warn);
  console.log(`\n${results.length - failed.length}/${results.length} passed${warned.length ? `, ${warned.length} warning${warned.length === 1 ? "" : "s"}` : ""}.`);
  if (!options.mcpKey) console.log("(Pass --mcp-key <key>, or set SMOKE_MCP_KEY, to also check MCP initialize and tools/list.)");
  return failed.length === 0 ? 0 : 1;
}

main().then(
  () => exit(report()),
  (error: unknown) => {
    console.error("smoke: crashed:", error);
    exit(1);
  },
);
