"use client";

//
// The small copy button beside one command in a terminal panel (CodePanel's
// gutter). Icon only, so a column of them stays narrow: the copy icon turns
// into a check for a moment and "Copied" is announced to screen readers
// (UI-17). The panel's title bar keeps the labelled CopyButton for the whole
// block; this one copies a single command, without its prompt.
//
// Why not CopyButton itself: it reserves the width of "Copied" beside the icon
// (its two labels share one cell), which is wider than the gutter. Both use the
// same clipboard fallback (src/lib/clipboard.ts: plain http on a LAN address has
// no async Clipboard API); if both ways fail, the icon shows a cross and the
// command stays on the page to select by hand.
//

import { useState } from "react";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { writeClipboard } from "@/lib/clipboard";
import { useFlash } from "@/lib/use-flash";
import { cn } from "@/lib/utils";

export function CopyLineButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [done, flash] = useFlash();
  const [failed, setFailed] = useState(false);
  const Icon = done ? (failed ? XIcon : CheckIcon) : CopyIcon;
  return (
    <button
      type="button"
      aria-label={label}
      title="Copy"
      onClick={async () => {
        const ok = await writeClipboard(value);
        setFailed(!ok);
        flash();
      }}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition-[color,background-color,scale] duration-(--dur-hover) ease-out-quart hover:bg-tonal hover:text-ink active:scale-[0.94] active:duration-(--dur-press) focus-visible:outline-offset-0",
        done && !failed && "text-ink",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-3.5", done && "pop-in")} />
      <span className="sr-only" aria-live="polite">
        {done ? (failed ? "Copy failed: select the command by hand" : "Copied") : ""}
      </span>
    </button>
  );
}
