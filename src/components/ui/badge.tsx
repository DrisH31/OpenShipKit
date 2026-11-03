/* Standards (web-design): COL-3 Never colour alone */
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* Badges label a thing's state — a word, short, never the only signal.
   Soft tints with dark text (after Astryx Neutral's pastel badges), each pair ≥ 4.5:1.
   The accent never appears here: it belongs to the action. */
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-3 text-caption font-semibold whitespace-nowrap transition-[color,background-color,border-color] has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-tonal text-ink [a]:hover:bg-tonal-hover",
        secondary: "bg-tonal text-ink-2 [a]:hover:bg-tonal-hover",
        positive: "bg-positive-soft text-badge-positive",
        warning: "bg-warning-soft text-badge-warning",
        danger: "bg-danger-soft text-badge-danger",
        destructive: "bg-danger-soft text-badge-danger",
        info: "bg-info-soft text-badge-info",
        outline: "border-line-strong text-ink-2 [a]:hover:text-ink",
        ghost: "text-ink-2 hover:bg-tonal",
        link: "text-ink underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
