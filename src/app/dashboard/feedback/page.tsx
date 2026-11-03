//
// /dashboard/feedback — send feedback, and see what happened to what you sent
// (its status). Admin notes stay private.
//

import type { Metadata } from "next";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { FeedbackForm } from "@/components/dashboard/feedback-form";
import { formatDate } from "@/lib/format";
import { FEEDBACK_KIND, FEEDBACK_STATUS } from "@/lib/status";
import { requireUser } from "@/server/session";
import { listFeedback } from "@/server/services/community";
import { sendFeedback } from "./actions";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  const user = await requireUser("/dashboard/feedback");
  const mine = await listFeedback({ userId: user.id, limit: 50 });

  return (
    <>
      <PageHeader title="Feedback" answer="Tell us what’s broken or what you’d like next. Every message lands in the team’s inbox." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="send-title" className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6">
          <h2 id="send-title" className="font-sans text-body font-semibold text-ink">
            Send feedback
          </h2>
          <FeedbackForm action={sendFeedback} />
        </section>
        <section aria-labelledby="history-title" className="flex flex-col gap-3">
          <h2 id="history-title" className="font-sans text-body font-semibold text-ink">
            What you’ve sent
          </h2>
          {mine.items.length === 0 ? (
            <EmptyState title="Nothing sent yet" body="Your messages and their status show up here, so you can see when something is planned or fixed." />
          ) : (
            <ol className="flex flex-col gap-3">
              {mine.items.map((f) => {
                const st = FEEDBACK_STATUS[f.status];
                return (
                  <li key={f.id} className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-caption text-ink-3">
                        {FEEDBACK_KIND[f.kind]} · <time dateTime={f.createdAt}>{formatDate(f.createdAt)}</time>
                      </p>
                      <StatusBadge label={st.label} tone={st.tone} />
                    </div>
                    {f.title ? <p className="text-small font-semibold text-ink">{f.title}</p> : null}
                    <p className="line-clamp-4 text-small whitespace-pre-line text-ink-2">{f.message}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
