//
// renderMarkdown: the XSS allowlist, heading ids and the TOC. Every vector here
// is one an editor or an agent could paste into a post body.
//

import { describe, expect, it } from "vitest";
import { htmlToText, readingMinutes, renderMarkdown } from "./markdown";

describe("renderMarkdown — sanitising", () => {
  it("strips <script> and its contents", () => {
    const { html } = renderMarkdown("Hello\n\n<script>alert(1)</script>\n\nWorld");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("World");
  });

  it("strips event handlers such as onerror and onclick", () => {
    const { html } = renderMarkdown('<img src="https://example.com/a.png" onerror="alert(1)"> <a href="/x" onclick="alert(2)">x</a>');
    expect(html).not.toMatch(/onerror|onclick/i);
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it("removes javascript: and vbscript: URLs, in Markdown and in raw HTML", () => {
    const { html } = renderMarkdown('[a](javascript:alert(1)) <a href="JaVaScRiPt:alert(2)">b</a> <a href="vbscript:msgbox">c</a> [d](  javascript:alert(3))');
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html.toLowerCase()).not.toContain("vbscript:");
  });

  it("removes data: URLs from links and images", () => {
    const { html } = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)\n\n![y](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)');
    expect(html).not.toContain("data:");
    // an image with no surviving src is dropped entirely
    expect(html).not.toContain("<img");
  });

  it("drops style, iframe (other than youtube-nocookie), object, embed, form and svg", () => {
    const md = [
      "<style>body{display:none}</style>",
      '<iframe src="https://evil.example/embed"></iframe>',
      '<object data="x.swf"></object><embed src="x.swf">',
      '<form action="/steal"><input type="text" name="q"><button>Go</button></form>',
      '<svg onload="alert(1)"><circle r="1"/></svg>',
      '<p style="background:url(javascript:alert(1))">styled</p>',
    ].join("\n\n");
    const { html } = renderMarkdown(md);
    expect(html).not.toMatch(/<style|<iframe|<object|<embed|<form|<svg|<button|style=/i);
    expect(html).not.toContain("display:none");
    expect(html).not.toContain('type="text"');
    expect(html).toContain("styled");
  });

  it("removes entity-encoded and whitespace-split javascript: URLs", () => {
    const { html } = renderMarkdown(
      [
        '<a href="&#106;avascript:alert(1)">a</a>',
        '<a href="&#x6A;&#x61;&#x76;&#x61;script:alert(2)">b</a>',
        '<a href="java&#x09;script:alert(3)">c</a>',
        '<a href=" javascript:alert(4)">d</a>',
        "![e](javascript:alert(5))",
        "<javascript:alert(6)>",
      ].join("\n\n"),
    );
    // Every one of these anchors loses its href; the autolink survives only as text.
    expect(html).not.toMatch(/href=/);
    expect(html).not.toMatch(/<img/);
    expect(html.toLowerCase()).not.toMatch(/&#106;|&#x6a;/);
  });

  it("drops protocol-relative links and images", () => {
    const { html } = renderMarkdown('<a href="//evil.test/x">a</a> <img src="//evil.test/i.png" alt="i">');
    expect(html).not.toContain("//evil.test");
  });

  it("drops document-level tags: base, meta, link, title", () => {
    const { html } = renderMarkdown(
      '<base href="https://evil.test/">\n\n<meta http-equiv="refresh" content="0;url=https://evil.test">\n\n<link rel="stylesheet" href="https://evil.test/x.css">\n\n<title>x</title>\n\nok',
    );
    expect(html).not.toMatch(/<base|<meta|<link|<title|evil\.test/i);
    expect(html).toContain("ok");
  });

  it("neutralises mutation-XSS shapes (noscript, math/svg namespaces)", () => {
    const vectors = [
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
      "<math><mtext><table><mglyph><style><img src=x onerror=alert(2)></style></mglyph></table></mtext></math>",
      '<svg><a xlink:href="javascript:alert(3)"><text x="20" y="20">x</text></a></svg>',
      '<details open ontoggle="alert(4)"><summary>s</summary>body</details>',
    ];
    for (const v of vectors) {
      const { html } = renderMarkdown(v);
      expect(html, v).not.toMatch(/onerror|ontoggle|javascript:|<svg|<math|<style|<noscript/i);
    }
  });

  it("drops srcset, srcdoc and formaction even on allowed tags", () => {
    const { html } = renderMarkdown(
      '<img src="https://example.com/a.png" srcset="javascript:alert(1) 1x" alt="a">\n\n<iframe srcdoc="<script>alert(2)</script>" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>\n\n<button formaction="javascript:alert(3)">x</button>',
    );
    expect(html).not.toMatch(/srcset|srcdoc|formaction|<button|alert/);
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it("rejects look-alike YouTube hosts and non-embed paths", () => {
    for (const src of [
      "https://www.youtube-nocookie.com.evil.test/embed/dQw4w9WgXcQ",
      "https://evil.test/?https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
      "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(renderMarkdown(`<iframe src="${src}"></iframe>`).html, src).not.toContain("<iframe");
    }
  });

  it("keeps a youtube-nocookie embed, lazily loaded", () => {
    const { html } = renderMarkdown('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Demo"></iframe>');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('loading="lazy"');
  });

  it("strips ids that are not in the slug shape (no DOM clobbering)", () => {
    const { html } = renderMarkdown('<p id="__next">a</p><p id="Main Content">b</p><p id="ok-id">c</p>');
    expect(html).not.toContain('id="__next"');
    expect(html).not.toContain('id="Main Content"');
    expect(html).toContain('id="ok-id"');
  });

  it("marks external links rel=noopener noreferrer and leaves internal links alone", () => {
    const { html } = renderMarkdown("[ext](https://example.org/a) [same](https://site.test/b) [rel](/pricing)", { siteOrigin: "https://site.test" });
    expect(html).toContain('<a href="https://example.org/a" rel="noopener noreferrer">ext</a>');
    expect(html).toContain('<a href="https://site.test/b">same</a>');
    expect(html).toContain('<a href="/pricing">rel</a>');
  });

  it("loads the first image at once, lazy-loads the rest, and decodes them async", () => {
    const { html } = renderMarkdown("![A chart](https://example.com/c.png)\n\n![Later](https://example.com/d.png)");
    const [first, second] = html.match(/<img[^>]*>/g) ?? [];
    expect(first).not.toContain("loading=");
    expect(first).toContain('decoding="async"');
    expect(first).toContain('alt="A chart"');
    expect(second).toContain('loading="lazy"');
    // A body further down a list waits for every image; an author's explicit choice stands.
    expect(renderMarkdown("![a](https://example.com/c.png)", { lazyImages: true }).html).toContain('loading="lazy"');
    expect(renderMarkdown('<img src="https://example.com/c.png" alt="" loading="eager">\n\n![b](https://example.com/d.png)').html).toContain('loading="eager"');
  });

  it("takes an image's size from a trailing =WxH in its title, so the space is reserved", () => {
    const { html } = renderMarkdown('![Chart](https://example.com/c.png "Signups by week =1200x630")\n\n![Bare](https://example.com/d.png "=640x480")');
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="630"');
    expect(html).toContain('title="Signups by week"');
    expect(html).toContain('width="640"');
    expect(html).not.toContain("=640x480");
  });

  it("names every embed and every task-list checkbox", () => {
    const embed = renderMarkdown('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>').html;
    expect(embed).toContain('title="Embedded video"');
    const named = renderMarkdown('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Demo"></iframe>').html;
    expect(named).toContain('title="Demo"');
    const tasks = renderMarkdown("- [x] done\n- [ ] todo").html;
    expect(tasks).toMatch(/<input[^>]*aria-label="Done"[^>]*checked/);
    expect(tasks).toMatch(/<input(?![^>]*checked)[^>]*aria-label="Not done"/);
  });

  it("keeps the code block's language class and escapes its contents", () => {
    const { html } = renderMarkdown("```ts\nconst a = '<b>';\n```\n\n```bad lang\"onmouseover=x\nx\n```");
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("onmouseover");
  });

  it("renders GFM tables, strikethrough and task lists (checkboxes disabled)", () => {
    const { html } = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n\n- [x] done\n- [ ] todo");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(html).toContain("checked");
  });
});

describe("renderMarkdown — headings and TOC", () => {
  it("slugs heading ids and builds a TOC from h2–h4", () => {
    const { html, toc } = renderMarkdown("## Getting started\n\n### Install it\n\n#### Fine print\n\n##### Too deep");
    expect(html).toContain('<h2 id="getting-started">Getting started</h2>');
    expect(html).toContain('<h3 id="install-it">');
    expect(toc).toEqual([
      { id: "getting-started", text: "Getting started", depth: 2 },
      { id: "install-it", text: "Install it", depth: 3 },
      { id: "fine-print", text: "Fine print", depth: 4 },
    ]);
  });

  it("de-duplicates repeated headings", () => {
    const { toc } = renderMarkdown("## Setup\n\n## Setup\n\n## Setup");
    expect(toc.map((t) => t.id)).toEqual(["setup", "setup-2", "setup-3"]);
  });

  it("never collides with a literal heading that looks like a suffix", () => {
    const { toc } = renderMarkdown("## Setup 2\n\n## Setup\n\n## Setup");
    const ids = toc.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("demotes a body # heading to h2, so the page title stays the only h1", () => {
    const { html } = renderMarkdown("# Big\n\ntext");
    expect(html).not.toContain("<h1");
    expect(html).toContain('<h2 id="big">Big</h2>');
  });

  it("uses plain text (not markup) for TOC entries and ids", () => {
    const { toc } = renderMarkdown("## Use `getData()` & *friends*");
    expect(toc[0].text).toBe("Use getData() & friends");
    expect(toc[0].id).toBe("use-getdata-friends");
  });

  it("shifts levels and prefixes ids when a body sits under its own h2", () => {
    const { html, toc } = renderMarkdown("# Top\n\n## Fixed\n\n### Detail", { minDepth: 3, idPrefix: "v1.0" });
    expect(html).toContain('<h3 id="v1-0-top">Top</h3>');
    expect(html).toContain('<h3 id="v1-0-fixed">Fixed</h3>');
    expect(html).toContain('<h4 id="v1-0-detail">Detail</h4>');
    expect(toc.map((t) => t.depth)).toEqual([3, 3, 4]);
  });

  it("prefixes a body's own #heading links with its ids, and leaves other fragments alone", () => {
    const md = "See [below](#upgrading) or [another entry](#v0-9).\n\n## Upgrading";
    const listed = renderMarkdown(md, { minDepth: 3, idPrefix: "v1.0" }).html;
    expect(listed).toContain('<h3 id="v1-0-upgrading">');
    expect(listed).toContain('href="#v1-0-upgrading"');
    expect(listed).toContain('href="#v0-9"');
    // Without a prefix (the permalink, the feed) links stay as written.
    expect(renderMarkdown(md).html).toContain('href="#upgrading"');
  });

  it("falls back to a stable id for a heading with no letters", () => {
    const { toc } = renderMarkdown("## 🚀\n\n## 🚀");
    expect(toc.map((t) => t.id)).toEqual(["section", "section-2"]);
  });
});

describe("reading time", () => {
  it("is at least one minute", () => {
    expect(renderMarkdown("Short.").readingMinutes).toBe(1);
    expect(readingMinutes("")).toBe(1);
  });

  it("scales with length", () => {
    const body = Array.from({ length: 900 }, () => "word").join(" ");
    expect(renderMarkdown(body).readingMinutes).toBe(4);
    expect(readingMinutes(body)).toBe(4);
  });

  it("counts the real words, not minutes × 225, and never glues words across tags", () => {
    expect(renderMarkdown(Array.from({ length: 790 }, () => "word").join(" ")).wordCount).toBe(790);
    expect(renderMarkdown("| a | b |\n|---|---|\n| one | two |\n\n## Heading\n\nText.").wordCount).toBe(6);
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes the common entities", () => {
    expect(htmlToText("<code>a &amp; b</code> &lt;c&gt;")).toBe("a & b <c>");
  });
});
