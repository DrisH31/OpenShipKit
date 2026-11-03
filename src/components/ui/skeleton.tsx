/* Standards (web-design): UI-6 Every state is designed */
import { cn } from "@/lib/utils"

/** A placeholder in the shape of content that is still loading, shimmering on the loop token; only
    where the wait is real (UI-6). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("shimmer rounded-md bg-tonal-hover", className)}
      {...props}
    />
  )
}

export { Skeleton }
