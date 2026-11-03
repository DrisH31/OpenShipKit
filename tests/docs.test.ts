//
// The /docs pages (src/server/docs.ts): slugs can't climb out of docs/, links
// written for GitHub land on the site, the nav falls back when nav.json is
// missing, the sanitiser lets through the highlighter's colours and nothing
// else, the docs stay off on a renamed site, and — against the real docs/ —
// every link between docs names a page and a heading that exist.
//

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNav,
  docsOn,
  docsPath,
  fallbackNav,
  getDoc,
  getDocsIndex,
  isValidSlug,
  parseDoc,
  renderDoc,
  resolveDocHref,
  rewriteMarkdownLinks,
  docsTitle,
  slugForFile,
  withoutDocsTables,
  type DocEntry,
} from "@/server/docs";
import { publicDocs } from "@/server/env";
import { highlightTokens } from "@/server/highlight";
import { codeLabel, renderMarkdown, renderMarkdownHighlighted } from "@/server/markdown";
import { OPENSHIPKIT_REPO } from "@/shared/project";

const KNOWN = new Set(["", "getting-started", "deployment", "mcp", "modules", "modules/ai", "modules/rag"]);

const entry = (slug: string, title: string): DocEntry => ({ slug, file: `${slug || "README"}.md`, title, description: "" });

describe("docs — slugs", () => {
  it("maps files to slugs, READMEs to their folder", () => {
    expect(slugForFile("README.md")).toBe("");
    expect(slugForFile("deployment.md")).toBe("deployment");
    expect(slugForFile("modules/README.md")).toBe("modules");
    expect(slugForFile("modules/ai.md")).toBe("modules/ai");
    expect(docsPath("")).toBe("/docs");
    expect(docsPath("modules/ai")).toBe("/docs/modules/ai");
  });

  it("refuses traversal and anything outside the slug shape", () => {
    for (const bad of ["../SPEC", "..", "modules/../../.env", "/etc/passwd", "deployment.md", "Deployment", "a/b/c", "modules/", "%2e%2e", "-x", "a b", ".env"]) {
      expect(isValidSlug(bad), bad).toBe(false);
    }
    for (const good of ["", "deployment", "getting-started", "modules/ai"]) expect(isValidSlug(good), good).toBe(true);
  });

  it("serves only files it listed, never a path from the request", async () => {
    expect(await getDoc("../SPEC")).toBeNull();
    expect(await getDoc("../../package")).toBeNull();
    expect(await getDoc("modules/../../AGENTS")).toBeNull();
    expect(await getDoc("no-such-page")).toBeNull();
    expect(await getDoc("README")).toBeNull(); // the index is /docs, not /docs/README
  });
});

describe("docs — parsing", () => {
  it("takes the title from the first # heading and the description from the first paragraph", () => {
    const md = "# Deploy it\n\nRun it **anywhere** with [Docker](deploy.md) and `npm start`.\nSecond line.\n\n## Next\n\nMore.";
    const { title, description, body, afterLead } = parseDoc(md, "x");
    expect(title).toBe("Deploy it");
    expect(description).toBe("Run it anywhere with Docker and npm start. Second line.");
    expect(body.startsWith("Run it")).toBe(true);
    expect(body).not.toContain("# Deploy it");
    expect(afterLead?.trim().startsWith("## Next")).toBe(true);
  });

  it("skips a # comment in code and blocks before the first paragraph", () => {
    const md = "```bash\n# not a title\n```\n\n# Real\n\n> a note\n\nThe paragraph.";
    const parsed = parseDoc(md, "x");
    expect(parsed.title).toBe("Real");
    expect(parsed.description).toBe("The paragraph.");
    expect(parsed.afterLead).toBeNull(); // a quote opens the body, so the paragraph isn't a lead
  });

  it("names OpenShipKit's docs once in the <title>", () => {
    expect(docsTitle("Deployment")).toBe("Deployment · OpenShipKit docs");
    expect(docsTitle("Set up OpenShipKit with an AI agent")).toBe("Set up OpenShipKit with an AI agent · Docs");
  });

  it("falls back to the given title when there is no # heading", () => {
    expect(parseDoc("Just text.", "Fallback").title).toBe("Fallback");
  });
});

describe("docs — links", () => {
  const blob = (p: string) => `${OPENSHIPKIT_REPO}/blob/main/${p}`;
  const tree = (p: string) => `${OPENSHIPKIT_REPO}/tree/main/${p}`;

  it("keeps links between docs on the site, with their fragment", () => {
    expect(resolveDocHref("deployment.md", "getting-started.md", KNOWN)).toBe("/docs/deployment");
    expect(resolveDocHref("./mcp.md#keys", "getting-started.md", KNOWN)).toBe("/docs/mcp#keys");
    expect(resolveDocHref("modules/ai.md", "getting-started.md", KNOWN)).toBe("/docs/modules/ai");
    expect(resolveDocHref("modules/README.md", "getting-started.md", KNOWN)).toBe("/docs/modules");
    expect(resolveDocHref("README.md", "deployment.md", KNOWN)).toBe("/docs");
    expect(resolveDocHref("../mcp.md#tool-reference", "modules/ai.md", KNOWN)).toBe("/docs/mcp#tool-reference");
    expect(resolveDocHref("rag.md", "modules/ai.md", KNOWN)).toBe("/docs/modules/rag");
    expect(resolveDocHref("README.md", "modules/ai.md", KNOWN)).toBe("/docs/modules");
  });

  it("sends links into the code to GitHub: blob for files, tree for folders", () => {
    expect(resolveDocHref("../src/proxy.ts", "security.md", KNOWN)).toBe(blob("src/proxy.ts"));
    expect(resolveDocHref("../README.md", "README.md", KNOWN)).toBe(blob("README.md"));
    expect(resolveDocHref("../docker-compose.yml", "deployment.md", KNOWN)).toBe(blob("docker-compose.yml"));
    expect(resolveDocHref("../deploy/vps/README.md#updating", "deployment.md", KNOWN)).toBe(`${blob("deploy/vps/README.md")}#updating`);
    expect(resolveDocHref("../deploy/", "deployment.md", KNOWN)).toBe(tree("deploy"));
    expect(resolveDocHref("../deploy", "deployment.md", KNOWN)).toBe(tree("deploy"));
    expect(resolveDocHref("../Dockerfile", "deployment.md", KNOWN)).toBe(blob("Dockerfile"));
    expect(resolveDocHref("../.env.example", "deployment.md", KNOWN)).toBe(blob(".env.example"));
    // a .md under docs/ that isn't a page (yet) is the file on GitHub, not a 404 on the site
    expect(resolveDocHref("not-yet.md", "deployment.md", KNOWN)).toBe(blob("docs/not-yet.md"));
  });

  it("serves docs images from the raw file", () => {
    const raw = `${OPENSHIPKIT_REPO.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/docs/images/landing-light.webp`;
    expect(resolveDocHref("images/landing-light.webp", "getting-started.md", KNOWN, "img")).toBe(raw);
    expect(resolveDocHref("../images/landing-light.webp", "modules/ai.md", KNOWN, "img")).toBe(raw);
  });

  it("leaves absolute, mailto, fragment, root-relative and escaping links alone", () => {
    for (const href of ["https://example.com/x", "mailto:a@example.com", "#keys", "/pricing", "../../outside.md", "javascript:alert(1)"]) {
      expect(resolveDocHref(href, "deployment.md", KNOWN)).toBe(href);
    }
  });

  it("rewrites links in the rendered HTML, and the scheme allowlist still applies", () => {
    const { html } = renderMarkdown("[a](deployment.md#migrations) [b](../src/proxy.ts) [c](javascript:alert(1)) ![i](images/x.png)", {
      rewriteUrl: (url, tag) => resolveDocHref(url, "getting-started.md", KNOWN, tag),
    });
    expect(html).toContain('href="/docs/deployment#migrations"');
    expect(html).toContain(`href="${blob("src/proxy.ts")}"`);
    expect(html).toContain("raw.githubusercontent.com");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("rewrites Markdown source the same way, leaving code alone", () => {
    const md = "See [deploy](deployment.md#x) and `[x](mcp.md)`.\n\n```md\n[y](mcp.md)\n```\n\n[ref]: ../src/proxy.ts";
    const out = rewriteMarkdownLinks(md, "getting-started.md", KNOWN);
    expect(out).toContain("[deploy](/docs/deployment#x)");
    expect(out).toContain("`[x](mcp.md)`");
    expect(out).toContain("[y](mcp.md)");
    expect(out).toContain(`[ref]: ${blob("src/proxy.ts")}`);
  });
});

describe("docs — the index", () => {
  it("drops a table that only lists docs pages, keeps any other table", () => {
    const md = [
      "| Guide | When |",
      "|---|---|",
      "| [Deploy](deployment.md) | putting it live |",
      "| [MCP](mcp.md#keys) | agents |",
      "",
      "| Var | Why |",
      "|---|---|",
      "| [Deploy](deployment.md) | x |",
      "| `X` | y |",
      "",
      "Also: [SPEC.md](../SPEC.md).",
    ].join("\n");
    const out = withoutDocsTables(md, "README.md", KNOWN);
    expect(out).not.toContain("putting it live");
    expect(out).toContain("| `X` | y |");
    expect(out).toContain("Also: [SPEC.md](../SPEC.md).");
  });
});

describe("docs — nav", () => {
  const pages = [entry("", "Docs"), entry("mcp", "MCP"), entry("auth", "Auth"), entry("modules", "Modules"), entry("modules/ai", "AI")];

  it("falls back to alphabetical guides, then the modules, with no nav.json", () => {
    const nav = buildNav(null, pages);
    expect(nav.map((g) => g.group)).toEqual(["Guides", "Modules"]);
    expect(nav[0]?.items.map((e) => e.slug)).toEqual(["auth", "mcp"]);
    expect(nav[1]?.items.map((e) => e.slug)).toEqual(["modules", "modules/ai"]);
    expect(fallbackNav([])).toEqual([]);
  });

  it("follows nav.json, drops unknown slugs and the index, and puts unlisted pages under More", () => {
    const nav = buildNav([{ group: "Start", items: ["mcp", "nope", "", "mcp"] }, { group: "Empty", items: ["ghost"] }, "junk"], pages);
    expect(nav.map((g) => g.group)).toEqual(["Start", "More"]);
    expect(nav[0]?.items.map((e) => e.slug)).toEqual(["mcp"]);
    expect(nav[1]?.items.map((e) => e.slug)).toEqual(["modules/ai", "auth", "modules"]);
  });

  it("takes a folder's README by its file name or its page", () => {
    expect(buildNav([{ group: "Build", items: ["modules/README", "modules/ai.md", "modules"] }], pages)[0]?.items.map((e) => e.slug)).toEqual([
      "modules",
      "modules/ai",
    ]);
  });
});

describe("docs — highlighted code and the sanitiser", () => {
  it("highlights fenced code into a framed block with its language", async () => {
    const { html } = await renderMarkdownHighlighted("```bash\nnpm run dev\n```");
    expect(html).toContain('<figure class="code-block"><figcaption>Shell</figcaption><pre class="code-tokens" data-lang="bash">');
    expect(html).toMatch(/<span style="--shiki-light:#[0-9a-f]{3,8};--shiki-dark:#[0-9a-f]{3,8}">/i);
    expect(html).toContain("npm");
  });

  it("keeps an unknown language as escaped plain text, labelled as written", async () => {
    const { html } = await renderMarkdownHighlighted("```caddy\n<script>alert(1)</script>\n```\n\n```\nplain\n```");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<figcaption>caddy</figcaption>");
    expect(html).toContain("<figcaption>Text</figcaption>");
    expect(codeLabel("dotenv")).toBe(".env");
  });

  it("wraps prose fences (a prompt) and never a command", async () => {
    const { html } = await renderMarkdownHighlighted("```text\nSet it up.\n```\n\n```bash\nnpm i\n```");
    expect(html).toContain('<figure class="code-block code-block-wrap"><figcaption>Text</figcaption>');
    expect(html).toContain('<figure class="code-block"><figcaption>Shell</figcaption>');
  });

  it("lets the token colours through and strips every other style", () => {
    const { html } = renderMarkdown(
      [
        '<span style="--shiki-light:#24292E;--shiki-dark:inherit">ok</span>',
        '<span style="--shiki-light:#fff;color:red;background:url(https://evil.test/x)">mixed</span>',
        '<span style="--shiki-light:url(https://evil.test/x)">url</span>',
        '<span style="--shiki-light:red;--shiki-dark:expression(alert(1))">named</span>',
        '<span style="--other:#000;position:fixed;inset:0">overlay</span>',
        '<p style="--shiki-light:#000">para</p>',
        '<pre class="code-tokens evil" data-lang="bash onload" onclick="x()">x</pre>',
      ].join("\n\n"),
    );
    expect(html).toContain('<span style="--shiki-light:#24292E;--shiki-dark:inherit">ok</span>');
    expect(html).toContain('<span style="--shiki-light:#fff">mixed</span>');
    expect(html).not.toMatch(/color:red|background|url\(|evil\.test|expression|position|inset|--other/);
    expect(html).not.toMatch(/<p style/);
    expect(html).toContain('<pre class="code-tokens">x</pre>');
  });

  it("keeps both themes' token colours at 4.5:1 on the code panel", async () => {
    // --surface in tokens.css: #FFFFFF light, #181818 dark.
    const sample = [
      ["bash", "# a comment\nnpm run dev -- --port 3000 && echo \"done\" > /tmp/x"],
      ["ts", "// note\nexport const x: number = 1; const s = `t${x}`; if (x) { throw new Error(\"no\"); }"],
      ["json", '{ "a": 1, "b": true, "c": null, "d": "s" }'],
      ["yaml", "# c\nkey: value\nlist:\n  - 1\n  - true"],
      ["ini", "# c\nKEY=value"],
      ["sql", "-- c\nselect * from users where id = 1;"],
      ["diff", "- old\n+ new"],
    ] as const;
    const colours = { light: new Set<string>(), dark: new Set<string>() };
    for (const [lang, code] of sample) {
      for (const line of await highlightTokens(code, lang)) {
        for (const t of line) {
          if (t.light) colours.light.add(t.light.slice(0, 7));
          if (t.dark) colours.dark.add(t.dark.slice(0, 7));
        }
      }
    }
    const failing = [
      ...[...colours.light].filter((c) => contrast(c, "#FFFFFF") < 4.5).map((c) => `light ${c} ${contrast(c, "#FFFFFF").toFixed(2)}`),
      ...[...colours.dark].filter((c) => contrast(c, "#181818") < 4.5).map((c) => `dark ${c} ${contrast(c, "#181818").toFixed(2)}`),
    ];
    expect(failing).toEqual([]);
  });
});

describe("docs — gating", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on for the showcase, off for a renamed site unless OPENSHIPKIT_PUBLIC_DOCS=true", () => {
    expect(docsOn(true, false)).toBe(true);
    expect(docsOn(false, false)).toBe(false);
    expect(docsOn(false, true)).toBe(true);
  });

  it("reads OPENSHIPKIT_PUBLIC_DOCS as exactly 'true'", () => {
    vi.stubEnv("OPENSHIPKIT_PUBLIC_DOCS", "");
    expect(publicDocs()).toBe(false);
    vi.stubEnv("OPENSHIPKIT_PUBLIC_DOCS", "1");
    expect(publicDocs()).toBe(false);
    vi.stubEnv("OPENSHIPKIT_PUBLIC_DOCS", "true");
    expect(publicDocs()).toBe(true);
  });
});

describe("docs — the real docs/", () => {
  it("has an index, and every page has a title and a description", async () => {
    const index = await getDocsIndex();
    expect(index.bySlug.has("")).toBe(true);
    for (const e of index.bySlug.values()) {
      expect(e.title, e.file).not.toBe("");
      expect(e.description, `${e.file} has no opening paragraph`).not.toBe("");
    }
    // Every page but the index is reachable from the sidebar.
    expect(new Set(index.order.map((e) => e.slug))).toEqual(new Set([...index.bySlug.keys()].filter(Boolean)));
  });

  it("every link between docs lands on a page and a heading that exist", async () => {
    const index = await getDocsIndex();
    const known = new Set(index.bySlug.keys());
    const ids = new Map<string, Set<string>>();
    const links: { from: string; href: string }[] = [];
    for (const e of index.bySlug.values()) {
      const page = await getDoc(e.slug);
      if (!page) throw new Error(`no page for ${e.slug}`);
      const { html } = await renderDoc(page, known);
      ids.set(e.slug, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "")));
      for (const m of html.matchAll(/<a href="([^"]+)"/g)) links.push({ from: e.file, href: m[1] ?? "" });
    }
    const broken: string[] = [];
    for (const { from, href } of links) {
      const own = href.startsWith("#") ? { slug: slugForFile(from), hash: href.slice(1) } : null;
      const site = href.match(/^\/docs(?:\/([^#]+))?(?:#(.+))?$/);
      const target = own ?? (site ? { slug: site[1] ?? "", hash: site[2] ?? "" } : null);
      if (!target) continue;
      if (!known.has(target.slug)) broken.push(`${from}: ${href} (no page)`);
      else if (target.hash && !ids.get(target.slug)?.has(target.hash)) broken.push(`${from}: ${href} (no heading)`);
    }
    expect(broken).toEqual([]);
  });
});

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const v = parseInt(full.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
