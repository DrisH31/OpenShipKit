import "server-only";

//
// Markdown → safe HTML for posts, changelog entries and legal pages.
//
// marked (GFM) renders; sanitize-html then enforces an allowlist, so the HTML
// is safe even when the Markdown carries raw HTML (an agent or an editor can
// write posts). Two rules worth knowing:
//  - the page title is the only <h1>: a `#` heading in a body renders as <h2>;
//  - heading ids are slugged and de-duplicated here, and the TOC is built from
//    the same ids, so a TOC link always lands. With an idPrefix, a body's own
//    "#heading" links are prefixed to match.
// Images: `![alt](src "Title =1200x630")` sets width and height (the title
// keeps the rest), so the page reserves the space before the file arrives.
// The first image loads eagerly; the rest wait until they're near.
//
// Code: renderMarkdown() leaves fenced code as plain, escaped text (posts,
// changelog, legal). renderMarkdownHighlighted() is the same renderer with
// every block highlighted on the server (src/server/highlight.ts) and framed
// as <figure class="code-block"><figcaption>Shell</figcaption><pre class=
// "code-tokens">… — the /docs pages use it. The sanitiser lets through exactly
// what the highlighter writes and nothing else of the kind: a span's style
// may hold only --shiki-light / --shiki-dark, each a #hex colour or
// "inherit"; any other declaration is dropped.
//

import { Marked, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { highlightToHtml } from "@/server/highlight";
import { slugify } from "@/shared/slug";

export interface TocItem {
  id: string;
  text: string;
  depth: 2 | 3 | 4;
}

export interface RenderedMarkdown {
  html: string;
  toc: TocItem[];
  readingMinutes: number;
  /** Words of visible text (code included), for BlogPosting.wordCount. */
  wordCount: number;
}

export interface RenderOptions {
  /** The site's origin (siteUrl()). Absolute links elsewhere get rel="noopener noreferrer". */
  siteOrigin?: string;
  /**
   * The level a body's top heading renders at (default 2). Use 3 where the
   * body sits under its own <h2>, as each changelog entry does on /changelog.
   */
  minDepth?: 2 | 3;
  /** Prefix for heading ids, so several bodies on one page never share an id. */
  idPrefix?: string;
  /**
   * "github": heading ids as GitHub writes them ("Platforms that aren’t a
   * server" → "platforms-that-arent-a-server"; repeats get -1, -2), so a
   * "#fragment" written for the repository's Markdown lands on the site too.
   * An id GitHub would write outside our safe shape falls back to the default.
   */
  headingIds?: "github";
  /**
   * Lazy-load every image, the first included. For bodies that sit further
   * down a list (the entries on /changelog), where no image opens the page.
   */
  lazyImages?: boolean;
  /**
   * Rewrite a link's href or an image's src before it is checked (the scheme
   * allowlist still applies to what comes back). The docs use it to turn
   * "deployment.md#migrations" into "/docs/deployment#migrations" and
   * "../deploy/" into the file on GitHub (src/server/docs.ts).
   */
  rewriteUrl?: (url: string, tag: "a" | "img") => string;
}

/** Words per minute for the "n min read" estimate; a common figure for screen reading. */
const WORDS_PER_MINUTE = 225;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };

/** Inline HTML → plain text (for heading ids, the TOC and word counts). */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const YOUTUBE_EMBED = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{6,20}(?:\?[A-Za-z0-9_=&;-]*)?$/;

function isExternal(href: string, siteOrigin: string | undefined): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  if (!siteOrigin) return true;
  try {
    return new URL(href).origin !== new URL(siteOrigin).origin;
  } catch {
    return true;
  }
}

/** A heading's anchor as GitHub writes it: lowercase, punctuation dropped, spaces to hyphens. */
export function githubHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** A trailing "=WIDTHxHEIGHT" in an image title: the image's intrinsic size. */
const IMAGE_SIZE = /(?:^|\s)=(\d{1,5})x(\d{1,5})$/;

/** How sanitize() rewrites an in-page "#fragment" (null = leave it as written). */
type FragmentResolver = (fragment: string) => string | null;

/**
 * The only values a highlighted token's colour may take: what highlight.ts
 * writes (a theme's #hex, or "inherit" for the surrounding ink). Nothing that
 * can load a URL, change layout or hide text behind another colour property.
 */
const TOKEN_COLOUR = [/^#[0-9a-f]{3,8}$/i, /^inherit$/];

/** A highlighted block's language, as highlight.ts names it on the <pre>. */
const LANG_ATTR = /^[a-z]{1,16}$/;

/** What a code block's caption bar calls its language. Unknown names show as written; none shows "Text". */
const LANG_LABELS: Record<string, string> = {
  bash: "Shell", sh: "Shell", shell: "Shell", zsh: "Shell", console: "Shell", terminal: "Shell",
  ts: "TypeScript", typescript: "TypeScript", tsx: "TSX", js: "JavaScript", javascript: "JavaScript", mjs: "JavaScript", jsx: "JSX",
  json: "JSON", jsonc: "JSON", yaml: "YAML", yml: "YAML", sql: "SQL", psql: "SQL", dockerfile: "Dockerfile", docker: "Dockerfile",
  toml: "TOML", ini: "INI", env: ".env", dotenv: ".env", diff: "Diff", md: "Markdown", markdown: "Markdown", mdx: "MDX",
  nginx: "Nginx", css: "CSS", html: "HTML", text: "Text", txt: "Text", plaintext: "Text", prompt: "Prompt",
};

/**
 * Fences that hold prose, not code — a prompt to paste into an agent, a note:
 * their lines wrap (`code-block-wrap`), where a command's never do (a command
 * broken mid-token reads as two). Copy still takes the text exactly as written.
 */
const WRAPPED_LANGS = new Set(["text", "txt", "plaintext", "prompt"]);

/** The caption-bar label for a fence's language ("bash" → "Shell"; "" → "Text"). */
export function codeLabel(lang: string): string {
  const key = lang.trim().toLowerCase();
  if (!key) return "Text";
  return LANG_LABELS[key] ?? key;
}

function sanitize(html: string, opts: RenderOptions, resolveFragment: FragmentResolver): string {
  let images = 0;
  return sanitizeHtml(html, {
    allowedTags: [
      "h2", "h3", "h4", "h5", "h6", "p", "a", "ul", "ol", "li", "blockquote", "pre", "code", "kbd", "samp",
      "strong", "b", "em", "i", "del", "s", "ins", "mark", "sup", "sub", "small", "abbr", "br", "hr", "span",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
      "img", "figure", "figcaption", "details", "summary", "dl", "dt", "dd", "section", "input", "iframe",
    ],
    allowedAttributes: {
      "*": ["id"],
      a: ["href", "title", "rel", "target"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
      th: ["align", "scope", "colspan", "rowspan"],
      td: ["align", "colspan", "rowspan"],
      ol: ["start", "reversed"],
      abbr: ["title"],
      input: ["type", "checked", "disabled", "aria-label"],
      iframe: ["src", "title", "allow", "allowfullscreen", "loading", "referrerpolicy", "width", "height"],
      code: ["class"],
      section: ["class"],
      li: ["class"],
      ul: ["class"],
      // A highlighted block (renderMarkdownHighlighted): its frame, its <pre> and the tokens' colours.
      figure: ["class"],
      pre: ["class", "data-lang"],
      span: ["style"],
    },
    allowedClasses: {
      code: ["language-*"],
      section: ["footnotes"],
      li: ["task-list-item"],
      ul: ["contains-task-list"],
      figure: ["code-block", "code-block-wrap"],
      pre: ["code-tokens"],
    },
    // Only the two custom properties highlight.ts writes, with a colour each; every other declaration goes.
    allowedStyles: {
      span: { "--shiki-light": TOKEN_COLOUR, "--shiki-dark": TOKEN_COLOUR },
    },
    // No data:, javascript:, vbscript: — anywhere. Images come from http(s) URLs.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    allowedIframeHostnames: ["www.youtube-nocookie.com"],
    allowIframeRelativeUrls: false,
    disallowedTagsMode: "discard",
    // Drop script/style contents entirely instead of leaking them as text.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "template"],
    transformTags: {
      "*": (tagName, attribs) => {
        // Ids only in our own shape — no clobbering of ids the page itself uses.
        if (attribs.id !== undefined && !SAFE_ID.test(attribs.id)) {
          const rest = { ...attribs };
          delete rest.id;
          return { tagName, attribs: rest };
        }
        return { tagName, attribs };
      },
      pre: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        if (next["data-lang"] !== undefined && !LANG_ATTR.test(next["data-lang"])) delete next["data-lang"];
        if (next.id !== undefined && !SAFE_ID.test(next.id)) delete next.id;
        return { tagName, attribs: next };
      },
      a: (tagName, attribs) => {
        const href = opts.rewriteUrl && attribs.href ? opts.rewriteUrl(attribs.href, "a") : (attribs.href ?? "");
        const next: Record<string, string> = { ...attribs, ...(attribs.href !== undefined ? { href } : {}) };
        if (isExternal(href, opts.siteOrigin)) next.rel = "noopener noreferrer";
        else delete next.rel;
        if (href.startsWith("#")) {
          const resolved = resolveFragment(href.slice(1));
          if (resolved !== null) next.href = `#${resolved}`;
        }
        delete next.target;
        if (next.id !== undefined && !SAFE_ID.test(next.id)) delete next.id;
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs, decoding: "async" };
        if (opts.rewriteUrl && attribs.src) next.src = opts.rewriteUrl(attribs.src, "img");
        // "=1200x630" at the end of the title is the size, not words to show.
        const size = (attribs.title ?? "").match(IMAGE_SIZE);
        if (size) {
          next.width = size[1];
          next.height = size[2];
          const title = (attribs.title ?? "").replace(IMAGE_SIZE, "").trim();
          if (title) next.title = title;
          else delete next.title;
        }
        // An author's explicit choice stands; otherwise the first image (often the
        // opening figure) loads at once and the rest load as the reader nears them.
        images += 1;
        if (attribs.loading === "eager" || attribs.loading === "lazy") next.loading = attribs.loading;
        else if (images === 1 && !opts.lazyImages) delete next.loading;
        else next.loading = "lazy";
        return { tagName, attribs: next };
      },
      input: (tagName, attribs) => {
        // Task-list checkboxes only, and never interactive. The task's words sit beside
        // the box, not in a <label>, so the box names its own state.
        const checked = attribs.checked !== undefined;
        return {
          tagName,
          attribs: { type: "checkbox", disabled: "", "aria-label": checked ? "Done" : "Not done", ...(checked ? { checked: "" } : {}) },
        };
      },
      iframe: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          // Every frame needs a name; only YouTube embeds get this far.
          title: attribs.title?.trim() || "Embedded video",
          loading: "lazy",
          referrerpolicy: "strict-origin-when-cross-origin",
          allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture",
        },
      }),
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === "iframe") return !YOUTUBE_EMBED.test(frame.attribs.src ?? "");
      if (frame.tag === "img") return !frame.attribs.src;
      if (frame.tag === "input") return frame.attribs.type !== "checkbox";
      return false;
    },
  });
}

/** A fence's language as written: "bash" from "bash title=x"; "" when there is none. */
function fenceLang(lang: string | undefined): string {
  return (lang ?? "").match(/^[A-Za-z0-9_+-]+/)?.[0] ?? "";
}

/** The key a highlighted block is stored under: its language and its exact text. */
function blockKey(text: string, lang: string): string {
  return `${lang.toLowerCase()}\u0000${text}`;
}

/**
 * Render Markdown (GFM) to sanitised HTML, a table of contents (h2–h4), the
 * word count and a reading-time estimate. Pure apart from its inputs; safe to
 * call per request. Code stays plain text; see renderMarkdownHighlighted.
 */
export function renderMarkdown(markdown: string, opts: RenderOptions = {}): RenderedMarkdown {
  return render(markdown, opts, null);
}

/**
 * renderMarkdown with every code block highlighted on the server and framed
 * with its language ("Shell", "TypeScript") in a caption bar, where the docs'
 * copy button goes (src/components/docs/code-copy.tsx). Async only because the
 * highlighter loads its grammars once per process.
 */
export async function renderMarkdownHighlighted(markdown: string, opts: RenderOptions = {}): Promise<RenderedMarkdown> {
  const lexer = new Marked({ gfm: true });
  const blocks: { text: string; lang: string }[] = [];
  lexer.walkTokens(lexer.lexer(markdown ?? ""), (token) => {
    if (token.type === "code") blocks.push({ text: (token as Tokens.Code).text, lang: fenceLang((token as Tokens.Code).lang) });
  });
  const highlighted = new Map<string, string>();
  await Promise.all(
    blocks.map(async ({ text, lang }) => {
      const key = blockKey(text, lang);
      if (!highlighted.has(key)) highlighted.set(key, await highlightToHtml(text, lang));
    }),
  );
  return render(markdown, opts, highlighted);
}

function render(markdown: string, opts: RenderOptions, highlighted: Map<string, string> | null): RenderedMarkdown {
  const toc: TocItem[] = [];
  const used = new Map<string, number>();

  const minDepth = opts.minDepth ?? 2;
  const prefix = opts.idPrefix ? `${slugify(opts.idPrefix)}-` : "";

  // Every heading id this body produced, so a "#heading" link can follow its prefix.
  const ids = new Set<string>();
  const github = opts.headingIds === "github";
  const uniqueId = (text: string): string => {
    if (github) {
      const gh = `${prefix}${githubHeadingId(text)}`;
      if (SAFE_ID.test(gh) && gh.length <= 110) {
        // GitHub's repeats: "setup", "setup-1", "setup-2" …
        const n = used.get(gh) ?? 0;
        used.set(gh, n + 1);
        let candidate = n === 0 ? gh : `${gh}-${n}`;
        while (n > 0 && used.has(candidate)) candidate = `${candidate}-x`;
        if (n > 0) used.set(candidate, 1);
        ids.add(candidate);
        return candidate;
      }
    }
    const base = `${prefix}${slugify(text) || "section"}`.slice(0, 110);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    if (n === 0) {
      ids.add(base);
      return base;
    }
    // "setup", "setup-2", "setup-3" … and never collide with a literal "setup-2" heading.
    let candidate = `${base}-${n + 1}`;
    while (used.has(candidate)) candidate = `${candidate}-x`;
    used.set(candidate, 1);
    ids.add(candidate);
    return candidate;
  };

  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, { tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const text = htmlToText(inner);
        const level = Math.min(6, Math.max(minDepth, depth + (minDepth - 2)));
        const id = uniqueId(text);
        if (level <= 4) toc.push({ id, text, depth: level as TocItem["depth"] });
        return `<h${level} id="${escapeAttr(id)}">${inner}</h${level}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const language = fenceLang(lang);
        const block = highlighted?.get(blockKey(text, language));
        if (block) {
          // The label is visible text in the bar; the copy button joins it after hydration.
          const label = escapeAttr(codeLabel(language));
          const cls = WRAPPED_LANGS.has(language.toLowerCase()) ? "code-block code-block-wrap" : "code-block";
          return `<figure class="${cls}"><figcaption>${label}</figcaption>${block}</figure>\n`;
        }
        const cls = language ? ` class="language-${escapeAttr(language.toLowerCase())}"` : "";
        const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<pre><code${cls}>${escaped}\n</code></pre>\n`;
      },
    },
  });

  const raw = marked.parse(markdown ?? "", { async: false });
  // With a prefix, "#upgrading" in the body means this body's "<prefix>-upgrading" heading.
  // A fragment that names no heading here (another entry, say) is left as written.
  const resolveFragment: FragmentResolver = (fragment) => {
    if (!prefix) return null;
    const own = `${prefix}${fragment}`;
    return ids.has(own) ? own : null;
  };
  const html = sanitize(raw, opts, resolveFragment);
  // Tags become spaces, so words in adjacent cells or blocks are never glued together.
  const words = htmlToText(html.replace(/<[^>]*>/g, " ")).split(" ").filter(Boolean).length;
  return { html, toc, readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)), wordCount: words };
}

/** Reading time alone, without rendering the HTML (for lists and RSS). */
export function readingMinutes(markdown: string): number {
  const text = (markdown ?? "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[`]/g, " "))
    .replace(/[#>*_`~[\]()!|-]/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
