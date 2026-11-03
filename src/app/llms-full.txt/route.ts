//
// /llms-full.txt — the same header as /llms.txt, then the full Markdown of
// every published blog post, changelog entry and page, with URLs and dates;
// then, while the docs are published (the showcase, or
// OPENSHIPKIT_PUBLIC_DOCS=true), every /docs page in sidebar order, its links
// pointing where the site's own pages point (src/server/docs.ts) and made
// absolute, its headings pushed under its "###" title.
// Request-time: it reads the DataStore (and throws, as a 500, if that fails).
//

import { buildLlmsFullTxt, demoteHeadings, llmsResponse } from "@/components/seo/llms";
import { getSiteSeo } from "@/components/seo/site-seo";
import { docsOn, docsPath, getDoc, getDocsIndex, rewriteMarkdownLinks } from "@/server/docs";
import { publicDocs } from "@/server/env";
import { absoluteUrl, absolutizeMarkdownLinks } from "@/shared/seo";

export const dynamic = "force-dynamic";

/** "## Docs" and every page in full. Empty while the docs are off. */
async function docsSection(): Promise<string> {
  const { base, showcase } = await getSiteSeo();
  if (!docsOn(showcase, publicDocs())) return "";
  const index = await getDocsIndex();
  const known = new Set(index.bySlug.keys());
  const entries = [index.bySlug.get(""), ...index.order].filter((e) => e !== undefined);
  if (entries.length === 0) return "";
  const lines = ["## Docs", ""];
  for (const entry of entries) {
    const page = await getDoc(entry.slug);
    if (!page) continue;
    const url = absoluteUrl(base, docsPath(entry.slug));
    const body = absolutizeMarkdownLinks(demoteHeadings(rewriteMarkdownLinks(page.markdown, entry.file, known)), base, url).trim();
    lines.push(`### ${entry.title.replace(/\s+/g, " ")}`, "", `URL: ${url}`, "", body, "", "---", "");
  }
  return lines.join("\n");
}

export async function GET() {
  const [text, docs] = await Promise.all([buildLlmsFullTxt(), docsSection()]);
  return llmsResponse(docs ? `${text}\n${docs}` : text);
}
