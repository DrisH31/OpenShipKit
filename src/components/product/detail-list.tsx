import { cn } from "@/lib/utils"

export type Detail = { label: React.ReactNode; value: React.ReactNode; key?: string; strong?: boolean }

/* Facts as label and value, one component for every screen (after Astryx’s MetadataList).
   A real <dl>, so a screen reader hears each label with its value.
   - "rows": label left, value right; numbers line up at the right edge. For totals, payment
     facts. `strong` marks the row that matters (the total) with weight and a rule above it.
   - "pairs": label in a quiet column, value beside it, left-aligned. For record facts.
   - "stats": two to four facts across, label above value. For a card’s figures; columns
     fit the width, wrapping a fact to the next row only when it no longer fits. */
export function DetailList({
  items,
  variant = "rows",
  className,
}: {
  items: Detail[]
  variant?: "rows" | "pairs" | "stats"
  className?: string
}) {
  if (variant === "stats") {
    return (
      <dl className={cn("grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-3 text-small", className)}>
        {items.map((d, i) => (
          <div key={d.key ?? i} className="flex min-w-0 flex-col">
            <dt className="text-ink-3">{d.label}</dt>
            <dd className="tabular truncate font-semibold text-ink">{d.value}</dd>
          </div>
        ))}
      </dl>
    )
  }
  if (variant === "pairs") {
    return (
      <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-small", className)}>
        {items.map((d, i) => (
          <div key={d.key ?? i} className="contents">
            <dt className="text-ink-2">{d.label}</dt>
            <dd className={cn("min-w-0 text-ink", d.strong && "font-semibold")}>{d.value}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return (
    <dl className={cn("flex flex-col gap-2 text-small", className)}>
      {items.map((d, i) => (
        <div key={d.key ?? i} className={cn("flex items-baseline justify-between gap-4", d.strong && "mt-1 border-t border-line pt-3")}>
          <dt className={d.strong ? "font-semibold text-ink" : "text-ink-2"}>{d.label}</dt>
          <dd className={cn("tabular text-right", d.strong ? "text-body font-semibold text-ink" : "text-ink")}>{d.value}</dd>
        </div>
      ))}
    </dl>
  )
}
