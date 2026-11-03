//
// /admin/plans/<key> — edit every field of a plan, prices and Polar product
// ids included, in the schema-generated editor (planSchema). The key is shown
// but pinned: it is the plan's identity.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryIcon, Trash2Icon } from "lucide-react";
import { planSchema } from "@/core/schemas";
import { buttonVariants } from "@/components/ui/button";
import { BreadcrumbLeaf } from "@/components/product/app-breadcrumb";
import { PageHeader } from "@/components/product/page-header";
import { SchemaEditor } from "@/components/admin/schema-editor";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { PLAN_HINTS, PLAN_LABELS, PLAN_MONEY, PLAN_OPTION_LABELS } from "@/components/admin/plan-editor-config";
import { formatDateTime } from "@/lib/format";
import { withDefaults } from "@/lib/schema-form";
import { fieldNodeFor } from "@/lib/schema-node";
import { requireAdmin } from "@/server/session";
import { getPlan } from "@/server/services/plans";
import { checkPlanPrices } from "@/server/services/billing";
import { deletePlanAction, savePlan } from "../actions";

export const metadata: Metadata = { title: "Edit plan" };

export default async function EditPlanPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const plan = await getPlan(key);
  if (!plan) notFound();
  const node = fieldNodeFor(planSchema);
  // What the provider really charges, against what the pricing page shows (never blocks the editor).
  const priceCheck = await checkPlanPrices(plan);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, updatedAt, ...value } = plan;

  return (
    <>
      <BreadcrumbLeaf name={plan.name} />
      <PageHeader
        eyebrow={
          <Link href="/admin/plans" className="underline-offset-4 hover:underline">
            Plans
          </Link>
        }
        title={plan.name}
        answer={`Last saved ${formatDateTime(updatedAt)}.`}
        action={
          <>
            <Link
              href={`/admin/audit?entity=plan&entityId=${plan.key}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <HistoryIcon aria-hidden className="size-3.5" /> History
            </Link>
            <ConfirmAction
              action={deletePlanAction.bind(null, plan.key)}
              trigger={
                <>
                  <Trash2Icon aria-hidden /> Delete
                </>
              }
              title={`Delete the ${plan.name} plan?`}
              description="It disappears from the pricing page and checkout. People who already pay keep their subscription with the payment provider. You can bring the plan back from the audit log. To hide it without deleting, turn off “Active” instead."
              confirmLabel="Delete plan"
            />
          </>
        }
      />
      {sp.created ? (
        <p role="status" className="text-small text-positive">
          Plan created. Add its payment provider&apos;s price ids when you turn payments on.
        </p>
      ) : null}
      {priceCheck && "unavailable" in priceCheck ? (
        <p role="status" className="max-w-3xl text-small text-ink-3">
          Couldn&apos;t reach {priceCheck.provider} to compare its prices with this plan&apos;s. Try again in a moment.
        </p>
      ) : priceCheck && priceCheck.problems.length > 0 ? (
        <div role="alert" className="max-w-3xl rounded-xl border border-line-strong bg-card p-4">
          <p className="text-small font-semibold text-ink">The pricing page and {priceCheck.provider} disagree</p>
          <p className="text-small text-ink-2">Customers see this plan&apos;s amounts but pay {priceCheck.provider}&apos;s. Change one to match the other.</p>
          <ul className="mt-2 list-disc pl-5 text-small text-ink-2">
            {priceCheck.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="max-w-3xl rounded-xl border border-line bg-card px-5 pt-5 sm:px-6 sm:pt-6">
        <SchemaEditor
          node={node}
          initial={withDefaults(node, value)}
          action={savePlan.bind(null, plan.key)}
          saveLabel="Save plan"
          readOnly={["key"]}
          hints={PLAN_HINTS}
          labels={PLAN_LABELS}
          optionLabels={PLAN_OPTION_LABELS}
          money={PLAN_MONEY}
          idPrefix={`plan-${plan.key}`}
        />
        <div className="pb-5 sm:pb-6" />
      </div>
    </>
  );
}
