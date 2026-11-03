//
// <MetaList> — a line of small facts separated by dots: "Published Oct 5 ·
// Last saved Oct 6", "Database healthy · 6 ms · https://example.com".
//
// Every item draws its own leading dot (::before, 1rem wide), and the row sits
// 1rem to the left inside a horizontal clip. The dot of whichever item starts
// a line falls in the clipped strip, so a wrap never leaves a dot alone at the
// start or the end of a line, at any width. The dot is decoration: its alt
// text is empty, so screen readers read the facts, not "dot".
//
// Pass each fact as its own element child (a <span>, <time> or <a>); bare
// text children get no dot. Server component.
//

import { cn } from "@/lib/utils";

export function MetaList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 overflow-x-clip [overflow-clip-margin:4px]", className)}>
      <div className="-ml-4 flex flex-wrap items-baseline gap-y-1 *:before:inline-block *:before:w-4 *:before:text-center *:before:text-ink-faint *:before:content-['·'] *:before:[content:'·'_/_'']">
        {children}
      </div>
    </div>
  );
}
