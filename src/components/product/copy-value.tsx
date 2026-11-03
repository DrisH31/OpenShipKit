//
// <CopyValue> — a value the person has to paste somewhere else (an endpoint,
// a webhook address), inline in a sentence: the value in mono with a Copy
// button beside it. Long URLs wrap only at their slashes ("…:3000/" ⏎
// "api/mcp"), never mid-word; a single segment too long for the line still
// wraps rather than run off the screen.
//
// No "use client": server pages render it; only the button is a client island.
//

import { Fragment } from "react";
import { CopyButton } from "@/components/product/copy-button";
import { cn } from "@/lib/utils";

/** Break opportunities after each path slash (not inside "://"). */
export function breakableUrl(value: string): React.ReactNode {
  const parts = value.split(/(?<=[^/:]\/)(?=[^/])/);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}

/** An email that may wrap only after its "@" ("ana.lovelace@" ⏎ "example.com"); pair with [overflow-wrap:anywhere] for a part too long for the line. */
export function breakableEmail(value: string): React.ReactNode {
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;
  return (
    <>
      {value.slice(0, at + 1)}
      <wbr />
      {value.slice(at + 1)}
    </>
  );
}

export function CopyValue({ value, srLabel, className }: { value: string; /** "Copy the MCP address" */ srLabel: string; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 align-baseline", className)}>
      <code className="min-w-0 font-mono text-caption text-ink [overflow-wrap:anywhere]">{breakableUrl(value)}</code>
      <CopyButton value={value} size="xs" variant="ghost" srLabel={srLabel} />
    </span>
  );
}
