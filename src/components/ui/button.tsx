/* Standards (web-design): COL-5 One accent, for action only · COL-14 Elevation is a named scale · TYP-5 Letter spacing by job · LAY-4 Touch targets · LAY-5 One solid primary per view · UI-1 One component base, restyled through tokens · UI-8 Forms · UI-17 Feedback where the action happened · UI-19 State lives in attributes · MOT-1 Respond under 100 ms; INP within budget · MOT-6 Physicality */
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"

/* House button — pills.
   - default = THE one action: the inverse fill, highest contrast on the screen. One per view.
   - outline = the second action: a field-strength outline (3:1) that fills on hover.
   - quiet = the third path: a small text link (↗ only when it leaves the site).
   - Press: scale(0.98) in 90 ms on everything you press — popup triggers too, except menus and
     listboxes, which open on press and get a tonal state instead. Hover: 160 ms, quart-out.
   - Touch: 44 px on a coarse pointer (WCAG 2.5.8's floor is 24; a thumb wants 44).
   - `loading`: keeps focus, width and full opacity, sets aria-busy — never looks disabled.
   - `done` + `doneLabel`: the button answers in place (UI-17) — a check and the result
     (“Copied”, “Saved”, “Sent”) for a moment, at the same width (both labels share one grid
     cell, so nothing beside it moves), announced to screen readers. Drive it with useFlash(). */
const buttonCva = cva(
  "group/button relative inline-flex pointer-coarse:after:absolute pointer-coarse:after:inset-x-[min(0px,calc((100%-44px)/2))] pointer-coarse:after:inset-y-[min(0px,calc((100%-44px)/2))] shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding font-semibold tracking-[0.01em] whitespace-nowrap select-none transition-[background-color,border-color,color,scale] duration-(--dur-hover) ease-out-quart active:not-aria-[haspopup=menu]:not-aria-[haspopup=listbox]:scale-[0.98] active:duration-(--dur-press) aria-[haspopup=menu]:active:bg-surface aria-[haspopup=listbox]:active:bg-surface disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-action text-action-ink shadow-action hover:bg-action-hover",   /* the lit top edge and contact shadow: the one thing on the screen that reads as pressable (COL-14) */
        outline: "border-field bg-transparent text-ink hover:bg-tonal aria-expanded:bg-tonal",
        secondary: "bg-tonal text-ink hover:bg-tonal-hover aria-expanded:bg-tonal-hover",   /* tonal — after Astryx Neutral: a second level with no outline */
        ghost: "text-ink-2 hover:bg-tonal hover:text-ink aria-expanded:bg-tonal",
        quiet: "h-auto px-1 font-normal text-ink-3 hover:text-ink-2",
        destructive: "bg-danger-soft text-danger hover:bg-danger-soft-hover hover:text-badge-danger-ink",
        link: "h-auto px-0 text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink",
      },
      size: {
        default: "h-10 gap-2 px-4 text-small pointer-coarse:h-11 has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4",
        xs: "h-7 gap-1 px-3 text-caption [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-2 px-4 text-small [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-12 gap-2 px-6 text-body",
        icon: "size-10 pointer-coarse:size-11",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    /* A link-styled button keeps the text's own edge: no size padding or height may push it
       off the left edge it shares with the copy above it. */
    compoundVariants: [
      { variant: "link", className: "h-auto min-h-0 px-0 has-data-[icon=inline-end]:pe-0 has-data-[icon=inline-start]:ps-0" },
      { variant: "quiet", className: "px-1 has-data-[icon=inline-end]:pe-1 has-data-[icon=inline-start]:ps-1" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/** The variant classes, conflict-resolved. Use this on a <Link> or <a> styled as a button —
 *  raw cva output keeps both `border-transparent` and `border-field`, and CSS order picks
 *  the wrong one (an outline link with no outline). */
function buttonVariants(props?: Parameters<typeof buttonCva>[0]) {
  return cn(buttonCva(props))
}

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  done = false,
  doneLabel,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonCva> & { loading?: boolean; done?: boolean; doneLabel?: React.ReactNode }) {
  // A button that can confirm in place keeps both labels in one cell, so its width is the wider of them.
  const flashable = doneLabel !== undefined
  return (
    <ButtonPrimitive
      data-slot="button"
      // Its state, readable from outside (UI-19): what kind of action, and that it just finished.
      data-variant={variant}
      data-done={done || undefined}
      className={cn(buttonCva({ variant, size, className }))}
      disabled={disabled || loading}
      focusableWhenDisabled={loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible flex items-center gap-[inherit]">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        </>
      ) : flashable ? (
        <>
          {/* gap-[inherit] here too: a one-cell grid ignores the gap, but its children inherit it from this span, not from the button */}
          <span className="grid items-center justify-items-center gap-[inherit] *:[grid-area:1/1]">
            <span className={cn("flex items-center gap-[inherit]", done && "invisible")}>{children}</span>
            <span aria-hidden className={cn("flex items-center gap-[inherit]", !done && "invisible")}>
              {/* always laid out, so the reserved width includes it; it pops in when done */}
              <CheckIcon className={done ? "pop-in" : undefined} />
              {doneLabel}
            </span>
          </span>
          <span className="sr-only" aria-live="polite">{done ? doneLabel : ""}</span>
        </>
      ) : (
        children
      )}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
