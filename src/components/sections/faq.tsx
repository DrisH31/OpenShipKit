import "server-only";

//
// Questions and answers (content key "faq", or items passed in by a page):
// native <details>, so every answer is in the HTML for people without
// JavaScript, for search engines and for AI answers. Emits FAQPage JSON-LD for
// exactly the questions shown, unless the page turns it off (`emitJsonLd`): the
// showcase's /pricing answers about SAMPLE plans, and markup read on its own
// would present them as the site's own prices. Answers are plain text; blank
// lines become paragraphs.
//

import { FAQ } from "@/components/marketing/faq";
import { Container } from "@/components/marketing/layout";
import { Heading } from "@/components/marketing/type";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageJsonLd } from "@/shared/jsonld";
import { getContent } from "@/server/services/content";

export interface FaqEntry {
  question: string;
  answer: string;
}

function Answer({ text }: { text: string }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-3">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

/**
 * The FAQ band. Pass `items` and `title` to show a page's own questions instead of the content ones.
 * `emitJsonLd={false}` renders the questions without FAQPage markup (answers that aren't the site's own claims).
 */
export async function Faq({
  items,
  title,
  id = "faq",
  emitJsonLd = true,
  aside,
}: {
  items?: FaqEntry[];
  title?: string;
  id?: string;
  emitJsonLd?: boolean;
  /** Under the heading: where to ask what the list doesn't answer (the showcase points at its docs and issues). */
  aside?: React.ReactNode;
}) {
  const content = items ? null : await getContent("faq");
  const list = items ?? content?.items ?? [];
  if (list.length === 0) return null;
  const heading = title ?? content?.title ?? "Questions";

  return (
    <section id={id} aria-labelledby={`${id}-title`} data-tone="page" className="py-section">
      <Container>
        <div className="grid-12 gap-x-8 gap-y-10">
          <div className="col-span-4 sm:col-span-12 lg:col-span-4">
            <Heading id={`${id}-title`} className="max-w-[16ch]">
              {heading}
            </Heading>
            {aside && <div className="mt-6 max-w-[36ch] text-small text-ink-2">{aside}</div>}
          </div>
          <div className="col-span-4 sm:col-span-12 lg:col-span-8">
            <FAQ items={list.map((q) => ({ q: q.question, a: <Answer text={q.answer} /> }))} />
          </div>
        </div>
      </Container>
      {emitJsonLd && <JsonLd data={faqPageJsonLd(list)} />}
    </section>
  );
}
