//
// /admin/plans/new — a new plan in the same schema-generated editor, starting
// from planSchema's defaults. Saving creates it and opens its page.
//

import type { Metadata } from "next";
import Link from "next/link";
import { planSchema } from "@/core/schemas";
import { PageHeader } from "@/components/product/page-header";
import { SchemaEditor } from "@/components/admin/schema-editor";
import { PLAN_HINTS, PLAN_LABELS, PLAN_MONEY, PLAN_OPTION_LABELS } from "@/components/admin/plan-editor-config";
import { defaultFor } from "@/lib/schema-form";
import { fieldNodeFor } from "@/lib/schema-node";
import { requireAdmin } from "@/server/session";
import { createPlan } from "../actions";

export const metadata: Metadata = { title: "New plan" };

export default async function NewPlanPage() {
  await requireAdmin();
  const node = fieldNodeFor(planSchema);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/plans" className="underline-offset-4 hover:underline">
            Plans
          </Link>
        }
        title="New plan"
        answer="Give it a key and a name, then its prices. Leave the prices empty for a free plan."
      />
      <div className="max-w-3xl rounded-xl border border-line bg-card px-5 pt-5 sm:px-6 sm:pt-6">
        <SchemaEditor
          node={node}
          initial={defaultFor(node)}
          action={createPlan}
          saveLabel="Create plan"
          hints={PLAN_HINTS}
          labels={PLAN_LABELS}
          optionLabels={PLAN_OPTION_LABELS}
          money={PLAN_MONEY}
          idPrefix="plan-new"
        />
        <div className="pb-5 sm:pb-6" />
      </div>
    </>
  );
}
