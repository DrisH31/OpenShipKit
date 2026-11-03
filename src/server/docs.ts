import "server-only";

//
// The /docs pages: the repository's own docs/*.md (and docs/modules/*.md),
// read from disk and rendered here, so the website and GitHub show the same
// words from the same files. Nothing is copied or generated at build time.
//
// Files and slugs. A page's slug is its file name without ".md", relative to
// docs/: "deployment.md" → "deployment", "modules/ai.md" → "modules/ai". A
// README is its folder's index: docs/README.md is /docs, docs/modules/README.md
// is /docs/modules. A request names a slug, never a path: it must match SLUG
// and be one of the files listed at load, so "../" or an unlisted file is a
// 404 before anything touches the disk.
//
// Title and description: a page's title is its first "# " heading, its
// description the first paragraph after it (Markdown stripped). The order and
// groups come from docs/nav.json ([{ "group": "Start", "items": ["getting-started", …] }];
// a folder's README may be named either way, "modules/README" or "modules");
// a page it doesn't list joins a last "More" group, so nothing is unreachable,
// and with no nav.json the pages are listed alphabetically.
//
// Links are rewritten so the same Markdown works in both places:
// "deployment.md#migrations" → /docs/deployment#migrations; a file elsewhere in
// the repository ("../deploy/vps/README.md", "../src/proxy.ts") → that file on
// GitHub (tree/ for a folder); docs/images/* → the raw file on GitHub (the
// Docker image leaves docs/images out, see .dockerignore).
//
// The build tracer: docs/ is a static folder under process.cwd(), and every
// read carries /*turbopackIgnore: true*/ (AGENTS.md: a path the tracer can't
// pin down makes it copy the whole project into .next/standalone). The files
// reach the standalone server through outputFileTracingIncludes in
// next.config.ts instead — the Markdown and nav.json, nothing else — and CI
// checks that .next/standalone/docs holds exactly those.
//
// Gating: OpenShipKit's docs describe OpenShipKit, so they're published only
// while the site is the showcase (isShowcase) or OPENSHIPKIT_PUBLIC_DOCS=true.
// A renamed fork serves 404 at /docs and lists none of it (sitemap, llms.txt).
//
// Cached per process in production (the files can't change under a running
// server); re-read on every request in development, so an edit shows at once.
//

import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { getSiteSeo } from "@/components/seo/site-seo";
import { isProduction, publicDocs, siteUrl } from "@/server/env";
import { renderMarkdownHighlighted, type RenderedMarkdown } from "@/server/markdown";
import { OPENSHIPKIT_NAME, OPENSHIPKIT_REPO, repoPath } from "@/shared/project";
import { log } from "@/server/log";

/** A page's slug: lowercase words, at most one folder deep ("deployment", "modules/ai"). "" is the index. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}(?:\/[a-z0-9][a-z0-9-]{0,60})?$/;

/** The folders under docs/ whose Markdown is published. Static, so the tracer sees exact paths. */
const FOLDERS = ["", "modules"] as const;

/** The group a page joins when nav.json doesn't list it. */
const MORE_GROUP = "More";

export interface DocEntry {
  /** "" for docs/README.md, "deployment", "modules/ai", "modules" (docs/modules/README.md). */
  slug: string;
  /** Path under docs/: "deployment.md", "modules/README.md". */
  file: string;
  title: string;
  description: string;
}

export interface DocsNavGroup {
  group: string;
  items: DocEntry[];
}

export interface DocsIndex {
  /** Every page by slug, the index ("") included. */
  bySlug: Map<string, DocEntry>;
  /** The sidebar: groups in nav.json order (the index isn't in it). */
  nav: DocsNavGroup[];
  /** The sidebar flattened, for prev/next and the sitemap. */
  order: DocEntry[];
}

export interface DocPage {
  entry: DocEntry;
  /** The body without its "# " title. */
  markdown: string;
  /** The body without its title and its opening paragraph, when one opens it (else null). */
  afterLead: string | null;
}

// ── pure helpers (tested in tests/docs.test.ts) ────────────────────────────

/** A file under docs/ → its slug: "README.md" → "", "modules/README.md" → "modules", "modules/ai.md" → "modules/ai". */
export function slugForFile(file: string): string {
  const bare = file.replace(/\.md$/i, "");
  if (bare === "README") return "";
  return bare.replace(/\/README$/, "");
}

/** Is this a well-formed slug? (Whether it names a page is the index's question.) */
export function isValidSlug(slug: string): boolean {
  return slug === "" || SLUG.test(slug);
}

/** The site path of a page: "" → "/docs", "modules/ai" → "/docs/modules/ai". */
export function docsPath(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

/** Inline Markdown → plain text, for a description: links keep their words, code its text, emphasis goes. */
export function markdownToText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a doc into its title (the first "# " heading), its description (the
 * first plain paragraph after it, as text) and its body (everything but the
 * title). `afterLead` is the body without that paragraph when the paragraph
 * opens it (the /docs index shows it as the lead), else null. Headings inside
 * fenced code are not headings.
 */
export function parseDoc(
  markdown: string,
  fallbackTitle: string,
): { title: string; description: string; body: string; afterLead: string | null } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fence: string | null = null;
  let titleAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0] ?? null;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (!fence && /^#\s+\S/.test(line)) {
      titleAt = i;
      break;
    }
  }
  const title = titleAt >= 0 ? markdownToText((lines[titleAt] ?? "").replace(/^#\s+/, "").replace(/\s+#+\s*$/, "")) : fallbackTitle;
  const bodyLines = titleAt >= 0 ? [...lines.slice(0, titleAt), ...lines.slice(titleAt + 1)] : lines;
  const body = bodyLines.join("\n").replace(/^\s*\n/, "");

  // The first paragraph: consecutive prose lines, skipping blank lines, HTML comments,
  // badges, quotes, tables, lists, headings and code before it.
  const rest = titleAt >= 0 ? lines.slice(titleAt + 1) : lines;
  const para: string[] = [];
  let paraStart = -1;
  let paraEnd = rest.length;
  let blockBefore = false;
  let inComment = false;
  fence = null;
  for (let i = 0; i < rest.length; i++) {
    const line = rest[i] ?? "";
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes("-->")) inComment = false;
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) inComment = true;
      if (para.length) break;
      continue;
    }
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker || fence) {
      if (para.length) {
        paraEnd = i;
        break;
      }
      if (marker) fence = fence ? (marker[0] === fence ? null : fence) : (marker[0] ?? null);
      blockBefore = true;
      continue;
    }
    if (!trimmed) {
      if (para.length) {
        paraEnd = i;
        break;
      }
      continue;
    }
    const block = /^(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|<|!\[|\[!\[)/.test(trimmed);
    if (block) {
      if (para.length) {
        paraEnd = i;
        break;
      }
      blockBefore = true;
      continue;
    }
    if (paraStart < 0) paraStart = i;
    para.push(trimmed);
  }
  const afterLead =
    paraStart >= 0 && !blockBefore
      ? [...lines.slice(0, Math.max(titleAt, 0)), ...rest.slice(paraEnd)].join("\n").replace(/^\s*\n/, "")
      : null;
  return { title, description: markdownToText(para.join(" ")), body, afterLead };
}

/** The repository's raw file host, for images ("https://raw.githubusercontent.com/<owner>/<repo>/main/"). */
function rawBase(): string {
  return `${OPENSHIPKIT_REPO.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/`;
}

/** Extension-less files that are files, not folders, on GitHub. */
const PLAIN_FILES = new Set(["Dockerfile", "LICENSE", "Makefile", "Procfile"]);

/**
 * Where a link in a doc should point on the site. `fromFile` is the doc's path
 * under docs/ ("mcp.md", "modules/ai.md"); `known` the slugs that exist.
 *  - another doc ("deployment.md#x", "./mcp.md", "modules/ai.md", "README.md") → "/docs/<slug>#x";
 *  - an image under docs/images → its raw file on GitHub;
 *  - any other file or folder in the repository → it on GitHub (blob/ or tree/);
 *  - absolute URLs, mailto:, "#fragment", root-relative and anything that
 *    climbs out of the repository → unchanged.
 */
export function resolveDocHref(href: string, fromFile: string, known: ReadonlySet<string>, kind: "a" | "img" = "a"): string {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return href;
  const hashAt = raw.search(/[?#]/);
  const target = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const suffix = hashAt >= 0 ? raw.slice(hashAt) : "";
  // The repository path, from the doc's own folder ("docs/" or "docs/modules/").
  let decoded: string;
  try {
    decoded = decodeURI(target);
  } catch {
    return href;
  }
  const fromDir = posix.dirname(posix.join("docs", fromFile));
  const repoFile = posix.normalize(posix.join(fromDir, decoded));
  if (repoFile.startsWith("..") || posix.isAbsolute(repoFile)) return href;
  const isFolder = target.endsWith("/") || repoFile === ".";
  const clean = repoFile.replace(/\/+$/, "");

  // Images (and links to them) are the raw file: a blob/ page is HTML, not an image.
  if (kind === "img" || /^docs\/images\//.test(clean)) return `${rawBase()}${clean}${suffix}`;

  // Another doc: a .md under docs/ that exists, or a folder whose README does.
  if (clean === "docs" || clean.startsWith("docs/")) {
    const under = clean === "docs" ? "" : clean.slice("docs/".length);
    const asFile = /\.md$/i.test(under) ? slugForFile(under) : isFolder || !posix.extname(under) ? under : null;
    if (asFile !== null && isValidSlug(asFile) && known.has(asFile)) {
      // "?query" means nothing on a docs page; the fragment is kept.
      const hash = suffix.includes("#") ? suffix.slice(suffix.indexOf("#")) : "";
      return `${docsPath(asFile)}${hash}`;
    }
  }

  const last = posix.basename(clean);
  const view = isFolder || (!posix.extname(last) && !PLAIN_FILES.has(last)) ? "tree" : "blob";
  return clean === "." ? `${OPENSHIPKIT_REPO}${suffix}` : `${repoPath(clean, view)}${suffix}`;
}

/**
 * The same rewrite on Markdown source (for llms-full.txt): inline links and
 * images, and reference definitions, outside fenced code and inline code.
 * Site paths come back root-relative; absolutizeMarkdownLinks makes them absolute.
 */
export function rewriteMarkdownLinks(markdown: string, fromFile: string, known: ReadonlySet<string>): string {
  let fence: string | null = null;
  const inline = (text: string) =>
    text.replace(/(!?)\]\(\s*(<?)([^)\s>]+)(>?)/g, (_m, bang: string, open: string, url: string, close: string) => {
      return `${bang}](${open}${resolveDocHref(url, fromFile, known, bang ? "img" : "a")}${close}`;
    });
  return markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (marker) {
        if (!fence) fence = marker[0] ?? null;
        else if (marker[0] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      const def = line.match(/^(\s{0,3}\[[^\]]+\]:\s*<?)(\S+?)(>?(?:\s.*)?)$/);
      if (def) return `${def[1]}${resolveDocHref(def[2] ?? "", fromFile, known)}${def[3] ?? ""}`;
      return line
        .split(/(`+[^`]*?`+)/)
        .map((part, i) => (i % 2 === 1 ? part : inline(part)))
        .join("");
    })
    .join("\n");
}

/**
 * The README without its table of the docs: on the site, /docs shows every
 * page as a card under its nav group, so a GFM table whose every row opens
 * with a link to a docs page would list them a second time. Any other table,
 * and everything else, is kept.
 */
export function withoutDocsTables(markdown: string, fromFile: string, known: ReadonlySet<string>): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!/^\s*\|/.test(lines[i] ?? "")) {
      out.push(lines[i] ?? "");
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && /^\s*\|/.test(lines[end] ?? "")) end++;
    const rows = lines.slice(i + 2, end);
    const linksDocs = (row: string) => {
      const href = row.match(/^\s*\|\s*\[[^\]]*\]\(([^)\s]+)\)/)?.[1];
      return href ? resolveDocHref(href, fromFile, known).startsWith("/docs") : false;
    };
    if (rows.length === 0 || !rows.every(linksDocs)) out.push(...lines.slice(i, end));
    i = end;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The sidebar from nav.json's groups; unknown slugs are dropped, unlisted pages join "More". */
export function buildNav(raw: unknown, entries: DocEntry[]): DocsNavGroup[] {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const pages = entries.filter((e) => e.slug !== "");
  if (!Array.isArray(raw)) return fallbackNav(pages);
  const used = new Set<string>();
  const groups: DocsNavGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const { group, items } = g as { group?: unknown; items?: unknown };
    if (typeof group !== "string" || !Array.isArray(items)) continue;
    const list: DocEntry[] = [];
    for (const item of items) {
      if (typeof item !== "string") continue;
      // "modules/README" (the file's name) and "modules" (its page) name the same page.
      const slug = slugForFile(`${item.replace(/\.md$/i, "")}.md`);
      if (used.has(slug)) continue;
      const entry = bySlug.get(slug);
      if (!entry || entry.slug === "") continue;
      used.add(slug);
      list.push(entry);
    }
    if (list.length) groups.push({ group: group.trim() || MORE_GROUP, items: list });
  }
  const rest = pages.filter((e) => !used.has(e.slug)).sort(byTitle);
  if (rest.length) groups.push({ group: MORE_GROUP, items: rest });
  return groups;
}

function byTitle(a: DocEntry, b: DocEntry): number {
  return a.title.localeCompare(b.title, "en");
}

/** No nav.json: the guides alphabetically, then the modules. */
export function fallbackNav(pages: DocEntry[]): DocsNavGroup[] {
  const guides = pages.filter((e) => !e.slug.includes("/") && e.slug !== "modules").sort(byTitle);
  const modules = pages.filter((e) => e.slug === "modules" || e.slug.startsWith("modules/"));
  modules.sort((a, b) => (a.slug === "modules" ? -1 : b.slug === "modules" ? 1 : byTitle(a, b)));
  return [
    ...(guides.length ? [{ group: "Guides", items: guides }] : []),
    ...(modules.length ? [{ group: "Modules", items: modules }] : []),
  ];
}

/** Are the docs published on this site? The showcase always; a renamed site only with OPENSHIPKIT_PUBLIC_DOCS=true. */
export function docsOn(showcase: boolean, publicFlag: boolean): boolean {
  return showcase || publicFlag;
}

// ── disk ───────────────────────────────────────────────────────────────────

interface Loaded {
  index: DocsIndex;
  sources: Map<string, { body: string; afterLead: string | null }>;
}

const g = globalThis as unknown as { __openshipkitDocs?: Promise<Loaded>; __openshipkitDocsHtml?: Map<string, Promise<RenderedMarkdown>> };

/** docs/ under the working directory: the repository in development, .next/standalone in production. */
function docsDir(): string {
  return join(/*turbopackIgnore: true*/ process.cwd(), "docs");
}

async function listFolder(folder: (typeof FOLDERS)[number]): Promise<string[]> {
  const dir = folder ? join(/*turbopackIgnore: true*/ docsDir(), "modules") : docsDir();
  try {
    const names = await readdir(/*turbopackIgnore: true*/ dir);
    return names.filter((n) => /^[A-Za-z0-9][A-Za-z0-9-]*\.md$/.test(n)).map((n) => (folder ? `${folder}/${n}` : n));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readNav(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ docsDir(), "nav.json"), "utf8")) as unknown;
  } catch (error) {
    // No nav.json yet: alphabetical. A nav.json that doesn't parse is a mistake to see, not hide.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function load(): Promise<Loaded> {
  const files = (await Promise.all(FOLDERS.map(listFolder))).flat();
  if (files.length === 0) log.warn("docs", "no Markdown under docs/: /docs answers 404 (is docs/ in the deployment? see next.config.ts)");
  const sources: Loaded["sources"] = new Map();
  const entries: DocEntry[] = [];
  await Promise.all(
    files.map(async (file) => {
      const slug = slugForFile(file);
      if (!isValidSlug(slug)) return;
      // The name comes from the directory listing above, never from a request.
      const text = await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ docsDir(), file), "utf8");
      const { title, description, body, afterLead } = parseDoc(text, slug || "Docs");
      sources.set(slug, { body, afterLead });
      entries.push({ slug, file, title, description });
    }),
  );
  entries.sort((a, b) => a.file.localeCompare(b.file));
  const nav = buildNav(await readNav(), entries);
  return {
    index: { bySlug: new Map(entries.map((e) => [e.slug, e])), nav, order: nav.flatMap((group) => group.items) },
    sources,
  };
}

function loaded(): Promise<Loaded> {
  if (!isProduction()) return load();
  return (g.__openshipkitDocs ??= load().catch((error) => {
    g.__openshipkitDocs = undefined;
    throw error;
  }));
}

/** Every page, the sidebar and its order. */
export async function getDocsIndex(): Promise<DocsIndex> {
  return (await loaded()).index;
}

/** One page by slug, or null when the slug is malformed or names no file. */
export async function getDoc(slug: string): Promise<DocPage | null> {
  if (!isValidSlug(slug)) return null;
  const { index, sources } = await loaded();
  const entry = index.bySlug.get(slug);
  const source = sources.get(slug);
  return entry && source ? { entry, markdown: source.body, afterLead: source.afterLead } : null;
}

/**
 * A page's sanitised HTML (highlighted, links rewritten) and TOC; cached per
 * process in production. `part` "afterLead" is for the index: the body
 * without its opening paragraph (shown as the lead) or its table of the docs
 * (shown as cards).
 */
export async function renderDoc(page: DocPage, known: ReadonlySet<string>, part: "body" | "afterLead" = "body"): Promise<RenderedMarkdown> {
  const source = part === "afterLead" ? withoutDocsTables(page.afterLead ?? page.markdown, page.entry.file, known) : page.markdown;
  const run = () =>
    renderMarkdownHighlighted(source, {
      siteOrigin: siteUrl(),
      // The docs' "#fragment" links are written for GitHub, so the ids are GitHub's.
      headingIds: "github",
      rewriteUrl: (url, tag) => resolveDocHref(url, page.entry.file, known, tag),
    });
  if (!isProduction()) return run();
  const cache = (g.__openshipkitDocsHtml ??= new Map());
  const key = `${part}:${page.entry.slug}`;
  let html = cache.get(key);
  if (!html) {
    html = run().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, html);
  }
  return html;
}

/** Are the docs published here? Reads the site name (a failed read throws: a 500, never a silent 404). */
export async function docsEnabled(): Promise<boolean> {
  const { showcase } = await getSiteSeo();
  return docsOn(showcase, publicDocs());
}

/**
 * A docs page's <title>, naming whose docs these are once: "Deployment ·
 * OpenShipKit docs", or "Set up OpenShipKit with an AI agent · Docs" when the
 * title already says it. Always OpenShipKit, not the site's name: these are
 * OpenShipKit's docs even on a renamed site that publishes them.
 */
export function docsTitle(title: string): string {
  return title.toLowerCase().includes(OPENSHIPKIT_NAME.toLowerCase()) ? `${title} · Docs` : `${title} · ${OPENSHIPKIT_NAME} docs`;
}

/** "Edit this page on GitHub" for a file under docs/. */
export function editUrl(file: string): string {
  return `${OPENSHIPKIT_REPO}/edit/main/docs/${file}`;
}
