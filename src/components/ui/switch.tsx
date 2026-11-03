"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

/** An on/off setting that takes effect at once, `default` or `sm`, its thumb stretching while
    pressed. A choice saved with a form is a `Checkbox`. */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-[color,background-color,border-color,scale] duration-(--dur-pop) ease-out-quart active:scale-[0.96] active:duration-(--dur-press) group-has-[:focus-visible]/field-label:border-transparent after:absolute after:-inset-x-1.5 after:-inset-y-[13px] aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {/* Held, the thumb stretches towards where it will go, as a real switch gives under a thumb: something
          to fidget with. Its width is the one layout change, kept inside the
          fixed-size track. */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-raised ring-0 shadow-thumb transition-[translate,width] duration-(--dur-pop) ease-out-quart group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-active/switch:group-data-[size=default]/switch:w-5 group-active/switch:group-data-[size=sm]/switch:w-4 group-active/switch:group-data-[size=default]/switch:data-checked:translate-x-3 group-active/switch:group-data-[size=sm]/switch:data-checked:translate-x-2 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
