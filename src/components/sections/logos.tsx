import "server-only";

//
// The "built on" strip under the hero (content key "logos"): the open-source
// tools this template is built on and the ones it deploys with, each as its
// monochrome mark beside its name. Marks come from ./tool-marks (Simple Icons,
// CC0); a name with no mark — a real customer, Dokploy (its licence grants no
// trademark use), a tool not listed there — shows as type alone, so the strip
// never shows a borrowed or wrong logo. We show only what's true: the tools it
// is built on and documents, or customers who said yes.
//
// Groups: items that name a `group` are shown together under it, in the order
// the groups first appear ("Built on", then "Deploys to servers you control");
// the section's title stays the heading for screen readers. Items with no group
// form one row under the visible title, as before groups existed.
//
// Its bottom space is tighter than a full section's (pb-section): the strip is
// a footnote to the hero, so the band after it should read as close by.
//
// Quiet on purpose: ink-2 names and marks that darken on hover, no tiles, no
// colour — it answers "is the foundation sound, and will it run where I run
// things?" without competing with the hero above it. Each item links out when
// it has an href. Hidden when disabled or empty.
//

import { Container } from "@/components/marketing/layout";
import { cn } from "@/lib/utils";
import { getContent } from "@/server/services/content";
import { ToolMarkIcon } from "./tool-mark-icon";

interface LogoItem {
  name: string;
  href: string;
  group: string;
}

/** Items grouped by their `group`, in first-appearance order; ungrouped items form one nameless group. */
export function groupLogos(items: LogoItem[]): { name: string; items: LogoItem[] }[] {
  const groups = new Map<string, LogoItem[]>();
  for (const item of items) {
    const key = item.group.trim();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([name, list]) => ({ name, items: list }));
}

function Row({ items, labelledBy }: { items: LogoItem[]; labelledBy?: string }) {
  const itemClass = "inline-flex min-h-11 items-center gap-2.5 text-ink-2";
  return (
    // Phone: two even columns (tidy rows). Wider: one centred row.
    <ul
      aria-labelledby={labelledBy}
      className="mx-auto grid w-fit grid-cols-2 gap-x-8 gap-y-1 md:flex md:w-auto md:flex-wrap md:items-center md:justify-center md:gap-x-10 lg:gap-x-12"
    >
      {items.map((item) => {
        const inner = (
          <>
            <ToolMarkIcon name={item.name} className="sm:size-[1.375rem]" />
            <span className="font-display text-body font-semibold tracking-[-0.01em] sm:text-lead">{item.name}</span>
          </>
        );
        return (
          <li key={item.name}>
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(itemClass, "transition-colors duration-(--dur-hover) hover:text-ink")}
              >
                {inner}
              </a>
            ) : (
              <span className={itemClass}>{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export async function Logos() {
  const logos = await getContent("logos");
  if (!logos.enabled || logos.items.length === 0) return null;
  const groups = groupLogos(logos.items);
  const named = groups.some((g) => g.name);

  return (
    <section aria-labelledby="logos-title" className="pb-14 sm:pb-20">
      <Container>
        <h2 id="logos-title" className={cn("text-center font-sans text-small font-normal text-ink-3", named && "sr-only")}>
          {logos.title}
        </h2>
        {named ? (
          <div className="flex flex-col gap-8 sm:gap-10">
            {groups.map((g, i) => (
              <div key={g.name || i} className="flex flex-col items-center gap-4">
                {/* A label, not an h3: the dark scheme's unlayered heading weight (base.css, TYP-10) would make it bold. */}
                {g.name && (
                  <p id={`logos-group-${i}`} className="text-small text-ink-3">
                    {g.name}
                  </p>
                )}
                <Row items={g.items} labelledBy={g.name ? `logos-group-${i}` : undefined} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5">
            <Row items={logos.items} />
          </div>
        )}
      </Container>
    </section>
  );
}
