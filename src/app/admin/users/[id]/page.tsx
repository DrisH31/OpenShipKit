//
// /admin/users/<id> — one person: who they are, what they pay for (from the
// webhook-written rows), their feedback, and the controls: role, ban, delete.
// The read-only demo admin sees someone else's email, name and feedback masked.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryIcon, Trash2Icon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { BreadcrumbLeaf } from "@/components/product/app-breadcrumb";
import { PageHeader } from "@/components/product/page-header";
import { DetailList } from "@/components/product/detail-list";
import { StatusBadge } from "@/components/product/status-badge";
import { breakableEmail } from "@/components/product/copy-value";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { BanForm, RoleForm } from "@/components/admin/user-controls";
import { entitlementNextStep } from "@/components/dashboard/plan-card";
import { formatDate, formatDateTime } from "@/lib/format";
import { FEEDBACK_KIND, FEEDBACK_STATUS, SUBSCRIPTION_STATUS, entitlementStatus } from "@/lib/status";
import { formatPrice } from "@/shared/money";
import { showEmail, showName, showTitle } from "@/shared/privacy-mask";
import { privacyLens } from "@/server/demo";
import { requireAdmin } from "@/server/session";
import { listPlans } from "@/server/services/plans";
import { getUserDetail } from "@/server/services/users";
import { deleteUserAction, setBannedAction, setRoleAction } from "../actions";

export const metadata: Metadata = { title: "User" };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
      <h2 className="font-sans text-body font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  const lens = privacyLens(me);
  const { id } = await params;
  // getUserDetail also finds people by email; for the read-only demo admin that would say who
  // has an account, so it looks up ids only.
  if (lens.masking && /@|%40/i.test(id)) notFound();
  const detail = await getUserDetail(id).catch((error: unknown) => {
    if ((error as { name?: string; code?: string }).name === "ServiceError" && (error as { code?: string }).code === "not_found") return null;
    throw error;
  });
  if (!detail) notFound();
  const { user, entitlement, subscriptions, purchases, feedback } = detail;
  const self = user.id === me.id;
  const ent = entitlementStatus(entitlement);
  // Plans by name, not key ("Pro", not "pro"); a key no plan has any more is shown as stored.
  const plans = await listPlans();
  const planName = (key: string | null) => (key ? (plans.find((p) => p.key === key)?.name ?? key) : null);
  const currentPlan = planName(entitlement.planKey) ?? "Free";
  const email = showEmail(lens, user.email);
  const name = user.name ? showName(lens, user.name, user.email) : null;

  return (
    <>
      <BreadcrumbLeaf name={email} />
      <PageHeader
        eyebrow={
          <Link href="/admin/users" className="underline-offset-4 hover:underline">
            Users
          </Link>
        }
        title={<span className="[overflow-wrap:anywhere]">{breakableEmail(email)}</span>}
        answer={name ? `${name}${self ? " · you" : ""}` : self ? "You" : undefined}
        action={
          <>
            <Link
              href={`/admin/audit?entity=user&entityId=${user.id}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <HistoryIcon aria-hidden className="size-3.5" /> History
            </Link>
            {self ? null : (
              <ConfirmAction
                action={deleteUserAction.bind(null, user.id)}
                trigger={
                  <>
                    <Trash2Icon aria-hidden /> Delete
                  </>
                }
                title={`Delete ${email}?`}
                description="Their account, sign-in methods, sessions and billing records are removed now, and they’re signed out everywhere. Feedback they sent stays, without their name. This can’t be undone. Cancel any paid subscription at Polar first."
                confirmLabel="Delete user"
              />
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Account">
          <DetailList
            variant="pairs"
            items={[
              // The role is the Access card's job (its select shows it); this row says whether the account can be used.
              { label: "Status", value: user.banned ? <StatusBadge label="Banned" tone="danger" /> : <StatusBadge label="Active" tone="positive" /> },
              { label: "Joined", value: formatDateTime(user.createdAt) },
              { label: "Last seen", value: formatDateTime(user.lastSeenAt) },
              { label: "User id", value: <code className="font-mono text-caption break-all">{user.id}</code> },
            ]}
          />
        </Card>

        <Card title="Access">
          <RoleForm action={setRoleAction.bind(null, user.id)} role={user.role} self={self} />
          <div className="border-t border-line pt-4">
            <p className="mb-3 text-small text-ink-2">{user.banned ? "Banned: they can’t use the dashboard or the admin." : "A ban keeps them out of the dashboard and the admin until you lift it."}</p>
            <BanForm action={setBannedAction.bind(null, user.id, !user.banned)} banned={user.banned} self={self} />
          </div>
        </Card>

        <Card title="Plan">
          <p className="flex flex-wrap items-center gap-2 text-small text-ink">
            <span className="font-semibold">{currentPlan}</span>
            {ent.label === currentPlan ? null : <StatusBadge label={ent.label} tone={ent.tone} />}
          </p>
          <p className="text-small text-ink-2">{entitlementNextStep(entitlement).replace(/^You’re/, "They’re").replace(/^It’s yours/, "It’s theirs")}</p>
          {subscriptions.length || purchases.length ? (
            <ul className="flex flex-col gap-2 text-small">
              {subscriptions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={SUBSCRIPTION_STATUS[s.status].label} tone={SUBSCRIPTION_STATUS[s.status].tone} />
                  <span className="text-ink">
                    {planName(s.planKey) ?? "Subscription"} · {s.interval === "year" ? "yearly" : s.interval === "month" ? "monthly" : "—"}
                  </span>
                  <span className="text-ink-3">{s.currentPeriodEnd ? `period ends ${formatDate(s.currentPeriodEnd)}` : `since ${formatDate(s.createdAt)}`}</span>
                  <code className="font-mono text-caption text-ink-3">{s.providerSubscriptionId}</code>
                </li>
              ))}
              {purchases.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={p.refunded ? "Refunded" : "Paid"} tone={p.refunded ? "neutral" : "positive"} />
                  <span className="text-ink">
                    {planName(p.planKey) ?? "Purchase"} · {formatPrice(p.amountCents, p.currency)}
                  </span>
                  <span className="text-ink-3">{formatDate(p.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-ink-3">No subscriptions or purchases.</p>
          )}
        </Card>

        <Card title="Feedback">
          {feedback.length ? (
            <ul className="flex flex-col gap-2">
              {feedback.map((f) => (
                <li key={f.id} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
                  <span className="flex flex-wrap items-center gap-2 text-caption text-ink-3">
                    {FEEDBACK_KIND[f.kind]} · {formatDate(f.createdAt)} <StatusBadge label={FEEDBACK_STATUS[f.status].label} tone={FEEDBACK_STATUS[f.status].tone} />
                  </span>
                  <Link href={`/admin/feedback#feedback-${f.id}`} className="line-clamp-2 text-small text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink">
                    {f.title ? showTitle(lens, f.title) : showTitle(lens, f.message)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-ink-3">Nothing sent.</p>
          )}
        </Card>
      </div>
    </>
  );
}
