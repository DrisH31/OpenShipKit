/* Standards (web-design): TYP-2 Every level steps clearly · TYP-3 One H1, and tags match the look · TYP-5 Letter spacing by job · TYP-6 Line length · TYP-11 Organised type: fixed roles, one rhythm */
import { cn } from "@/lib/utils"

/* The type scale as components, so a page can’t drift from it.
   Display and headings: Space Grotesk 700, tracking tightening with size. */

/** The section label: Inter 600, 12 px, caps, tracked. `live` adds a green dot that
 *  says "this is current" — once per page at most. */
export function Eyebrow({ live = false, className, children, ...props }: React.ComponentProps<"p"> & { live?: boolean }) {
  return (
    <p className={cn("flex items-center gap-3 font-sans text-eyebrow font-semibold text-ink-3 uppercase", className)} {...props}>
      {live && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-positive" />}
      <span>{children}</span>
    </p>
  )
}

/** The page’s one claim. An <h1> by default; use as="h2" when a display line isn’t the page title. */
export function Display({ as: Tag = "h1", className, ...props }: React.ComponentProps<"h1"> & { as?: "h1" | "h2" | "p" }) {
  return <Tag className={cn("font-display text-display font-bold text-ink", className)} {...props} />
}

export function Heading({
  level = 2,
  className,
  ...props
}: React.ComponentProps<"h2"> & { level?: 1 | 2 | 3 }) {
  const Tag = (`h${level}` as "h1" | "h2" | "h3")
  const size = level === 1 ? "text-h1" : level === 2 ? "text-h2" : "text-h3"
  return <Tag className={cn("font-display font-bold text-ink", size, className)} {...props} />
}

export function Lead({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("max-w-measure text-lead text-ink-2", className)} {...props} />
}
