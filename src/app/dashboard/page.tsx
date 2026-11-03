//
// /dashboard — home. Everyone sees their plan and where to go next; admins
// also see the "Make it yours" checklist, each step's state read live from the
// app (stored content, plan edits made by people or agents, env, agent keys),
// never guessed. Without the checklist, the demo marks the place where the
// product's own screens go.
//
// Under OPENSHIPKIT_PROFILE=site (no pricing, billing or plans) there is no plan
// card, no Billing place and no plan, payment or Polar steps — and none of their
// reads: a content site's dashboard is accounts, feedback and settings.
//

import type { Metadata } from "next";
import Link from "next/link";
import { CreditCardIcon, MessageSquareIcon, SettingsIcon } from "lucide-react";
import type { User } from "@/core/types";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { PlanCard } from "@/components/dashboard/plan-card";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { forProfile } from "@/core/profile";
import { isDemo, siteProfile } from "@/server/env";
import { getSetupSteps } from "@/server/setup-steps";
import { requireUser } from "@/server/session";
import { getEntitlement } from "@/server/services/billing";
import { getPlan } from "@/server/services/plans";

export const metadata: Metadata = { title: "Home" };

const PLACES = [
  { href: "/dashboard/billing", label: "Billing", body: "Your plan, payments and receipts.", Icon: CreditCardIcon },
  { href: "/dashboard/feedback", label: "Feedback", body: "Report a bug or ask for a feature.", Icon: MessageSquareIcon },
  { href: "/dashboard/settings", label: "Settings", body: "Name, password, sessions and two-factor.", Icon: SettingsIcon },
];

/** How long after sign-up the home says "Welcome" rather than "Welcome back". */
const NEW_ACCOUNT_MS = 10 * 60_000;

function greeting(user: User, now: Date): string {
  const first = user.name?.trim().split(/\s+/)[0];
  const created = Date.parse(user.createdAt);
  const hello = Number.isFinite(created) && now.getTime() - created < NEW_ACCOUNT_MS ? "Welcome" : "Welcome back";
  return first ? `${hello}, ${first}` : hello;
}

/**
 * The plan and the places to go: the home's whole content for a customer, the
 * left column for an admin. No plan card or Billing place under the site profile
 * (account null): there is nothing to buy.
 */
function AccountOverview({ account }: { account: React.ComponentProps<typeof PlanCard> | null }) {
  const places = account ? PLACES : forProfile("site", PLACES);
  return (
    <>
      {account ? <PlanCard entitlement={account.entitlement} plan={account.plan} /> : null}
      <nav aria-label="Your account" className="flex flex-col rounded-xl border border-line bg-card">
        {places.map(({ href, label, body, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-14 items-center gap-3 border-t border-line px-5 py-3 first:border-t-0 hover:bg-tonal focus-visible:bg-tonal"
          >
            <Icon aria-hidden className="size-4 shrink-0 text-ink-2" />
            <span className="flex flex-col">
              <span className="text-small font-semibold text-ink">{label}</span>
              <span className="text-caption text-ink-3">{body}</span>
            </span>
          </Link>
        ))}
      </nav>
    </>
  );
}

/** What the plan card shows: the webhook-written entitlement and its plan. */
async function planOf(userId: string): Promise<React.ComponentProps<typeof PlanCard>> {
  const entitlement = await getEntitlement(userId);
  return { entitlement, plan: entitlement.planKey ? await getPlan(entitlement.planKey) : null };
}

export default async function DashboardHome() {
  const user = await requireUser("/dashboard");
  const now = new Date();
  const saas = siteProfile() === "saas";
  const [account, steps] = await Promise.all([
    saas ? planOf(user.id) : Promise.resolve(null),
    user.role === "admin" ? getSetupSteps(saas) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title={greeting(user, now)} answer={`Signed in as ${user.email}.`} />
      {steps ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
          <div className="flex flex-col gap-4">
            <AccountOverview account={account} />
          </div>
          <SetupChecklist steps={steps} />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 md:items-start">
            <AccountOverview account={account} />
          </div>
          {isDemo() ? (
            <EmptyState
              title="Your product goes here"
              body={
                <>
                  This is the first screen your customers see after they sign in. Put your app’s own screens here: edit{" "}
                  <code className="font-mono text-caption">src/app/dashboard/page.tsx</code>. Only the demo shows this note.
                </>
              }
            />
          ) : null}
        </>
      )}
    </>
  );
}
