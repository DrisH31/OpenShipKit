/* Standards (web-design): LAY-9 Content width per job · PAGE-1 Content in the first byte */
import { cn } from "@/lib/utils"

/* Server components: no JavaScript, content in the first byte of HTML. */

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-content px-gutter", className)} {...props} />
}

type Tone = "page" | "band" | "inverse"

/** A full-bleed band. "band" is the 30% surface; "inverse" flips the scheme locally
 *  (a dark band on a light page and vice versa) — use at most one per page, for the close. */
export function Section({
  tone = "page",
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & { tone?: Tone }) {
  return (
    <section
      data-tone={tone}
      className={cn(
        "py-section",
        tone === "band" && "border-y border-line-strong bg-surface",
        tone === "inverse" && "invert-scheme bg-bg text-ink",
        className
      )}
      {...props}
    >
      <Container>{children}</Container>
    </section>
  )
}

