/* Standards (web-design): UI-12 Charts answer a question */
import { cn } from "@/lib/utils"

/* A trend at a glance beside a KPI. Decorative by design (aria-hidden): the number
   next to it carries the meaning; the chart on the page carries the detail.
   `partial`: the last value is a period still running (today so far). Its segment is
   dashed and its point hollow, so a part-day never reads as a plunge (UI-12). */
export function Sparkline({ values, partial = false, className }: { values: number[]; partial?: boolean; className?: string }) {
  if (values.length < 2) return null
  const w = 120, h = 32, pad = 2
  const max = Math.max(...values), min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / (values.length - 1), h - pad - ((v - min) / span) * (h - pad * 2)])
  const line = (ps: number[][]) => ps.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const d = line(pts)
  const solid = partial ? line(pts.slice(0, -1)) : d
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-28 overflow-visible", className)} aria-hidden="true" preserveAspectRatio="none">
      <path d={`${d} L${lx},${h} L${pad},${h} Z`} className="fill-tonal" />
      <path d={solid} className="fill-none stroke-ink-2" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {partial && <path d={line(pts.slice(-2))} className="fill-none stroke-ink-2" strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <circle cx={lx} cy={ly} r={2.5} className={partial ? "fill-card stroke-ink-2" : "fill-ink"} strokeWidth={partial ? 1.5 : 0} />
    </svg>
  )
}
