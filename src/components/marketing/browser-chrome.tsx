/* Standards (web-design): PAGE-2 The real product, shown */
import { LockIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/* A desktop browser window drawn in CSS around the product: a quiet toolbar (three window
   dots, the address with its lock, and `actions` on the right when given — the hero's
   "Watch an agent edit"), then `children` edge to edge — the hero's admin preview, or a
   screenshot. One soft shadow; a hairline that stays visible in dark mode; the toolbar
   carries a 1 px top highlight (data-chrome-bar, base.css) so the frame reads as lit.
   Extra props (role, aria-label) go on the frame: a static picture can be role="img",
   the interactive preview a labelled region. With actions, the dots
   and the address give way below 640 px, so the control has the row to itself. */
export function BrowserChrome({
  url,
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** What the address bar shows, e.g. "your-domain.com/admin". */
  url: string
  /** Controls at the toolbar's right edge. */
  actions?: React.ReactNode
}) {
  return (
    <div data-mockup className={cn("overflow-hidden rounded-xl border border-line-strong bg-raised shadow-mockup", className)} {...props}>
      <div data-chrome-bar className={cn("relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line bg-surface px-3 py-2 sm:px-4", actions && "max-sm:grid-cols-1")}>
        <span aria-hidden className={cn("flex gap-2", actions && "max-sm:hidden")}>
          {[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-line-strong" />)}
        </span>
        <span className={cn("flex max-w-xs min-w-0 items-center gap-2 rounded-md bg-bg px-3 py-1 text-caption text-ink-3", actions ? "max-sm:hidden sm:mx-auto" : "mx-auto")}>
          <LockIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{url}</span>
        </span>
        {actions ? <span className="flex items-center justify-center sm:justify-end">{actions}</span> : <span aria-hidden className="w-[2.375rem]" />}
      </div>
      {children}
    </div>
  )
}
