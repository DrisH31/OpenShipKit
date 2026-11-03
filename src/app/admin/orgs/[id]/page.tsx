//
// /admin/orgs/[id] — one organisation, read-only: its members and roles, open
// invitations, seats, and its subscription. The read-only demo admin sees every
// address masked (privacyLens). 404 while teams are off or for an unknown id.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/product/page-header";
import { StatusBadge } from "@/components/product/status-badge";
import { formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS } from "@/lib/status";
import { showEmail } from "@/shared/privacy-mask";
import { privacyLens } from "@/server/demo";
import { adminGetOrg, teamsEnabled } from "@/server/services/orgs";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Organisation" };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
      <h2 className="font-sans text-body font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  const lens = privacyLens(await requireAdmin());
  if (!teamsEnabled()) notFound();
  const { id } = await params;
  const detail = await adminGetOrg(id).catch((error: unknown) => {
    if ((error as { code?: string }).code === "not_found") return null;
    throw error;
  });
  if (!detail) notFound();
  const { org, members, invitations, subscriptions, seats } = detail;

  return (
    <>
      <PageHeader
        title={org.name}
        answer={`${org.slug} · created ${formatDate(org.createdAt)} · ${seats.limit === null ? `${seats.used} in the team` : `${seats.used} of ${seats.limit} seats in use`}`}
      />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card title={`Members (${members.length})`}>
          <ul className="flex flex-col gap-2 text-small">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/users/${m.userId}`} className="text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink [overflow-wrap:anywhere]">
                  {showEmail(lens, m.email)}
                </Link>
                <StatusBadge label={m.role === "owner" ? "Owner" : m.role === "admin" ? "Admin" : "Member"} tone={m.role === "owner" ? "positive" : m.role === "admin" ? "info" : "neutral"} />
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Subscription">
            {subscriptions.length === 0 ? (
              <p className="text-small text-ink-2">None: on the free plan.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-small">
                {subscriptions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={SUBSCRIPTION_STATUS[s.status].label} tone={SUBSCRIPTION_STATUS[s.status].tone} />
                    <span className="text-ink">
                      {s.planKey ?? "No plan"}
                      {s.seats !== null ? ` · ${s.seats} seats` : ""}
                    </span>
                    <span className="text-ink-3">{s.currentPeriodEnd ? `period ends ${formatDate(s.currentPeriodEnd)}` : `since ${formatDate(s.createdAt)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Open invitations (${invitations.length})`}>
            {invitations.length === 0 ? (
              <p className="text-small text-ink-2">None.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-small text-ink-2">
                {invitations.map((i) => (
                  <li key={i.id} className="[overflow-wrap:anywhere]">
                    {showEmail(lens, i.email)} · {i.role} · until {formatDate(i.expiresAt)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="text-small text-ink-3">
            Its changes are in the <Link href={`/admin/audit?entity=org&entityId=${org.id}`} className="underline underline-offset-4">audit log</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
