//
// /admin/jobs — the background job queue (src/server/jobs): what failed for
// good and why, what is waiting, and a Retry button for a failed job.
//
// A job's payload is never shown: a queued email holds a live sign-in or reset
// link. The last error is shown, because the adapters keep addresses and
// credentials out of it; the read-only demo admin sees it withheld anyway.
//

import type { Metadata } from "next";
import { RotateCcwIcon } from "lucide-react";
import type { Job, JobStatus } from "@/core/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { ActionForm, FormMessage, SubmitButton } from "@/components/product/action-form";
import { ExpiredPage, FilterTabs, NextPageLink, hrefWith, listPage } from "@/components/admin/filter-bar";
import { formatDateTime } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { privacyLens } from "@/server/demo";
import { jobCounts, listJobs } from "@/server/jobs";
import { requireAdmin } from "@/server/session";
import { retryJobAction } from "./actions";

export const metadata: Metadata = { title: "Jobs" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const TABS: { status: JobStatus | undefined; label: string; param: string | undefined }[] = [
  { status: "failed", label: "Failed", param: undefined },
  { status: "queued", label: "Waiting", param: "queued" },
  { status: "running", label: "Running", param: "running" },
  { status: "succeeded", label: "Done", param: "succeeded" },
  { status: undefined, label: "All", param: "all" },
];

const LOOK: Record<JobStatus, { label: string; tone: Tone }> = {
  failed: { label: "Failed", tone: "danger" },
  queued: { label: "Waiting", tone: "info" },
  running: { label: "Running", tone: "warning" },
  succeeded: { label: "Done", tone: "positive" },
};

/** When it next runs, or when it finished. */
function when(job: Job): string {
  if (job.status === "queued") return `Runs ${formatDateTime(job.runAt)}`;
  if (job.status === "running") return `Started, lease until ${formatDateTime(job.lockedUntil)}`;
  return formatDateTime(job.finishedAt);
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lens = privacyLens(await requireAdmin());
  const sp = await searchParams;
  const tab = TABS.find((t) => t.param === one(sp.status)) ?? TABS[0];
  const cursor = one(sp.cursor) ?? null;
  const [page, counts] = await Promise.all([listPage(() => listJobs({ status: tab.status, cursor, limit: 50 })), jobCounts()]);

  return (
    <>
      <PageHeader
        title="Jobs"
        answer="Work the app does in the background, such as an email that couldn’t be sent at once. A job that keeps failing ends up here for you to look at and retry."
      />
      <FilterTabs
        label="Status"
        options={TABS.map((t) => ({
          href: hrefWith("/admin/jobs", { status: t.param }),
          label: t.status ? `${t.label} (${counts[t.status]})` : t.label,
          active: t === tab,
        }))}
      />
      {!page ? (
        <ExpiredPage href={hrefWith("/admin/jobs", { status: tab.param })} />
      ) : page.items.length === 0 ? (
        <EmptyState
          title={tab.status === "failed" ? "Nothing has failed" : "No jobs here"}
          body={
            tab.status === "failed"
              ? "When a background job runs out of retries, it shows up here with its last error."
              : "Finished jobs are deleted after 14 days."
          }
        />
      ) : (
        <>
          <div className="rounded-xl border border-line bg-card">
            <Table label="Jobs">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Attempts</TableHead>
                  <TableHead className="hidden md:table-cell">When</TableHead>
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <span className="font-mono text-small text-ink">{job.kind}</span>
                      {job.lastError ? (
                        <span className="mt-1 block max-w-prose text-caption text-ink-3 [overflow-wrap:anywhere]">
                          {lens.masking ? "Error withheld in the read-only demo." : job.lastError}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={LOOK[job.status].label} tone={LOOK[job.status].tone} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell tabular-nums">
                      {job.attempts} of {job.maxAttempts}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{when(job)}</TableCell>
                    <TableCell className="w-px px-4 text-right">
                      {job.status === "failed" ? (
                        <ActionForm action={retryJobAction} className="inline-flex flex-col items-end gap-1">
                          <input type="hidden" name="id" value={job.id} />
                          <SubmitButton variant="outline" size="sm" aria-label={`Retry ${job.kind} job`}>
                            <RotateCcwIcon aria-hidden /> Retry
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
          <NextPageLink href={page.nextCursor ? hrefWith("/admin/jobs", { status: tab.param, cursor: page.nextCursor }) : null} />
        </>
      )}
    </>
  );
}
