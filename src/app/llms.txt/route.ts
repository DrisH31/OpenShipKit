//
// /llms.txt — the llmstxt.org map of the site: name, summary, key pages,
// pricing from the active plans, the newest posts and releases, legal pages,
// and — while the docs are published (the showcase, or
// OPENSHIPKIT_PUBLIC_DOCS=true) — every /docs page, placed before the
// "Optional" section, which llmstxt.org reserves for what can be skipped.
// Request-time: it reads the DataStore (and throws, as a 500, if that fails).
//

import { buildLlmsTxt, llmsResponse } from "@/components/seo/llms";
import { getSiteSeo } from "@/components/seo/site-seo";
import { docsOn, docsPath, getDocsIndex } from "@/server/docs";
import { publicDocs } from "@/server/env";
import { absoluteUrl } from "@/shared/seo";

export const dynamic = "force-dynamic";

/** The "## Docs" section: the index, then every page in sidebar order. Empty while the docs are off. */
async function docsSection(): Promise<string> {
  const { base, showcase } = await getSiteSeo();
  if (!docsOn(showcase, publicDocs())) return "";
  const index = await getDocsIndex();
  const entries = [index.bySlug.get(""), ...index.order].filter((e) => e !== undefined);
  if (entries.length === 0) return "";
  const line = (title: string, path: string, note: string) =>
    `- [${title.replace(/[[\]]/g, "")}](${absoluteUrl(base, path)})${note ? `: ${note.replace(/\s+/g, " ").trim()}` : ""}`;
  return ["## Docs", "", ...entries.map((e) => line(e.slug ? e.title : "Docs overview", docsPath(e.slug), e.description)), "", ""].join("\n");
}

export async function GET() {
  const [text, docs] = await Promise.all([buildLlmsTxt(), docsSection()]);
  if (!docs) return llmsResponse(text);
  const optional = text.indexOf("\n## Optional\n");
  return llmsResponse(optional >= 0 ? `${text.slice(0, optional + 1)}${docs}${text.slice(optional + 1)}` : `${text}\n${docs}`);
}
