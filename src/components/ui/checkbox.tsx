"use client"

/* Standards (web-design): LAY-4 Touch targets */
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

/** One yes/no choice, or several from a short list, its hit area grown to a full touch target
    (LAY-4); put it in a `Field` with its label beside it. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-card shadow-control transition-[background-color,border-color,scale] duration-(--dur-hover) ease-out-quart active:scale-[0.9] active:duration-(--dur-press) group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-3.5 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary hover:border-ink-3 dark:bg-bg dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-[opacity,scale] duration-(--dur-pop) ease-out-back data-starting-style:scale-[0.6] data-starting-style:opacity-0 data-ending-style:scale-[0.6] data-ending-style:opacity-0 data-ending-style:duration-(--dur-pop-exit) data-ending-style:ease-out-quart [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
