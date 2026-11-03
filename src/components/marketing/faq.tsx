/* Standards (web-design): PAGE-1 Content in the first byte */
import { PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/* FAQ on native <details>: every answer is in the HTML (for people with JS off,
   for Google, for AI answers) — a component-library accordion that unmounts closed
   panels hides them. Height animates with the grid-rows trick (motion.css). */
export function FAQ({ items, className }: { items: { q: string; a: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
            {item.q}
            <PlusIcon
              aria-hidden
              className="size-4 shrink-0 text-ink-faint transition-[rotate,color] duration-(--dur-ui) ease-out-quart group-open:rotate-45 group-hover:text-ink"
            />
          </summary>
          <div className="disclosure-panel">
            <div>
              <div className="max-w-measure pb-6 text-ink-2">{item.a}</div>
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}
