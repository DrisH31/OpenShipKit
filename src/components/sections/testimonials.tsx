import "server-only";

//
// Quotes from real customers (content key "testimonials"). Off by default and
// shown only when enabled AND there are items: an empty "What people say" is
// worse than none. Each quote names the person; a link, when given, is where
// a stranger can check it. Avatars are optional and lazy.
//

import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { getContent } from "@/server/services/content";

export async function Testimonials() {
  const t = await getContent("testimonials");
  if (!t.enabled || t.items.length === 0) return null;

  return (
    <section aria-labelledby="testimonials-title" data-tone="page" className="py-section">
      <Container>
        <SectionHeader id="testimonials-title" title={t.title} className="max-w-3xl" />
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {t.items.map((q) => (
            <li key={`${q.name}-${q.quote.slice(0, 24)}`}>
              <figure className="flex h-full flex-col gap-6 rounded-xl border border-line bg-card p-6">
                <blockquote className="text-body text-ink">
                  <p>“{q.quote.replace(/^[“"]|[”"]$/g, "")}”</p>
                </blockquote>
                <figcaption className="mt-auto flex items-center gap-3">
                  {q.avatar && (
                    // An editor-supplied URL on any host: a plain lazy img, sized so it never shifts the layout.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={q.avatar} alt="" width={40} height={40} loading="lazy" decoding="async" className="size-10 rounded-full object-cover" />
                  )}
                  <span className="flex flex-col">
                    {q.href ? (
                      <a
                        href={q.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink"
                      >
                        {q.name}
                      </a>
                    ) : (
                      <span className="text-small font-semibold text-ink">{q.name}</span>
                    )}
                    {q.role && <span className="text-small text-ink-3">{q.role}</span>}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
