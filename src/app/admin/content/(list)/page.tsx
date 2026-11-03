//
// /admin/content — every editable section of the site (CONTENT_KEYS), with
// whether it is customised or still the template's default, and when it last
// changed. Each opens the schema-driven editor.
//

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { CONTENT_KEYS } from "@/core/content";
import { PageHeader } from "@/components/product/page-header";
import { StatusBadge } from "@/components/product/status-badge";
import { LinkPending } from "@/components/product/link-pending";
import { formatDateTime, relativeTime } from "@/lib/format";
import { requireAdmin } from "@/server/session";
import { getAllContentStates } from "@/server/services/content";

export const metadata: Metadata = { title: "Content" };

export default async function ContentList() {
  await requireAdmin();
  const states = await getAllContentStates();
  const custom = states.filter((s) => s.stored).length;
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Content"
        answer={`The words on your landing page, header and footer. ${custom} of ${states.length} sections are customised; the rest show the template’s default.`}
      />
      <ul className="flex flex-col rounded-xl border border-line bg-card">
        {states.map((s) => {
          const meta = CONTENT_KEYS[s.key];
          return (
            <li key={s.key} className="border-t border-line first:border-t-0">
              <Link href={`/admin/content/${s.key}`} className="flex min-h-16 items-center gap-4 px-4 py-3 hover:bg-tonal focus-visible:bg-tonal sm:px-5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-small font-semibold text-ink">{meta.label}</span>
                  <span className="text-caption text-ink-3">{meta.description}</span>
                </span>
                <span className="hidden flex-col items-end gap-1 sm:flex">
                  <StatusBadge label={s.stored ? "Customised" : "Default"} tone={s.stored ? "positive" : "neutral"} />
                  {s.updatedAt ? (
                    <time dateTime={s.updatedAt} title={formatDateTime(s.updatedAt)} className="text-caption text-ink-3">
                      {relativeTime(s.updatedAt, now)}
                    </time>
                  ) : null}
                </span>
                <LinkPending />
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-3" />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
