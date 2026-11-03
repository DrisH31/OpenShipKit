"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle relative inline-flex pointer-coarse:after:absolute pointer-coarse:after:inset-x-[min(0px,calc((100%-44px)/2))] pointer-coarse:after:inset-y-[min(0px,calc((100%-44px)/2))] items-center justify-center gap-1 rounded-full text-small font-semibold text-ink-2 whitespace-nowrap transition-[color,background-color,border-color,scale] duration-(--dur-hover) ease-out-quart active:scale-[0.96] active:duration-(--dur-press) hover:bg-tonal hover:text-ink disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-tonal-hover aria-pressed:text-ink data-pressed:bg-tonal-hover data-pressed:text-ink dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-line-strong bg-transparent aria-pressed:border-field",
      },
      size: {
        default:
          "h-8 min-w-8 px-3 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        sm: "h-7 min-w-7 px-3 text-caption has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-3 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/** A button that stays pressed (bold on, a filter applied), its state in `aria-pressed`; `variant`
    default or outline, `size` sm, default or lg. */
function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
