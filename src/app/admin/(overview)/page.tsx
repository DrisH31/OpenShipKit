//
// /admin — the overview, answer first (UI-5), from the top down:
//   1. The answer, in words: is the site up, and does anything need you —
//      with when it was checked, how fast the database answered and the
//      site's address under it (freshness and provenance, stated once).
//   2. Needs you: what is waiting on a person, ranked by consequence (people
//      waiting on feedback before unpublished drafts), each with its action on
//      the row; finishable — it says so when nothing is left (UI-10). Beside it,
//      while the template isn't yet the admin's product, "Make it yours": how
//      far setup has come and the next step (the full list is on /dashboard;
//      the steps are one module, src/server/setup-steps.tsx).
//   3. The key numbers, each opening its list, with a 30-day trend and the last
//      seven days for the two that grow (accounts, subscribers).
//   4. The detail: the last six changes, by day (who made them, Undo one click
//      away in the audit log; the starter content folded into one line), and
//      what the site runs on.
// One read for the figures: getOverview(), the same service the MCP tool
// site.overview uses, so an agent and the admin see the same numbers.
// Under OPENSHIPKIT_PROFILE=site nothing is sold, so "Paying now" (which opens
// Plans, a 404 there) gives its place to the published posts.
//

import type { Metadata } from "next";
import Link from "next/link";
import { ActivityIcon, ArrowRightIcon, CircleCheckIcon, FileTextIcon, MessageSquareIcon, TriangleAlertIcon } from "lucide-react";
import { KPI } from "@/components/product/kpi";
import { PageHeader } from "@/components/product/page-header";
import { Sparkline } from "@/components/product/sparkline";
import { EmptyState } from "@/components/product/states";
import { RecentChanges } from "@/components/admin/change-list";
import { DetailList } from "@/components/product/detail-list";
import { breakableUrl } from "@/components/product/copy-value";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatCount, formatDateTime, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { privacyLens } from "@/server/demo";
import { siteProfile } from "@/server/env";
import { PROVIDER_LABEL } from "@/core/billing";
import { requireAdmin } from "@/server/session";
import { GROWTH_DAYS, getOverview } from "@/server/services/overview";
import { strandedSubscriptions } from "@/server/services/billing";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { endStrandedAction } from "./actions";
import { getSetupSteps } from "@/server/setup-steps";

export const metadata: Metadata = { title: "Overview" };

const DATA_WORDS = { postgres: "Postgres (DATABASE_URL)", "embedded-postgres": "Embedded Postgres (PGlite, .data/pglite)", memory: "In memory (tests only)" } as const;

/** A key figure that opens its list: the whole tile is the link. */
function KpiLink({ href, ...props }: React.ComponentProps<typeof KPI> & { href: string }) {
  return (
    <Link href={href} className="group/kpi rounded-xl">
      <KPI {...props} className="h-full transition-colors group-hover/kpi:border-line-strong" />
    </Link>
  );
}

/** The running total at the end of each day, from today's total and the new rows per day. */
function runningTotals(total: number, perDay: number[]): number[] {
  let after = 0;
  const out = new Array<number>(perDay.length);
  for (let i = perDay.length - 1; i >= 0; i--) {
    out[i] = total - after;
    after += perDay[i];
  }
  return out;
}

/** "+3 in the last 7 days", or "None in the last 7 days". */
function lastWeek(perDay: number[]): string {
  const n = perDay.slice(-7).reduce((a, b) => a + b, 0);
  return n ? `+${formatCount(n)} in the last 7 days` : "None in the last 7 days";
}

interface Attention {
  key: string;
  icon: typeof MessageSquareIcon;
  title: string;
  body: string;
  action?: { label: string; href: string };
  /** Instead of a link: a control of its own (a confirmed action). */
  control?: React.ReactNode;
}

export default async function AdminOverview() {
  const lens = privacyLens(await requireAdmin());
  const [o, steps, stranded] = await Promise.all([
    getOverview(),
    getSetupSteps(siteProfile() === "saas"),
    siteProfile() === "saas" ? strandedSubscriptions() : {},
  ]);
  const now = new Date();
  const s = o.stats;

  // What is waiting on a person, ranked by consequence: someone who wrote in, then work left unpublished.
  const attention: Attention[] = [];
  // People still paying a provider this site no longer listens to (BILLING_PROVIDER changed).
  const strandedLines = Object.entries(stranded) as [keyof typeof PROVIDER_LABEL, number][];
  if (strandedLines.length) {
    const n = strandedLines.reduce((a, [, c]) => a + c, 0);
    attention.push({
      key: "stranded",
      icon: TriangleAlertIcon,
      title: `${plural(n, "subscription")} still billed by ${strandedLines.map(([p]) => PROVIDER_LABEL[p]).join(" and ")}`,
      body: "Billing now uses another provider, so their renewals and cancellations no longer reach this site. Cancel them there (or switch back), then mark them handled here: they stop renewing, and each keeps what it paid for (docs/billing.md, “Switching providers”).",
      control: o.stack.billing === "none" ? undefined : (
        <div className="flex shrink-0 flex-col gap-2">
          {strandedLines.map(([p, c]) => (
            <ConfirmAction
              key={p}
              action={endStrandedAction.bind(null, p)}
              triggerVariant="outline"
              trigger={<>Mark {PROVIDER_LABEL[p]} handled</>}
              title={`Mark ${plural(c, "subscription")} at ${PROVIDER_LABEL[p]} as handled?`}
              description={`Do this once they're cancelled at ${PROVIDER_LABEL[p]} (or the people are told). They stop renewing here, and each keeps its access to the end of what it paid for. Each change is in the audit log.`}
              confirmLabel="Mark handled"
            />
          ))}
        </div>
      ),
    });
  }
  if (s.openFeedback) {
    attention.push({
      key: "feedback",
      icon: MessageSquareIcon,
      title: `${plural(s.openFeedback, "feedback item")} waiting`,
      body: "New, planned or in progress. Someone is waiting to hear back.",
      action: { label: "Triage", href: "/admin/feedback" },
    });
  }
  if (s.draftPosts) {
    attention.push({
      key: "drafts",
      icon: FileTextIcon,
      title: `${plural(s.draftPosts, "draft")} not published`,
      body: "Publish them or delete them; drafts never show on the site.",
      action: { label: "Review", href: "/admin/posts?status=draft" },
    });
  }

  const answer = !o.health.ok
    ? "The database isn’t answering. Pages that read data will fail until it’s back."
    : attention.length
      ? `The site is up, and ${attention.length === 1 ? "one thing needs" : `${attention.length} things need`} you.`
      : "The site is up and nothing needs you.";

  const todo = steps.filter((step) => step.state === "todo");
  const done = steps.filter((step) => step.state === "done").length;
  const next = todo[0];
  const g = o.growth;

  return (
    <>
      <PageHeader
        title="Overview"
        emphasis
        answer={answer}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {o.health.ok ? (
              <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-positive" />
            ) : (
              <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0 text-danger" />
            )}
            <span>
              {o.health.ok ? "Database healthy" : "Database not answering"}
              {o.health.detail ? `, ${o.health.detail}` : ""}
            </span>
            <span aria-hidden>·</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{breakableUrl(o.siteUrl)}</span>
            <span aria-hidden>·</span>
            <span>Checked {formatDateTime(o.checkedAt)}</span>
          </span>
        }
        action={
          <Link href="/admin/posts/new?kind=post" className={buttonVariants({ size: "sm" })}>
            New post
          </Link>
        }
      />

      <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-4", next && "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start")}>
        <section aria-labelledby="look-title" className="flex flex-col rounded-xl border border-line bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id="look-title" className="font-sans text-body font-semibold text-ink">
              Needs you
            </h2>
            {attention.length ? <span className="tabular text-small text-ink-3">{plural(attention.length, "item")}</span> : null}
          </div>
          {attention.length ? (
            <ul className="flex flex-col">
              {attention.map(({ key, icon: Icon, title, body, action, control }) => (
                <li key={key} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                  <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-tonal text-ink-2">
                    <Icon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-small font-semibold text-ink">{title}</span>
                    <span className="text-caption text-ink-3">{body}</span>
                  </div>
                  {control ?? null}
                  {action ? (
                    <Link href={action.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
                      {action.label}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 px-4 py-4 text-small text-ink-2">
              <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-positive" />
              Nothing needs you right now. Feedback and drafts land here when they do.
            </p>
          )}
        </section>

        {next ? (
          <section aria-labelledby="setup-title" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="setup-title" className="font-sans text-body font-semibold text-ink">
                Make it yours
              </h2>
              <span className="tabular text-small text-ink-3">
                {done} of {steps.length} done
              </span>
            </div>
            <Progress value={Math.round((done / Math.max(1, steps.length)) * 100)} aria-label={`Setup progress: ${done} of ${steps.length} steps done`} />
            <div className="flex flex-col gap-1">
              <span className="text-caption text-ink-3">Next</span>
              <span className="text-small font-semibold text-ink">{next.title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {next.action ? (
                <Link href={next.action.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "group")}>
                  {next.action.label}
                  <ArrowRightIcon aria-hidden data-icon="inline-end" className="transition-transform duration-(--dur-hover) group-hover:translate-x-0.5" />
                </Link>
              ) : null}
              <Link href="/dashboard#setup-title" className="inline-flex min-h-8 items-center text-small text-ink-2 underline decoration-ink-faint underline-offset-4 hover:text-ink">
                All {steps.length} steps
              </Link>
            </div>
          </section>
        ) : null}
      </div>

      <section aria-labelledby="kpi-title" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="kpi-title" className="font-sans text-body font-semibold text-ink">
            Key numbers
          </h2>
          <span className="text-caption text-ink-3">Trends: the last {GROWTH_DAYS} days, by UTC day</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiLink
            href="/admin/users"
            label="Users"
            value={formatCount(s.users)}
            trend={<Sparkline values={runningTotals(s.users, g.users)} />}
            note={`${lastWeek(g.users)} · ${plural(s.admins, "admin")}`}
          />
          {o.stack.profile === "site" ? (
            <KpiLink href="/admin/posts" label="Published posts" value={formatCount(s.publishedPosts)} note={s.draftPosts ? `${plural(s.draftPosts, "draft")}` : "No drafts"} />
          ) : (
            <KpiLink href="/admin/plans" label="Paying now" value={formatCount(s.activeSubscriptions)} note={`${plural(s.purchases, "one-time purchase")}`} />
          )}
          <KpiLink
            href="/admin/subscribers"
            label="Subscribers"
            value={formatCount(s.subscribers)}
            trend={<Sparkline values={runningTotals(s.subscribers, g.subscribers)} />}
            note={lastWeek(g.subscribers)}
          />
          <KpiLink href="/admin/feedback" label="Open feedback" value={formatCount(s.openFeedback)} note={s.openFeedback ? "New, planned or in progress" : "Nothing waiting"} />
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="changes-title" className="flex flex-col rounded-xl border border-line bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id="changes-title" className="font-sans flex items-center gap-2 text-body font-semibold text-ink">
              <ActivityIcon aria-hidden className="size-4 text-ink-3" /> Recent changes
            </h2>
            <Link href="/admin/audit" className="inline-flex min-h-8 items-center text-small text-ink-2 underline decoration-ink-faint underline-offset-4 hover:text-ink">
              Audit log
            </Link>
          </div>
          {o.recentChanges.length ? (
            <RecentChanges entries={o.recentChanges} now={now} lens={lens} />
          ) : (
            <EmptyState className="m-4" title="No changes yet" body="Every edit to content, posts, plans and users shows up here, with who made it and a way to undo it." />
          )}
        </section>

        <section aria-labelledby="stack-title" className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
          <h2 id="stack-title" className="font-sans text-body font-semibold text-ink">
            Running on
          </h2>
          <DetailList
            variant="pairs"
            items={[
              { label: "Auth", value: "Better Auth, in your database" },
              { label: "Data", value: DATA_WORDS[o.stack.data] },
              {
                label: "Payments",
                value:
                  o.stack.profile === "site"
                    ? "None: content site (OPENSHIPKIT_PROFILE=site)"
                    : o.stack.billing === "none"
                      ? "Off (set a provider's keys: docs/billing.md)"
                      : PROVIDER_LABEL[o.stack.billing],
              },
              { label: "Email", value: o.stack.email === "resend" ? "Resend" : "Printed to the server log" },
              { label: "Mode", value: o.stack.demo ? "Demo: not for real users" : "Production database" },
            ]}
          />
        </section>
      </div>
    </>
  );
}
