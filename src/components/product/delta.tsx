/* Standards (web-design): COL-3 Never colour alone · UI-5 Dashboards: the answer first */
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { pctChange as pct } from "@/lib/format"

/* A change against the previous period, said three ways: an arrow, a number and a
   word ("up"/"down") — never colour alone (WCAG 1.4.1). `invert` for metrics where
   down is good (refunds, churn). `null` = nothing to compare against, said plainly. */
export function Delta({
  value,
  against,
  invert = false,
  points = false,
  className,
}: {
  value: number | null
  against: string
  invert?: boolean
  /** For rates: `value` is the difference in percentage points (0.074 = 7.4 pts), not a relative change. */
  points?: boolean
  className?: string
}) {
  if (value === null) return <span className={cn("text-small text-ink-3", className)}>No earlier data to compare</span>
  const flat = Math.abs(value) < 0.005
  const up = value > 0
  const good = flat ? null : up !== invert
  const Icon = flat ? MinusIcon : up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 text-small", className)}>
      <span className={cn("inline-flex items-center gap-1 font-semibold whitespace-nowrap", good === null ? "text-ink-2" : good ? "text-positive" : "text-danger")}>
        <Icon className="size-3.5" aria-hidden />
        {!flat && <span className="sr-only">{up ? "Up" : "Down"}</span>}
        {flat ? "Same" : points ? `${(Math.abs(value) * 100).toFixed(1)} pts` : pct.format(value)}
      </span>
      <span className="text-ink-3">{flat ? "as" : "vs"} {against}</span>
    </span>
  )
}
