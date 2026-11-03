/* Standards (web-design): LAY-12 One grid under every section */
import { cn } from "@/lib/utils"

/* One grid under every section of every screen, marketing and product alike (LAY-12):
   4 columns on a phone, 12 from 640 px. A section takes one, two or three columns of it;
   four or more only for small repeated items (figures, tiles, cards in a list).
   - A component's own insides (a chart's axis column, a form's pair of fields, a list row)
     keep their own layout: the grid places sections and blocks, not their parts.
   - Gaps: the page rhythm by default; a product screen passes its tighter gap (gap-3 sm:gap-4).
   Server-safe: no hooks, so pages stay readable before any JavaScript (PAGE-1).
   The class names are spelled out so Tailwind sees them. */

type N = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
type Bp = "sm" | "md" | "lg"

const SPAN: Record<Bp, Record<N, string>> = {
  sm: { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 5: "sm:col-span-5", 6: "sm:col-span-6", 7: "sm:col-span-7", 8: "sm:col-span-8", 9: "sm:col-span-9", 10: "sm:col-span-10", 11: "sm:col-span-11", 12: "sm:col-span-12" },
  md: { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4", 5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8", 9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12" },
  lg: { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4", 5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8", 9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12" },
}
const START: Record<Bp, Record<N, string>> = {
  sm: { 1: "sm:col-start-1 sm:row-start-1", 2: "sm:col-start-2 sm:row-start-1", 3: "sm:col-start-3 sm:row-start-1", 4: "sm:col-start-4 sm:row-start-1", 5: "sm:col-start-5 sm:row-start-1", 6: "sm:col-start-6 sm:row-start-1", 7: "sm:col-start-7 sm:row-start-1", 8: "sm:col-start-8 sm:row-start-1", 9: "sm:col-start-9 sm:row-start-1", 10: "sm:col-start-10 sm:row-start-1", 11: "sm:col-start-11 sm:row-start-1", 12: "sm:col-start-12 sm:row-start-1" },
  md: { 1: "md:col-start-1 md:row-start-1", 2: "md:col-start-2 md:row-start-1", 3: "md:col-start-3 md:row-start-1", 4: "md:col-start-4 md:row-start-1", 5: "md:col-start-5 md:row-start-1", 6: "md:col-start-6 md:row-start-1", 7: "md:col-start-7 md:row-start-1", 8: "md:col-start-8 md:row-start-1", 9: "md:col-start-9 md:row-start-1", 10: "md:col-start-10 md:row-start-1", 11: "md:col-start-11 md:row-start-1", 12: "md:col-start-12 md:row-start-1" },
  lg: { 1: "lg:col-start-1 lg:row-start-1", 2: "lg:col-start-2 lg:row-start-1", 3: "lg:col-start-3 lg:row-start-1", 4: "lg:col-start-4 lg:row-start-1", 5: "lg:col-start-5 lg:row-start-1", 6: "lg:col-start-6 lg:row-start-1", 7: "lg:col-start-7 lg:row-start-1", 8: "lg:col-start-8 lg:row-start-1", 9: "lg:col-start-9 lg:row-start-1", 10: "lg:col-start-10 lg:row-start-1", 11: "lg:col-start-11 lg:row-start-1", 12: "lg:col-start-12 lg:row-start-1" },
}
const PHONE = { 1: "col-span-1", 2: "col-span-2", 4: "col-span-4" } as const

export function Grid({ as = "div", className, ...props }: React.ComponentProps<"div"> & { as?: "div" | "section" | "ul" | "ol" }) {
  const Tag = as as "div" // the element changes, the props don't
  return <Tag data-grid="" className={cn("grid-12 gap-x-6 gap-y-8 sm:gap-x-8", className)} {...props} />
}

/** A column: `phone` of 4 (default all 4), then `sm`, `md`, `lg` of 12, each holding until the
 *  next is given (sm defaults to 12). `start` places it at a breakpoint and keeps it on the first
 *  row, so a flipped pair stays side by side. */
export function Col({ as = "div", phone = 4, sm = 12, md, lg, start, className, ...props }: React.ComponentProps<"div"> & {
  as?: "div" | "li" | "section" | "article"
  phone?: 1 | 2 | 4
  sm?: N
  md?: N
  lg?: N
  start?: Partial<Record<Bp, N>>
}) {
  const Tag = as as "div"
  return (
    <Tag
      className={cn(
        "min-w-0",
        PHONE[phone],
        SPAN.sm[sm],
        md && SPAN.md[md],
        lg && SPAN.lg[lg],
        start && (Object.entries(start) as [Bp, N][]).map(([b, n]) => START[b][n]),
        className
      )}
      {...props}
    />
  )
}
