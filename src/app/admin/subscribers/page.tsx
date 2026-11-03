//
// /admin/subscribers — the email list (newsletter form sign-ups): search,
// filter by status, unsubscribe someone on request, and export as CSV
// (./export, formula-safe).
//
// On a phone the email gets the width: it breaks only after "@" and dots
// (breakableEmail), Status is hidden (the active tab already says it) and
// Unsubscribe is an icon button. Unsubscribing under "Subscribed" removes the
// row; focus moves to the next row's button.
//
// The read-only demo admin sees every address masked (even in the form's
// hidden field), can't search, and its export comes back as ?error=read_only.
//

import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, MailXIcon } from "lucide-react";
import type { SubscriberStatus } from "@/core/types";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { ActionForm, FormMessage, SubmitButton } from "@/components/product/action-form";
import { breakableEmail } from "@/components/product/copy-value";
import { ExpiredPage, FilterTabs, NextPageLink, SearchForm, hrefWith, listPage } from "@/components/admin/filter-bar";
import { formatDate } from "@/lib/format";
import { subscriberSource } from "@/lib/status";
import { DEMO_READ_ONLY_ERROR, DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { showEmail } from "@/shared/privacy-mask";
import { privacyLens } from "@/server/demo";
import { requireAdmin } from "@/server/session";
import { listSubscribers } from "@/server/services/community";
import { unsubscribeAction } from "./actions";

export const metadata: Metadata = { title: "Subscribers" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function SubscribersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lens = privacyLens(await requireAdmin());
  const sp = await searchParams;
  // Masked for the read-only demo admin, and no search: a match would confirm an address is on the list.
  const q = lens.masking ? undefined : one(sp.q)?.trim().slice(0, 100) || undefined;
  const readOnly = one(sp.error) === DEMO_READ_ONLY_ERROR;
  const status: SubscriberStatus | undefined = one(sp.status) === "unsubscribed" ? "unsubscribed" : one(sp.status) === "all" ? undefined : "subscribed";
  const cursor = one(sp.cursor) ?? null;
  const page = await listPage(() => listSubscribers({ status, search: q, cursor, limit: 50 }));
  const statusParam = status ?? "all";

  return (
    <>
      <PageHeader
        title="Subscribers"
        answer="People who joined the email list from the site’s newsletter form. Export them to send with your email tool."
        action={
          // No `download` for the demo: the export answers it with a redirect back here (?error=read_only), which a download would save as a file.
          <a href={hrefWith("/admin/subscribers/export", { status: status })} download={lens.masking ? undefined : true} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <DownloadIcon aria-hidden /> Export CSV
          </a>
        }
      />
      {readOnly ? (
        <p role="alert" className="text-small text-danger">
          {DEMO_READ_ONLY_MESSAGE}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <SearchForm action="/admin/subscribers" value={q} placeholder="Search emails" keep={{ status: statusParam === "subscribed" ? undefined : statusParam }} label="Search subscribers" />
          {lens.masking ? <p className="text-caption text-ink-3">Search is off in the read-only demo, so it can’t be used to look up someone’s address.</p> : null}
        </div>
        <FilterTabs
          label="Status"
          options={[
            { href: hrefWith("/admin/subscribers", { q }), label: "Subscribed", active: status === "subscribed" },
            { href: hrefWith("/admin/subscribers", { q, status: "unsubscribed" }), label: "Unsubscribed", active: status === "unsubscribed" },
            { href: hrefWith("/admin/subscribers", { q, status: "all" }), label: "All", active: !status },
          ]}
        />
      </div>
      {!page ? (
        <ExpiredPage href={hrefWith("/admin/subscribers", { q, status: statusParam === "subscribed" ? undefined : statusParam })} />
      ) : page.items.length === 0 ? (
        q ? (
          <EmptyState kind="no-results" title="Nobody matches" body={`No email contains “${q}”.`} action={<Link href="/admin/subscribers" className={buttonVariants({ variant: "outline", size: "sm" })}>Clear search</Link>} />
        ) : (
          <EmptyState title={status === "unsubscribed" ? "Nobody has unsubscribed" : "No subscribers yet"} body="The newsletter form in the site footer adds people here. Each address is stored once." />
        )
      ) : (
        <>
          <div className="rounded-xl border border-line bg-card">
            <Table label="Subscribers">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Email</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Source</TableHead>
                  <TableHead className="hidden md:table-cell">Joined</TableHead>
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="px-4 py-3 whitespace-normal text-ink [overflow-wrap:anywhere]">{breakableEmail(showEmail(lens, s.email))}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge label={s.status === "subscribed" ? "Subscribed" : "Unsubscribed"} tone={s.status === "subscribed" ? "positive" : "neutral"} />
                    </TableCell>
                    <TableCell className="hidden text-ink-2 sm:table-cell">{subscriberSource(s.source)}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatDate(s.createdAt)}</TableCell>
                    <TableCell className="w-px px-4 text-right">
                      {s.status === "subscribed" ? (
                        <ActionForm action={unsubscribeAction} focusNext={{ item: "tr", target: "button[type=submit]" }} className="inline-flex flex-col items-end gap-1">
                          <input type="hidden" name="email" value={showEmail(lens, s.email)} />
                          <SubmitButton variant="ghost" size="sm" aria-label={`Unsubscribe ${showEmail(lens, s.email)}`} className="max-sm:size-8 max-sm:px-0 pointer-coarse:max-sm:size-11">
                            <MailXIcon aria-hidden className="sm:hidden" />
                            <span className="max-sm:sr-only">Unsubscribe</span>
                          </SubmitButton>
                          <FormMessage hideSuccess className="max-w-48 text-left whitespace-normal" />
                        </ActionForm>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <NextPageLink href={page.nextCursor ? hrefWith("/admin/subscribers", { q, status: statusParam === "subscribed" ? undefined : statusParam, cursor: page.nextCursor }) : null} />
        </>
      )}
    </>
  );
}
