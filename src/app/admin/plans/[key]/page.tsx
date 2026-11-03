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
import { deletePlanAction, savePlan } from "../actions";

export const metadata: Metadata = { title: "Edit plan" };

export default async function EditPlanPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const plan = await getPlan(key);
  if (!plan) notFound();
  const node = fieldNodeFor(planSchema);
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
              description="It disappears from the pricing page and checkout. People who already pay keep their subscription at Polar. You can bring the plan back from the audit log. To hide it without deleting, turn off “Active” instead."
              confirmLabel="Delete plan"
            />
          </>
        }
      />
      {sp.created ? (
        <p role="status" className="text-small text-positive">
          Plan created. Add its Polar product ids when you turn payments on.
        </p>
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
