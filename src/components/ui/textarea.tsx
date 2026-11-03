import * as React from "react"
import { cn } from "@/lib/utils"

/* Invalid (aria-invalid="true") draws a danger border 2 px thick: the 1 px border plus a 1 px
   shadow, so nothing shifts. Every form gets it from here; an error message next to the
   control says what is wrong (colour is never the only mark).
   Text is 16 px (text-body) on touch and 14 px only with a mouse or trackpad
   (pointer-fine:text-small): iOS zooms the page into a focused field under 16 px, and a
   width breakpoint (md:) catches a phone held in landscape too. Upstreamed from OpenShipKit (v2.2). */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-card px-3 py-2 text-body shadow-control transition-[color,background-color,border-color] duration-(--dur-hover) hover:border-ink-3 placeholder:text-ink-3 aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--color-danger)] disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 pointer-fine:text-small dark:bg-bg dark:disabled:bg-input/80",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
