/* Standards (web-design): UI-5 Dashboards: the answer first */
import { cn } from "@/lib/utils"

/* A key figure for product UI (web-design craft-product-ui): the label ABOVE, small
   and quiet; the figure in Inter 600 tabular (it changes and aligns); the change
   against the last period; a trend at a glance (top right, so a long figure never
   collides with it); and where it came from, and when. */
export function KPI({
  label,
  value,
  delta,
  trend,
  note,
  updated,
  source,
  size = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  label: string
  value: React.ReactNode
  delta?: React.ReactNode
  trend?: React.ReactNode
  note?: React.ReactNode
  updated?: string
  source?: string
  /** "lg" for the screen’s answer — the one figure the page exists to show (its rank 1). */
  size?: "default" | "lg"
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-line bg-card p-5", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-small text-pretty text-ink-3">{label}</span>
        {/* The trend gives way to the label: it narrows (down to 3 rem) before the label wraps, and a long label wraps rather than run past the card. */}
        {trend && <div className="flex min-w-12 max-w-28 flex-1 justify-end [&_svg]:w-full">{trend}</div>}
      </div>
      <span className={cn("tabular font-semibold text-ink", size === "lg" ? "text-figure" : "text-h3", "leading-none")}>{value}</span>
      {(delta || note) && (
        <div className="flex flex-col gap-1">
          {delta}
          {note && <span className="text-small text-ink-3">{note}</span>}
        </div>
      )}
      {(updated || source) && (
        <span className="text-caption text-ink-3">
          {updated && <>Updated {updated}</>}
          {updated && source && " · "}
          {source}
        </span>
      )}
    </div>
  )
}
