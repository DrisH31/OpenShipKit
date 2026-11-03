"use client"

/* Standards (web-design): UI-7 Lists and tables · UI-27 A scroll stays where it began · UI-30 A scroller says so, and takes the keyboard */
import * as React from "react"
import { cn } from "@/lib/utils"

/* A table wider than its column scrolls sideways inside its container. While it does, the
   container is a named, focusable region, so a keyboard can scroll it in every browser
   (Safari doesn't make scroll containers focusable, and cells past the edge often hold
   nothing focusable to scroll them into view). While it fits, it is a plain div: no extra
   tab stop. The name is `label`, else the table's aria-label, else its caption.
   While it overflows, the right edge also carries the soft "more this way" shade
   (.scroll-shade, base.css), which is covered once the end is in view. The shade's
   cover is --scroll-cover, the colour behind the table: --surface by default (the
   card every table here sits on); set it on an ancestor for another surface. The
   container takes its wrapper's corner radius, so the cover never paints over a
   rounded border. */
function Table({
  className,
  label,
  ...props
}: React.ComponentProps<"table"> & {
  /** What the scroll region is called while the table overflows ("Plans"). */
  label?: string
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const tableRef = React.useRef<HTMLTableElement>(null)
  const [overflows, setOverflows] = React.useState(false)
  const [caption, setCaption] = React.useState<string>()

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => setOverflows(container.scrollWidth > container.clientWidth + 1)
    measure()
    setCaption(tableRef.current?.caption?.textContent?.trim() || undefined)
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    if (tableRef.current) observer.observe(tableRef.current)
    return () => observer.disconnect()
  }, [])

  const name = label ?? props["aria-label"] ?? caption ?? "Table"
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto overscroll-x-contain rounded-[inherit] focus-visible:outline-offset-[-2px]",
        overflows && "scroll-shade"
      )}
      {...(overflows ? { tabIndex: 0, role: "region", "aria-label": name } : {})}
    >
      <table
        ref={tableRef}
        data-slot="table"
        className={cn("w-full caption-bottom text-small", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-semibold [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-start align-middle text-small font-semibold whitespace-nowrap text-ink-3 first:ps-4 last:pe-4 [&:has([role=checkbox])]:pe-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0 first:ps-4 last:pe-4",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-small text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
