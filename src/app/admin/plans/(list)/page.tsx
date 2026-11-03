//
// /admin/plans — every plan in pricing-page order, with its prices and
// whether each paid price is connected to a Polar product (checkout stays
// off for a price until it is).
//
// On a phone the table keeps what answers the page: the plan, its prices
// (one per line) and whether it is shown; the Polar column joins from sm up.
//

import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { priceLabel } from "@/components/billing/format";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { LinkPending } from "@/components/product/link-pending";
import { billingProvider } from "@/server/env";
import { requireAdmin } from "@/server/session";
import { listPlans } from "@/server/services/plans";
import { PRICE_ID_LABEL, PROVIDER_LABEL, priceIdFor, type PaidProviderId } from "@/core/billing";

export const metadata: Metadata = { title: "Plans" };

export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const [plans, sp] = await Promise.all([listPlans(), searchParams]);
  const configured = billingProvider();
  const billingOn = configured !== "none";
  // Whose ids the list checks: the configured provider, or Polar's while billing is off (the default recommendation).
  const provider: PaidProviderId = configured === "none" ? "polar" : configured;

  return (
    <>
      <PageHeader
        title="Plans"
        answer={
          billingOn
            ? `What the pricing page sells. Each paid price needs its ${PRICE_ID_LABEL[provider]} before it can be bought.`
            : "What the pricing page shows. Payments are off until POLAR_ACCESS_TOKEN is set, so nothing can be bought yet."
        }
        action={
          <Link href="/admin/plans/new" className={buttonVariants({ size: "sm" })}>
            <PlusIcon aria-hidden /> New plan
          </Link>
        }
      />
      {sp.deleted ? (
        <p role="status" className="text-small text-positive">
          Plan deleted. You can bring it back from the audit log.
        </p>
      ) : null}
      {plans.length === 0 ? (
        <EmptyState title="No plans yet" body="Add a free plan and a paid one. The pricing page and checkout read them from here." action={<Link href="/admin/plans/new" className={buttonVariants({ size: "sm" })}>New plan</Link>} />
      ) : (
        <div className="rounded-xl border border-line bg-card">
          <Table label="Plans">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Plan</TableHead>
                <TableHead>Prices</TableHead>
                <TableHead className="hidden sm:table-cell">{PROVIDER_LABEL[provider]}</TableHead>
                <TableHead className="px-4">Shown</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => {
                const paid = p.prices.filter((x) => x.amountCents > 0);
                const linked = paid.filter((x) => priceIdFor(p, x, provider)).length;
                return (
                  <TableRow key={p.key}>
                    <TableCell className="px-4 py-3">
                      <Link href={`/admin/plans/${p.key}`} className="font-semibold text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink focus-visible:decoration-ink">
                        {p.name}
                        <LinkPending className="ml-1.5 align-[-0.125em]" />
                      </Link>
                      <span className="block font-mono text-caption text-ink-3">{p.key}</span>
                    </TableCell>
                    <TableCell className="tabular whitespace-normal">
                      {p.contactSales ? (
                        "Contact sales"
                      ) : p.prices.length ? (
                        <ul className="flex flex-col">
                          {p.prices.map((x) => (
                            <li key={`${x.interval}-${x.currency}`} className="whitespace-nowrap">
                              {priceLabel(x)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "Free"
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {p.contactSales || paid.length === 0 ? (
                        <span className="text-ink-3">Not needed</span>
                      ) : linked === paid.length ? (
                        <StatusBadge label="Connected" tone="positive" />
                      ) : (
                        <StatusBadge label={`${paid.length - linked} missing`} tone="warning" />
                      )}
                    </TableCell>
                    <TableCell className="px-4">
                      <span className="flex flex-col items-start gap-1">
                        {p.active ? <StatusBadge label="Live" tone="positive" /> : <StatusBadge label="Hidden" tone="neutral" />}
                        {p.active && p.highlighted ? <span className="text-caption text-ink-3">Highlighted</span> : null}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
