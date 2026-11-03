//
// One tool's monochrome mark (./tool-marks.ts) as an inline SVG in the current
// text colour, or nothing when the tool has no mark — callers always show the
// name beside it, so a missing mark never leaves a gap in meaning. Decorative
// (aria-hidden): the name is the label. No hooks, so it renders anywhere.
//

import { cn } from "@/lib/utils";
import { toolMark } from "./tool-marks";

/** Extra SVG attributes pass through (e.g. data-icon="inline-start" inside a Button, for its icon spacing). */
export function ToolMarkIcon({ name, className, ...props }: { name: string } & Omit<React.ComponentProps<"svg">, "children">) {
  const mark = toolMark(name);
  if (!mark) return null;
  return (
    <svg viewBox={mark.viewBox ?? "0 0 24 24"} aria-hidden focusable="false" {...props} className={cn("size-5 shrink-0 fill-current", className)}>
      <path d={mark.path} fillRule={mark.fillRule} />
    </svg>
  );
}
