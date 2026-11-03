/* Standards (web-design): UI-6 Every state is designed */
import { FolderOpenIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/* Every screen has more than one state (web-design craft-product-ui). Each says
   what happened in plain words and offers the next step — never a bare "No data". */

type Kind = "first-use" | "cleared" | "no-results"
const icons = { "first-use": FolderOpenIcon, cleared: FolderOpenIcon, "no-results": SearchXIcon }

export function EmptyState({
  kind = "first-use",
  title,
  body,
  action,
  className,
}: {
  kind?: Kind
  title: string
  body: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const Icon = icons[kind]
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center", className)}>
      <Icon className="size-7 text-ink-3" aria-hidden />
      <p className="text-body font-semibold text-ink">{title}</p>
      <p className="max-w-[44ch] text-small text-ink-2">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* An error says what happened, what to do, and whether anything was lost. */
export function ErrorState({ title, body, action, className }: { title: string; body: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 rounded-xl border border-line-strong bg-danger-soft p-5", className)}>
      <p className="flex items-center gap-2 text-body font-semibold text-danger">
        <TriangleAlertIcon className="size-4" aria-hidden /> {title}
      </p>
      <p className="text-small text-ink">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/* Loading a list: the real layout in grey, so nothing jumps when the rows arrive.
   Announced once ("Loading orders"), never read row by row. */
export function ListSkeleton({ rows = 6, label = "Loading", className }: { rows?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("overflow-hidden rounded-xl border border-line bg-card", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-0">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 flex-1 max-w-48" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
      ))}
    </div>
  )
}

/* A product page while its data loads: the header, a row of cards and a list,
   in grey — the same frame the page fills, so nothing jumps. */
export function PageSkeleton({ label = "Loading", cards = 3, rows = 5 }: { label?: string; cards?: number; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-6">
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {cards > 0 && (
        <div aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
      )}
      <ListSkeleton rows={rows} label={label} className="[&]:border-line" />
    </div>
  )
}
