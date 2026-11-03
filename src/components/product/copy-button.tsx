"use client";

//
// Copy a value to the clipboard and say so in place ("Copied", announced to
// screen readers). Falls back to selecting a hidden textarea when the async
// Clipboard API is unavailable (plain http on a LAN address); if both fail it
// says so, and the value stays visible on the page to copy by hand.
//

import { useState } from "react";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writeClipboard } from "@/lib/clipboard";
import { useFlash } from "@/lib/use-flash";

export function CopyButton({
  value,
  label = "Copy",
  srLabel,
  size = "sm",
  variant = "outline",
  className,
}: {
  value: string;
  label?: string;
  /** A fuller accessible name ("Copy the Cursor config"). */
  srLabel?: string;
  size?: "sm" | "xs" | "default";
  variant?: "outline" | "ghost" | "secondary" | "default";
  className?: string;
}) {
  const [done, flash] = useFlash();
  const [failed, setFailed] = useState(false);
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      aria-label={srLabel}
      done={done}
      doneLabel={failed ? "Copy by hand" : "Copied"}
      onClick={async () => {
        const ok = await writeClipboard(value);
        setFailed(!ok);
        flash();
      }}
    >
      <CopyIcon aria-hidden />
      {label}
    </Button>
  );
}
