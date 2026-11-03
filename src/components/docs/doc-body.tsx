//
// A rendered doc inside the .prose typography, in its docs width (.prose-docs
// in src/styles/prose.css: text at the reading measure, code and tables across
// the whole column), with copy buttons added to its code blocks after
// hydration. `html` MUST come from renderDoc() in src/server/docs.ts, which
// sanitises it — never pass anything else here. Server component.
//

import { DocsCodeCopy } from "./code-copy";

const BODY_ID = "doc-body";

/** `lead`: the body's opening paragraph is the page's lead (a doc page has no separate one). */
export function DocBody({ html, lead = false }: { html: string; lead?: boolean }) {
  return (
    <>
      <div id={BODY_ID} className={lead ? "prose prose-docs prose-lead" : "prose prose-docs"} dangerouslySetInnerHTML={{ __html: html }} />
      <DocsCodeCopy containerId={BODY_ID} />
    </>
  );
}
