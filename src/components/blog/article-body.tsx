//
// A rendered Markdown body inside the .prose typography (src/styles/prose.css).
// `html` MUST come from renderMarkdown() in src/server/markdown.ts, which
// sanitises it — never pass anything else here. Server component.
//

import { cn } from "@/lib/utils";

export function ArticleBody({ html, className }: { html: string; className?: string }) {
  return <div className={cn("prose", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
