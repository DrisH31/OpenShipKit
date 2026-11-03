"use client";

//
// Where you're signed in: one row per active session (device guess, IP, last
// active), "This device" marked, and a sign-out button on every other row —
// each its own small form, so it works without JavaScript. "Sign out
// everywhere else" ends all but this one. The IP goes through
// formatIpAddress: short IPv6, loopback as "This machine", unknown left out.
// This device is always the first row (the server's order follows a refresh
// time that only moves every so often), then the most recently active, so
// what isn't you is easy to spot.
//
// Each Sign out button is named by its row's facts ("Sign out Chrome on
// macOS, active 2 hours ago, 203.0.113.4"), so a list of buttons tells two
// sessions on the same browser apart. Signing one out removes its row: focus
// moves to the next row's button, else "Sign out everywhere else", else the
// section's heading — never back to the top of the page.
//

import { LaptopIcon, SmartphoneIcon } from "lucide-react";
import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { MetaList } from "@/components/product/meta-list";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatIpAddress, relativeTime } from "@/lib/format";

export interface SessionRow {
  id: string;
  current: boolean;
  device: string;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
}

const isPhone = (device: string) => /iPhone|Android|iPad/.test(device);

/** This device first, then the most recently active (ISO timestamps sort as text). */
export function orderSessions(sessions: readonly SessionRow[]): SessionRow[] {
  return [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export function SessionsList({ sessions, revoke, revokeOthers, now }: { sessions: SessionRow[]; revoke: FormAction; revokeOthers: FormAction; now: string }) {
  const others = sessions.filter((s) => !s.current).length;
  const at = new Date(now);
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col rounded-xl border border-line">
        {orderSessions(sessions).map((s) => {
          const Icon = isPhone(s.device) ? SmartphoneIcon : LaptopIcon;
          const where = formatIpAddress(s.ipAddress);
          const active = relativeTime(s.lastActiveAt, at);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
              <Icon aria-hidden className="size-5 shrink-0 text-ink-3" />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink">
                  {s.device}
                  {s.current ? <Badge variant="positive">This device</Badge> : null}
                </p>
                <MetaList className="text-caption text-ink-3">
                  {where ? <span className="break-all">{where}</span> : null}
                  <span title={formatDateTime(s.lastActiveAt)} className="whitespace-nowrap">
                    Active {active}
                  </span>
                  <span className="whitespace-nowrap">Signed in {relativeTime(s.createdAt, at)}</span>
                </MetaList>
              </div>
              {s.current ? null : (
                <ActionForm action={revoke} focusNext={{ item: "li", target: "button[type=submit]" }} focusAfter={["#sign-out-others", "#sessions-only-here"]} className="flex items-center gap-2">
                  <input type="hidden" name="sessionId" value={s.id} />
                  <SubmitButton variant="ghost" size="sm" aria-label={`Sign out ${s.device}, active ${active}${where ? `, ${where}` : ""}`}>
                    Sign out
                  </SubmitButton>
                  <FormMessage hideSuccess className="max-w-48" />
                </ActionForm>
              )}
            </li>
          );
        })}
      </ul>
      {others > 0 ? (
        <ActionForm action={revokeOthers} focusAfter="#sessions-only-here" className="flex flex-wrap items-center gap-3">
          <SubmitButton id="sign-out-others" variant="outline" size="sm">
            Sign out everywhere else
          </SubmitButton>
          <FormMessage />
        </ActionForm>
      ) : (
        <p id="sessions-only-here" tabIndex={-1} className="text-small text-ink-3">
          You’re only signed in here.
        </p>
      )}
      <p className="text-caption text-ink-3">A signed-out device may keep working for up to five minutes while its cached session runs out.</p>
    </div>
  );
}
