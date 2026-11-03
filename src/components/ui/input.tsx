import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

/* Invalid (aria-invalid="true") draws a danger border 2 px thick: the 1 px border plus a 1 px
   shadow, so nothing shifts. Every form gets it from here; an error message next to the
   control says what is wrong (colour is never the only mark). Its counterpart, data-success (a
   value checked and accepted: a username free, a coupon valid), draws the positive border the same
   way, and aria-busy marks it while it is checked (UI-22; after the code input, v2.11).
   Text is 16 px (text-body) on touch and 14 px only with a mouse or trackpad
   (pointer-fine:text-small): iOS zooms the page into a focused field under 16 px, and a
   width breakpoint (md:) catches a phone held in landscape too. Upstreamed from OpenShipKit (v2.2). */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 pointer-coarse:h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-body shadow-control transition-[color,background-color,border-color] duration-(--dur-hover) hover:border-ink-3 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-small file:font-semibold file:text-foreground placeholder:text-ink-3 aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--color-danger)] data-success:border-positive data-success:shadow-[0_0_0_1px_var(--color-positive)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 pointer-fine:text-small dark:bg-bg dark:disabled:bg-input/80",
        className
      )}
      {...props}
    />
  )
}

export { Input }
