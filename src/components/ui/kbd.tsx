import { cn } from "@/lib/utils"

/** A keyboard key as text (⌘K, Esc), read left to right in any language (TYP-12); `KbdGroup` holds
    a chord. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border border-line-strong bg-surface px-1 font-sans text-caption font-semibold text-ink-2 shadow-[inset_0_-1px_0_var(--line-strong)] select-none in-data-[slot=tooltip-content]:border-transparent in-data-[slot=tooltip-content]:shadow-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
