//
// OPENSHIPKIT SHOWCASE — the clone command as one copyable line, under the
// hero's buttons: the page's first value is the app running on the visitor's
// machine (DESIGN.md, the fastest path), and this is its first command. A
// muted prompt that isn't copied, the command in the mono face, and the gutter
// copy button the terminal panels use (it announces "Copied"). The command is
// the repository's own clone URL (src/shared/project.ts), never typed twice.
// Server-rendered; only the button is a client component.
//

import { CopyLineButton } from "@/components/marketing/copy-line-button";
import { cn } from "@/lib/utils";
import { OPENSHIPKIT_CLONE_URL } from "@/shared/project";

export const CLONE_COMMAND = `git clone ${OPENSHIPKIT_CLONE_URL}`;

export function CloneCommand({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full border border-line-strong bg-card py-1 pr-1 pl-4 font-mono text-small text-ink shadow-[0_1px_0_0_var(--line)]",
        className,
      )}
    >
      <span aria-hidden className="text-ink-faint select-none">$</span>
      {/* The URL may not fit a phone: it scrolls inside the pill, never the page. The max width
          caps its intrinsic size too (min-width: 0 alone doesn't), so a shrink-to-fit parent
          (the close's column) never grows past the screen to hold it. */}
      <code className="max-w-[calc(100vw-8rem)] min-w-0 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">{CLONE_COMMAND}</code>
      <CopyLineButton value={CLONE_COMMAND} label="Copy the clone command" className="shrink-0 rounded-full pointer-coarse:size-11" />
    </div>
  );
}
