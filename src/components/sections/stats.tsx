import "server-only";

//
// Figures with their sources (content key "stats"). Off by default. In
// production a figure with no source is not shown at all (never invent proof);
// in development it is shown with a visible "no source" note so the editor
// sees why it would disappear. Nothing left → no section.
//

import { Container } from "@/components/marketing/layout";
import { isProduction } from "@/server/env";
import { getContent } from "@/server/services/content";

export async function Stats() {
  const stats = await getContent("stats");
  if (!stats.enabled) return null;
  const prod = isProduction();
  const items = stats.items.filter((s) => !prod || s.source.trim());
  if (items.length === 0) return null;

  return (
    <section aria-label="In numbers" className="pb-section">
      <Container>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-4">
          {items.map((s) => (
            <div key={s.label} className="flex flex-col gap-2 border-t border-line-strong pt-5">
              <dt className="order-2 text-small text-ink-2">
                {s.label}
                {s.source.trim() ? (
                  <span className="mt-1 block text-caption text-ink-3">Source: {s.source}</span>
                ) : (
                  <span className="mt-1 block text-caption text-danger">No source: hidden in production</span>
                )}
              </dt>
              <dd className="figure order-1 text-h2 leading-none text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
