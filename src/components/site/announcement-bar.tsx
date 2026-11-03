import "server-only";

//
// The thin line above the header (content key "announcement"). Hidden when
// disabled or empty. One sentence and at most one link — never a countdown.
// An <aside> named "Announcement", so it is a landmark: a screen reader moving
// by landmark reaches its link instead of skipping from the skip link to the
// header (axe "region").
//

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { getContent } from "@/server/services/content";

export async function AnnouncementBar() {
  const a = await getContent("announcement");
  if (!a.enabled || !a.text.trim()) return null;
  const external = a.link ? /^https?:\/\//.test(a.link.href) : false;

  return (
    <aside aria-label="Announcement" className="border-b border-line-strong bg-surface">
      <p className="mx-auto flex max-w-content flex-wrap items-center justify-center gap-x-3 gap-y-1 px-gutter py-2.5 text-center text-small text-ink-2">
        <span>{a.text}</span>
        {a.link && (
          <Link
            href={a.link.href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="group inline-flex min-h-6 items-center gap-1 font-semibold text-ink underline decoration-ink-faint underline-offset-4 transition-[text-decoration-color] duration-(--dur-hover) hover:decoration-ink"
          >
            {a.link.label}
            <ArrowRightIcon aria-hidden className="size-3.5 transition-transform duration-(--dur-hover) ease-out-quart group-hover:translate-x-0.5" />
          </Link>
        )}
      </p>
    </aside>
  );
}
