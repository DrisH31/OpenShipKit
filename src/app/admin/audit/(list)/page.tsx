//
// /admin/audit — every change made through the app's services, by people and
// agents, newest first. Filter by what changed (?entity=) and one record
// (?entityId=, from a "History" link). Each entry opens its diff and, for
// content, posts and plans, a restore.
//

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { ChangeList } from "@/components/admin/change-list";
import { ExpiredPage, FilterTabs, NextPageLink, hrefWith, listPage } from "@/components/admin/filter-bar";
import { AUDIT_ENTITIES } from "@/lib/audit-words";
import { privacyLens } from "@/server/demo";
import { requireAdmin } from "@/server/session";
import { listAudit } from "@/server/services/audit";

export const metadata: Metadata = { title: "Audit log" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lens = privacyLens(await requireAdmin());
  const sp = await searchParams;
  const entity = AUDIT_ENTITIES.some((e) => e.value === one(sp.entity)) ? one(sp.entity) : undefined;
  const entityId = entity ? one(sp.entityId)?.slice(0, 200) : undefined;
  const cursor = one(sp.cursor) ?? null;

  const page = await listPage(() => listAudit({ entity, entityId, cursor, limit: 50 }));
  const now = new Date();

  return (
    <>
      <PageHeader title="Audit log" answer="Every change, who made it (a person or an agent key), and the value before and after. Content, posts and plans can be put back." />
      <FilterTabs
        label="What changed"
        options={[
          { href: "/admin/audit", label: "Everything", active: !entity },
          ...AUDIT_ENTITIES.map((e) => ({ href: hrefWith("/admin/audit", { entity: e.value }), label: e.label, active: entity === e.value && !entityId })),
        ]}
      />
      {entityId ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-ink-2">
          Showing the history of one record.
          <Link href={hrefWith("/admin/audit", { entity })} className="font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
            Show all {AUDIT_ENTITIES.find((e) => e.value === entity)?.label.toLowerCase()}
          </Link>
        </p>
      ) : null}
      {!page ? (
        <ExpiredPage href={hrefWith("/admin/audit", { entity, entityId })} body="The log moved on since the link was made." />
      ) : page.items.length === 0 ? (
        <EmptyState
          kind={entity ? "no-results" : "first-use"}
          title={entity ? "No changes here yet" : "No changes yet"}
          body="Edits to content, posts, plans, users, feedback and agent keys are recorded here as they happen."
        />
      ) : (
        <>
          <div className="rounded-xl border border-line bg-card">
            <ChangeList entries={page.items} now={now} lens={lens} />
          </div>
          <NextPageLink href={page.nextCursor ? hrefWith("/admin/audit", { entity, entityId, cursor: page.nextCursor }) : null} />
        </>
      )}
    </>
  );
}
