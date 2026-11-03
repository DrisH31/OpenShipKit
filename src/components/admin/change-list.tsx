//
// A list of audit entries as sentences — who did what to which thing, when —
// each linking to its detail (before/after diff, restore). ChangeList is the
// audit log's: one bordered row per entry. RecentChanges is the overview's
// glance at the same entries: grouped under a day ("Today", "Yesterday",
// "Oct 6"), a small avatar for who acted, the time right-aligned, no rules
// between rows, and the starter content's rows folded into its one "Added the
// starter content" line (they're the template's, not a change anyone made).
// Server components; `now` is passed in so relative times match the render.
//
// User entries that don't carry the person's email (role and ban changes, and
// older entries) would read "Banned a user": emailsFor() looks those people up,
// so the line says whom (a deleted person stays "a user"). One batched read of
// the user rows for the whole list (emailsByUserId): not getUserDetail(), which
// also loads billing and feedback just to show an email.
//

import Link from "next/link";
import { BotIcon, CogIcon, UserIcon, UserRoundPlusIcon } from "lucide-react";
import type { AuditEntry } from "@/core/types";
import { actorWords, describeAudit, isSeedEntry, userIdsWithoutEmail } from "@/lib/audit-words";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";
import { LinkPending } from "@/components/product/link-pending";
import { maskAuditEntry, maskEmailMap, NO_MASK, type PrivacyLens } from "@/shared/privacy-mask";
import { emailsByUserId } from "@/server/services/users";

const ACTOR_ICON = { user: UserIcon, agent: BotIcon, system: CogIcon } as const;

/** The icon says who acted; a sign-up is recorded by the system hook but is a person arriving, so it gets a person. */
const iconFor = (e: AuditEntry) => (e.action === "user.create" ? UserRoundPlusIcon : ACTOR_ICON[e.actor.type]);

/** Current emails, by user id, for user entries that don't name one — masked for the read-only demo admin. */
export async function emailsFor(entries: readonly AuditEntry[], lens: PrivacyLens = NO_MASK): Promise<Record<string, string>> {
  return maskEmailMap(lens, await emailsByUserId(userIdsWithoutEmail(entries)));
}

/** `lens`: the viewer's (privacyLens in src/server/demo.ts); the read-only demo admin sees other people's addresses masked. */
export async function ChangeList({ entries, now, lens = NO_MASK }: { entries: AuditEntry[]; now: Date; lens?: PrivacyLens }) {
  const emails = await emailsFor(entries, lens);
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => {
        const e = maskAuditEntry(lens, entry);
        const w = describeAudit(e, emails);
        const Icon = iconFor(e);
        return (
          <li key={e.id} className="border-t border-line first:border-t-0">
            <Link href={`/admin/audit/${e.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-tonal focus-visible:bg-tonal">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-small text-ink">
                  <span className="font-semibold">{w.verb}</span> {w.target}
                </span>
                <span className="text-caption text-ink-3">
                  {actorWords(e)} ·{" "}
                  <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
                    {relativeTime(e.createdAt, now)}
                  </time>
                </span>
              </span>
              <LinkPending className="mt-0.5" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** "Today", "Yesterday" or the date, by UTC day (the dates the rest of the admin shows). */
function dayLabel(iso: string, now: Date): string {
  const day = iso.slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  if (day === today) return "Today";
  if (day === new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)) return "Yesterday";
  return formatDate(iso);
}

/**
 * The overview's last changes: at most `limit` entries, the starter content's
 * own rows left out (its "Added the starter content" marker stays), grouped by day.
 */
export async function RecentChanges({ entries, now, limit = 6, lens = NO_MASK }: { entries: AuditEntry[]; now: Date; limit?: number; lens?: PrivacyLens }) {
  const shown = entries.filter((e) => e.action === "seed.run" || !isSeedEntry(e)).slice(0, limit);
  const emails = await emailsFor(shown, lens);
  const days: { label: string; items: AuditEntry[] }[] = [];
  for (const entry of shown) {
    const label = dayLabel(entry.createdAt, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(entry);
    else days.push({ label, items: [entry] });
  }
  return (
    <div className="flex flex-col gap-1 px-2 pt-1 pb-2">
      {days.map((day) => (
        <section key={day.label} aria-label={day.label}>
          <h3 className="px-2 pt-2 pb-1 font-sans text-caption font-semibold text-ink-3">{day.label}</h3>
          <ol className="flex flex-col">
            {day.items.map((entry) => {
              const e = maskAuditEntry(lens, entry);
              const w = describeAudit(e, emails);
              const Icon = iconFor(e);
              return (
                <li key={e.id}>
                  <Link href={`/admin/audit/${e.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-tonal focus-visible:bg-tonal">
                    <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-tonal text-ink-2">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-small text-ink-2">
                        <span className="font-semibold text-ink">{w.verb}</span> {w.target}
                      </span>
                      <span className="truncate text-caption text-ink-3">{actorWords(e)}</span>
                    </span>
                    <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)} className="shrink-0 self-start pt-0.5 text-caption whitespace-nowrap text-ink-3 tabular">
                      {relativeTime(e.createdAt, now)}
                    </time>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
