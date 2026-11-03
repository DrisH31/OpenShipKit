import "server-only";

//
// Syntax highlighting, on the server only — no highlighter ships to the
// browser. One Shiki instance per process, created on first use with the
// JavaScript regex engine (no WebAssembly) and only the grammars the site's
// code actually uses.
//
// Two themes at once: every token carries `--shiki-light` and `--shiki-dark`
// custom properties (defaultColor: false), and CSS picks one by scheme
// (`.code-tokens` in src/styles/base.css), so code follows the light/dark
// switch with no re-render. Every colour is first raised to 4.5:1 against the
// code panels' background in its scheme (readableOn, src/shared/code-contrast.ts):
// the themes were drawn for their own backgrounds, and github-light's orange is
// 3.5:1 on our white cards. Callers:
//   - highlightTokens(): lines of tokens, for components that render their own
//     markup (src/components/marketing/code-panel.tsx).
//   - highlightToHtml(): a <pre> string, for rendered Markdown (src/server/markdown.ts).
// An unknown language falls back to plain text, never an error.
//

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { PANEL_BG, readableOn } from "@/shared/code-contrast";

const THEMES = { light: "github-light", dark: "github-dark-dimmed" } as const;

/** Grammars loaded, and the names that map onto them. */
const LANGS = {
  bash: () => import("shiki/langs/bash.mjs"),
  ts: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  js: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  md: () => import("shiki/langs/markdown.mjs"),
  nginx: () => import("shiki/langs/nginx.mjs"),
} as const;

const ALIASES: Record<string, keyof typeof LANGS> = {
  bash: "bash", sh: "bash", shell: "bash", zsh: "bash", console: "bash", terminal: "bash",
  ts: "ts", typescript: "ts", tsx: "tsx", js: "js", javascript: "js", mjs: "js", jsx: "tsx",
  json: "json", jsonc: "json", yaml: "yaml", yml: "yaml", sql: "sql", psql: "sql",
  dockerfile: "docker", docker: "docker", toml: "toml", ini: "ini", env: "ini", dotenv: "ini",
  diff: "diff", md: "md", markdown: "md", mdx: "md", nginx: "nginx",
};

/** The grammar a fence or prop names, or null for plain text. */
export function resolveLang(lang: string | null | undefined): keyof typeof LANGS | null {
  if (!lang) return null;
  return ALIASES[lang.trim().toLowerCase()] ?? null;
}

const g = globalThis as unknown as { __openshipkitShiki?: Promise<HighlighterCore> };

function highlighter(): Promise<HighlighterCore> {
  return (g.__openshipkitShiki ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark-dimmed.mjs")],
    langs: Object.values(LANGS).map((load) => load()),
    engine: createJavaScriptRegexEngine(),
  }).catch((error) => {
    g.__openshipkitShiki = undefined;
    throw error;
  }));
}

/** One token: its text and the light/dark colours, each at 4.5:1 or more on the panel (null = inherit the surrounding ink). */
export interface CodeToken {
  content: string;
  light: string | null;
  dark: string | null;
}

/** Lines of tokens for `code` in `lang`. Plain text (one token per line) when the language is unknown. */
export async function highlightTokens(code: string, lang: string | null | undefined): Promise<CodeToken[][]> {
  const text = code.replace(/\n$/, "");
  const resolved = resolveLang(lang);
  if (!resolved) return text.split("\n").map((line) => [{ content: line, light: null, dark: null }]);
  const shiki = await highlighter();
  const { tokens } = shiki.codeToTokens(text, { lang: resolved, themes: THEMES, defaultColor: false });
  const raise = (color: string | undefined, bg: string) => (color ? readableOn(color, bg) : null);
  return tokens.map((line) =>
    line.map((t) => ({
      content: t.content,
      light: raise(t.htmlStyle?.["--shiki-light"], PANEL_BG.light),
      dark: raise(t.htmlStyle?.["--shiki-dark"], PANEL_BG.dark),
    })),
  );
}

/**
 * Highlighted HTML for a Markdown code block: `<pre class="code-tokens"><code>…`
 * with per-token custom properties. Plain, escaped text when the language is unknown.
 */
export async function highlightToHtml(code: string, lang: string | null | undefined): Promise<string> {
  const lines = await highlightTokens(code, lang);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = lines
    .map((line) =>
      line
        .map((t) =>
          t.light || t.dark
            ? `<span style="--shiki-light:${t.light ?? "inherit"};--shiki-dark:${t.dark ?? "inherit"}">${esc(t.content)}</span>`
            : esc(t.content),
        )
        .join(""),
    )
    .join("\n");
  const resolved = resolveLang(lang);
  return `<pre class="code-tokens"${resolved ? ` data-lang="${resolved}"` : ""}><code>${body}</code></pre>`;
}
