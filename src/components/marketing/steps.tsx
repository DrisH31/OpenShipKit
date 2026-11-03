/* Standards (web-design): LAY-12 One grid under every section */
import { cn } from "@/lib/utils"
import { Col, Grid } from "@/components/layout/grid"

/* "How it works": a real sequence, so the numbers carry information (the order is the
   point). Each step says what you do and, where it helps belief, shows the thing that
   does it (a screen crop, a CodePanel). Words left, proof right; one column on a phone. */
export function Steps({
  items,
  className,
}: {
  items: { title: React.ReactNode; body: React.ReactNode; visual?: React.ReactNode }[]
  className?: string
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((s, i) => (
        <li key={i} className="border-t border-line py-10 first:border-t-0 first:pt-0 last:pb-0">
          <Grid className="gap-y-5">
          <Col lg={5} className="flex gap-5">
            <span aria-hidden className="figure w-6 shrink-0 text-h3 leading-none text-ink-faint">{i + 1}</span>
            <div className="flex flex-col gap-2">
              <h3 className="text-h3"><span className="sr-only">Step {i + 1}: </span>{s.title}</h3>
              <div className="max-w-[46ch] text-ink-2">{s.body}</div>
            </div>
          </Col>
          {s.visual && <Col lg={7}>{s.visual}</Col>}
          </Grid>
        </li>
      ))}
    </ol>
  )
}
