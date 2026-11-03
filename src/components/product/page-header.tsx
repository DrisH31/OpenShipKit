//
// The top of every product screen: the page's name (its one H1), one sentence
// that says what the page is for or answers its question (on a dashboard, set
// heavier with `emphasis`, and with its freshness in `meta`), and the primary
// action top-right. On a phone the action takes the full width below.
// Server-safe.
//

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  answer,
  action,
  eyebrow,
  meta,
  emphasis = false,
  className,
}: {
  title: React.ReactNode;
  answer?: React.ReactNode;
  action?: React.ReactNode;
  /** A small line above the title ("Blog post", "User"). */
  eyebrow?: React.ReactNode;
  /** A quiet line under the answer: where the figures come from and when (a dashboard's freshness, UI-11). */
  meta?: React.ReactNode;
  /**
   * A dashboard's answer (UI-5): set as the heaviest block on the screen — lead size,
   * semibold, full ink — so "how are we doing" is read before anything else.
   */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <p className="text-caption font-semibold text-ink-3">{eyebrow}</p> : null}
        <h1 className="font-display text-h3 font-bold break-words text-ink">{title}</h1>
        {answer ? (
          <p className={emphasis ? "mt-1 max-w-[44ch] text-lead font-semibold text-pretty text-ink" : "max-w-measure text-small text-ink-2"}>{answer}</p>
        ) : null}
        {meta ? <div className="mt-1 text-caption text-ink-3">{meta}</div> : null}
      </div>
      {action ? (
        <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>a]:flex-1 [&>button]:flex-1 sm:[&>a]:flex-none sm:[&>button]:flex-none">{action}</div>
      ) : null}
    </div>
  );
}
