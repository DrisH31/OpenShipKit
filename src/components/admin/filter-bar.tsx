//
// Filters for an admin list as plain links and a GET form — they work without
// JavaScript, survive a reload and can be shared. Server component.
//
//   <FilterTabs> one choice among a few (kind, status): links with aria-current.
//                On a phone the pills wrap onto more rows rather than scroll
//                sideways, so every option is in view (a hidden scroller with no
//                scrollbar hid half the audit log's filters).
//   <SearchForm> a search box that submits ?q= and keeps the other params.
//                The toolbar is one height: the field (ui/Input), its Search
//                button and the tab group are all 40 px (44 on touch).
//   listPage()   loads one page of a cursor list; a cursor the store can't read
//                (tampered, or left over from an older link) gives null, not a 500.
//   <ExpiredPage> what a list shows for that null: "Start from the newest".
//

import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/product/states";
import { cn } from "@/lib/utils";

/** `base` + params, dropping empty values. */
export function hrefWith(base: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function FilterTabs({ label, options, className }: { label: string; options: { href: string; label: string; active: boolean; count?: number }[]; className?: string }) {
  return (
    // 32 px pills + 3 px padding + 1 px border = 40 px, the search field’s height. On touch the pills keep their 44 px targets.
    <nav aria-label={label} className={cn("flex w-fit max-w-full flex-wrap gap-1 rounded-[1.25rem] border border-line-strong bg-bg p-[3px]", className)}>
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-current={o.active ? "page" : undefined}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-4 text-small whitespace-nowrap text-ink-2 hover:text-ink pointer-coarse:h-11",
            o.active && "bg-surface font-semibold text-ink shadow-control",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className="tabular font-normal text-ink-3">{o.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function SearchForm({ action, value, placeholder, keep = {}, label = "Search" }: { action: string; value?: string; placeholder: string; keep?: Record<string, string | undefined>; label?: string }) {
  return (
    <form method="get" action={action} role="search" className="flex w-full max-w-sm items-center gap-2">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="relative flex-1">
        <span className="sr-only">{label}</span>
        <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input type="search" name="q" defaultValue={value} placeholder={placeholder} className="pl-9" />
      </label>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}

/** "Next page" for cursor lists (the DataStore pages by opaque cursor, newest first). */
export function NextPageLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <div className="flex justify-center">
      <Link href={href} className="inline-flex h-10 items-center rounded-full border border-field px-5 text-small font-semibold text-ink hover:bg-tonal pointer-coarse:h-11">
        Older
      </Link>
    </div>
  );
}

/**
 * One page of a cursor list. Every DataStore throws DataError("invalid") for a
 * cursor it can't decode; that becomes null so the page renders <ExpiredPage>
 * instead of the error boundary. Any other error (the database being down)
 * still throws. Every admin list loads through this.
 */
export async function listPage<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    const e = error as { name?: string; code?: string };
    if (e.name === "DataError" && e.code === "invalid") return null;
    throw error;
  }
}

/** The state for a cursor that no longer reads: one link back to page one, filters kept. */
export function ExpiredPage({ href, body = "The list changed since the link was made." }: { href: string; body?: string }) {
  return (
    <ErrorState
      title="That page of results has expired"
      body={body}
      action={
        <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Start from the newest
        </Link>
      }
    />
  );
}
