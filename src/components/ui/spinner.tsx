import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

/** A working indicator (`role="status"`, "Loading") at the text's size, which slows rather than
    stops under reduced motion; always beside words that say what is happening. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
