//
// Before → after for one audit entry, as a list of changed paths (diffJson).
// Each change is said in words (Added / Removed / Changed), never colour
// alone; long values (a post body) fold into a <details>. Server component.
//

import type { DiffEntry } from "@/lib/json-diff";
import { previewValue } from "@/lib/json-diff";
import { humanize } from "@/lib/schema-form";
import { cn } from "@/lib/utils";

const WORD = { added: "Added", removed: "Removed", changed: "Changed" } as const;

function pathWords(path: string): string {
  if (!path) return "Whole value";
  return path
    .split(".")
    .map((p) => (/^\d+$/.test(p) ? `#${Number(p) + 1}` : humanize(p)))
    .join(" › ");
}

function Value({ v, tone }: { v: unknown; tone: "before" | "after" }) {
  const full = previewValue(v, 100_000);
  const short = previewValue(v, 280);
  const cls = cn(
    "rounded-md border px-3 py-2 font-mono text-caption break-words whitespace-pre-wrap",
    tone === "before" ? "border-line bg-bg text-ink-2" : "border-line-strong bg-surface text-ink",
  );
  if (v === undefined) return <p className="text-caption text-ink-3">—</p>;
  if (full.length <= 280) return <pre className={cls}>{full}</pre>;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <pre className={cls}>{short}</pre>
        <span className="mt-1 inline-block text-caption text-ink-2 underline underline-offset-4 group-open:hidden">Show all {full.length.toLocaleString("en-US")} characters</span>
      </summary>
      <pre className={cn(cls, "mt-2 max-h-[32rem] overflow-auto overscroll-x-contain")}>{full}</pre>
    </details>
  );
}

export function DiffView({ diff }: { diff: DiffEntry[] }) {
  if (diff.length === 0) return <p className="text-small text-ink-3">No difference between before and after.</p>;
  return (
    <ol className="flex flex-col gap-4">
      {diff.map((d, i) => (
        <li key={`${d.path}-${i}`} className="flex flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
          <p className="flex flex-wrap items-baseline gap-2 text-small">
            <span className="font-semibold text-ink">{pathWords(d.path)}</span>
            <span className={cn("text-caption font-semibold", d.kind === "added" ? "text-positive" : d.kind === "removed" ? "text-danger" : "text-ink-2")}>{WORD[d.kind]}</span>
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-ink-3">Before</span>
              <Value v={d.before} tone="before" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-ink-3">After</span>
              <Value v={d.after} tone="after" />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
