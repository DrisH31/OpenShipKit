//
// /admin/audit/<id> — one change: who, when, what, the diff from before to
// after, and (for content, posts and plans) "Restore the earlier version",
// which writes the `before` value back as a new, itself-undoable change.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RotateCcwIcon } from "lucide-react";
import { getAuditEntry, RESTORABLE_ENTITIES } from "@/server/services/audit";
import { BreadcrumbLeaf } from "@/components/product/app-breadcrumb";
import { PageHeader } from "@/components/product/page-header";
import { DetailList } from "@/components/product/detail-list";
import { DiffView } from "@/components/admin/diff-view";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { emailsFor } from "@/components/admin/change-list";
import { actorWords, describeAudit } from "@/lib/audit-words";
import { formatDateTime } from "@/lib/format";
import { diffJson } from "@/lib/json-diff";
import { maskAuditEntry } from "@/shared/privacy-mask";
import { privacyLens } from "@/server/demo";
import { requireAdmin } from "@/server/session";
import { restoreAction } from "../actions";

export const metadata: Metadata = { title: "Change" };

export default async function AuditEntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lens = privacyLens(await requireAdmin());
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const stored = await getAuditEntry(id);
  if (!stored) notFound();
  // Who, the record and before/after as this viewer may see them (masked for the read-only demo admin).
  const entry = maskAuditEntry(lens, stored);
  const words = describeAudit(entry, await emailsFor([stored], lens));
  const diff = diffJson(entry.before, entry.after);
  const restorable = (RESTORABLE_ENTITIES as readonly string[]).includes(entry.entity);
  const createdSomething = entry.before === null || entry.before === undefined;

  return (
    <>
      <BreadcrumbLeaf name={`${words.verb} ${words.target}`} />
      <PageHeader
        eyebrow={
          <Link href="/admin/audit" className="underline-offset-4 hover:underline">
            Audit log
          </Link>
        }
        title={`${words.verb} ${words.target}`}
        answer={`${actorWords(entry)} · ${formatDateTime(entry.createdAt)}`}
        action={
          restorable ? (
            <ConfirmAction
              action={restoreAction.bind(null, entry.id)}
              triggerVariant="outline"
              trigger={
                <>
                  <RotateCcwIcon aria-hidden /> {createdSomething ? "Undo this" : "Restore the earlier version"}
                </>
              }
              title={createdSomething ? "Undo this change?" : "Restore the earlier version?"}
              description={
                createdSomething
                  ? entry.entity === "content"
                    ? "The section goes back to the template’s default. This is recorded as a new change, so you can undo it too."
                    : `This removes the ${entry.entity} it created. This is recorded as a new change, so you can undo it too.`
                  : "The “before” value below is written back and goes live now. Anything changed since is replaced. This is recorded as a new change, so you can undo it too."
              }
              confirmLabel={createdSomething ? "Undo" : "Restore"}
            />
          ) : undefined
        }
      />
      {sp.restored ? (
        <p role="status" className="text-small text-positive">
          Restored. {words.href ? <Link href={words.href} className="font-semibold underline underline-offset-4">Open it</Link> : null}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <section aria-labelledby="diff-title" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6">
          <h2 id="diff-title" className="font-sans text-body font-semibold text-ink">
            What changed
          </h2>
          <DiffView diff={diff} />
        </section>
        <aside className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5" aria-label="Details">
          <DetailList
            variant="pairs"
            items={[
              { label: "Action", value: <code className="font-mono text-caption">{entry.action}</code> },
              { label: "Record", value: <code className="font-mono text-caption break-all">{entry.entityId ?? "—"}</code> },
              { label: "By", value: <span className="break-all">{actorWords(entry)}</span> },
              { label: "When", value: formatDateTime(entry.createdAt) },
            ]}
          />
          {words.href ? (
            <Link href={words.href} className="text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
              Open the {entry.entity === "agent_key" ? "agent keys" : entry.entity}
            </Link>
          ) : null}
          {!restorable ? <p className="text-caption text-ink-3">Changes to {entry.entity.replace("_", " ")}s can’t be restored automatically.</p> : null}
        </aside>
      </div>
    </>
  );
}
