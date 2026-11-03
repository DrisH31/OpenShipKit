//
// /admin/feedback — the inbox: dashboard feedback and the public contact
// form, newest first. Filter by status (?status=) and kind (?kind=); the
// overview links here unfiltered. Each item has its triage form.
//

import type { Metadata } from "next";
import Link from "next/link";
import type { Feedback, FeedbackKind, FeedbackStatus } from "@/core/types";
import { buttonVariants } from "@/components/ui/button";
import { MetaList } from "@/components/product/meta-list";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { FeedbackTriage } from "@/components/admin/feedback-triage";
import { ExpiredPage, FilterTabs, NextPageLink, hrefWith, listPage } from "@/components/admin/filter-bar";
import { LinkPending } from "@/components/product/link-pending";
import { formatDateTime, relativeTime } from "@/lib/format";
import { FEEDBACK_KIND, FEEDBACK_KINDS, FEEDBACK_STATUS, FEEDBACK_STATUSES } from "@/lib/status";
import { maskFeedback, type PrivacyLens } from "@/shared/privacy-mask";
import { privacyLens } from "@/server/demo";
import { requireAdmin } from "@/server/session";
import { listFeedback } from "@/server/services/community";
import { triageFeedback } from "./actions";

export const metadata: Metadata = { title: "Feedback" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** A mailto with the subject filled in, so the reply threads under the person’s message. */
const replyHref = (f: Feedback) => `mailto:${f.email}?subject=${encodeURIComponent(`Re: ${f.title ?? (f.kind === "contact" ? "your message" : "your feedback")}`)}`;

// The sender reads as text; the account is its own small "View account" link,
// and "Reply by email" shows whenever there is an address. For a signed-in
// sender the stored email is the one they typed into the form (submitFeedback:
// it is where the reply goes), which may differ from their account's.
// For the read-only demo admin the item arrives masked (maskFeedback) and has no
// "Reply by email": a masked address is no address.
function Item({ f, now, lens }: { f: Feedback; now: Date; lens: PrivacyLens }) {
  const st = FEEDBACK_STATUS[f.status];
  const link = "text-ink-2 underline decoration-ink-faint underline-offset-4 hover:text-ink";
  return (
    <li id={`feedback-${f.id}`} className="flex scroll-mt-20 flex-col gap-3 rounded-xl border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MetaList className="flex-1 text-caption text-ink-3">
          <span className="font-semibold whitespace-nowrap text-ink-2">{FEEDBACK_KIND[f.kind]}</span>
          {f.name ? <span>{f.name}</span> : null}
          {f.email ? <span className="min-w-0 break-all">{f.email}</span> : null}
          {f.name || f.email ? null : <span>{f.userId ? "A user" : "Anonymous"}</span>}
          {f.userId ? (
            <Link href={`/admin/users/${f.userId}`} className={`whitespace-nowrap ${link}`}>
              View account
              <LinkPending className="ml-1 align-[-0.125em]" />
            </Link>
          ) : null}
          <time dateTime={f.createdAt} title={formatDateTime(f.createdAt)} className="whitespace-nowrap">
            {relativeTime(f.createdAt, now)}
          </time>
        </MetaList>
        <StatusBadge label={st.label} tone={st.tone} />
      </div>
      {f.title ? <h2 className="font-sans text-body font-semibold text-ink">{f.title}</h2> : null}
      <p className="max-w-measure text-small whitespace-pre-line text-ink">{f.message}</p>
      {f.email && !lens.masking ? (
        <p className="text-small">
          <a href={replyHref(f)} className={link}>
            Reply by email
          </a>
        </p>
      ) : null}
      <FeedbackTriage action={triageFeedback.bind(null, f.id)} status={f.status} note={f.adminNote} />
    </li>
  );
}

export default async function FeedbackInbox({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lens = privacyLens(await requireAdmin());
  const sp = await searchParams;
  const rawStatus = one(sp.status);
  const status = FEEDBACK_STATUSES.includes(rawStatus as FeedbackStatus) ? (rawStatus as FeedbackStatus) : undefined;
  const rawKind = one(sp.kind);
  const kind = FEEDBACK_KINDS.includes(rawKind as FeedbackKind) ? (rawKind as FeedbackKind) : undefined;
  const cursor = one(sp.cursor) ?? null;
  const page = await listPage(() => listFeedback({ status, kind, cursor, limit: 25 }));
  const now = new Date();

  return (
    <>
      <PageHeader title="Feedback" answer="What people sent from the dashboard and the contact form. Set a status as you go; notes stay private." />
      <div className="flex flex-col gap-3">
        <FilterTabs
          label="Status"
          options={[
            { href: hrefWith("/admin/feedback", { kind }), label: "All", active: !status },
            ...FEEDBACK_STATUSES.map((s) => ({ href: hrefWith("/admin/feedback", { status: s, kind }), label: FEEDBACK_STATUS[s].label, active: status === s })),
          ]}
        />
        <FilterTabs
          label="Kind"
          options={[
            { href: hrefWith("/admin/feedback", { status }), label: "Every kind", active: !kind },
            ...FEEDBACK_KINDS.map((k) => ({ href: hrefWith("/admin/feedback", { status, kind: k }), label: FEEDBACK_KIND[k], active: kind === k })),
          ]}
        />
      </div>
      {!page ? (
        <ExpiredPage href={hrefWith("/admin/feedback", { status, kind })} />
      ) : page.items.length === 0 ? (
        status || kind ? (
          <EmptyState kind="cleared" title="Nothing here" body={status === "new" ? "You’re caught up: no new feedback." : "No feedback matches these filters."} action={<Link href="/admin/feedback" className={buttonVariants({ variant: "outline", size: "sm" })}>Show everything</Link>} />
        ) : (
          <EmptyState title="No feedback yet" body="Messages from the dashboard’s Feedback page and the public contact form land here." />
        )
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {page.items.map((f) => (
              <Item key={f.id} f={maskFeedback(lens, f)} now={now} lens={lens} />
            ))}
          </ol>
          <NextPageLink href={page.nextCursor ? hrefWith("/admin/feedback", { status, kind, cursor: page.nextCursor }) : null} />
        </>
      )}
    </>
  );
}
