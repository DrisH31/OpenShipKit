import "server-only";

//
// The "Make it yours" steps: what is left between this template and a product
// people can pay for, each step's state read live from the running app (stored
// content, plan edits made by people or agents, env, agent keys), never
// guessed. One list for both places an admin sees it: the full checklist on
// /dashboard and the progress card and "Needs you" items on /admin.
//
// Under OPENSHIPKIT_PROFILE=site the plan, payment and Polar steps are left
// out, and so are their reads.
//

import { CopyValue } from "@/components/product/copy-value";
import type { SetupStep } from "@/components/dashboard/setup-checklist";
import { SEED_POSTS, isStarterContent } from "@/content/seed-posts";
import { editedByPeople } from "@/lib/audit-words";
import { docUrl } from "@/lib/docs";
import { isLocalUrl } from "@/lib/site-url";
import { isShowcase } from "@/shared/seo";
import { billingProvider, emailProvider, isDemo, siteUrl } from "./env";
import { listAgentKeys } from "./services/agent-keys";
import { listAudit } from "./services/audit";
import { getContentState } from "./services/content";
import { listPlans } from "./services/plans";
import { getPublishedPost } from "./services/posts";

/**
 * The published starter blog posts and changelog entries still in OpenShipKit's
 * own words (isStarterContent): one read per starter slug, a handful.
 */
async function liveStarterPosts(): Promise<number> {
  const starters = SEED_POSTS.filter((p) => p.kind === "post" || p.kind === "changelog");
  const found = await Promise.all(starters.map((p) => getPublishedPost(p.kind, p.slug)));
  return found.filter((post) => post !== null && isStarterContent(post)).length;
}

/** The steps only a SaaS has: plans, payments, Polar products. */
const SAAS_STEPS: ReadonlySet<string> = new Set(["plans", "billing", "polar"]);

export async function getSetupSteps(saas: boolean): Promise<SetupStep[]> {
  const [site, planEdits, plans, keys, starters] = await Promise.all([
    getContentState("site"),
    // The seed records a plan.create per starter plan; only a person's or an agent's edit counts.
    saas ? listAudit({ entity: "plan", limit: 50 }) : { items: [] },
    saas ? listPlans() : [],
    listAgentKeys(),
    liveStarterPosts(),
  ]);
  const renamed = !isShowcase(site.value);
  const paidPrices = plans.filter((p) => p.active && !p.contactSales).flatMap((p) => p.prices.filter((x) => x.amountCents > 0));
  const unlinked = paidPrices.filter((p) => !p.polarProductId).length;
  const billingOn = billingProvider() === "polar";
  const url = siteUrl();
  const deployed = !isDemo() && !isLocalUrl(url);

  const steps: SetupStep[] = [
    {
      id: "brand",
      title: "Name your product",
      body: "Set the name, tagline, description and contact email. They feed every page title, the social cards and the emails.",
      state: site.stored ? "done" : "todo",
      action: { label: "Edit site settings", href: "/admin/content/site" },
      doc: { label: "Customising the template", href: docUrl("customization") },
    },
    {
      id: "starter-posts",
      title: "Replace the starter posts",
      body:
        starters === 0
          ? "No starter posts are published. The blog and changelog are your own."
          : renamed
            ? `${starters} starter ${starters === 1 ? "post is" : "posts are"} still OpenShipKit’s text: ${starters === 1 ? "it’s" : "they’re"} noindex and out of the sitemap, feeds and llms files. Rewrite or delete ${starters === 1 ? "it" : "them"}.`
            : `The blog and changelog start with ${starters} of OpenShipKit’s own posts. Once you’ve named your product, rewrite or delete them: on a renamed site they’re kept out of search, the sitemap and the feeds.`,
      // A warning, not a nudge, once the site is renamed: those pages now say things about OpenShipKit on your domain.
      state: starters === 0 ? "done" : "todo",
      action: { label: "Edit posts", href: "/admin/posts" },
    },
    {
      id: "plans",
      title: "Set your plans and prices",
      body: "Rename the plans, write their features and set the prices you actually charge.",
      state: editedByPeople(planEdits.items) ? "done" : "todo",
      action: { label: "Edit plans", href: "/admin/plans" },
    },
    {
      id: "billing",
      title: "Turn on payments",
      body: (
        <>
          Set <code className="font-mono text-caption">POLAR_ACCESS_TOKEN</code> and <code className="font-mono text-caption">POLAR_WEBHOOK_SECRET</code>, and point Polar’s
          webhook at this address:
          <CopyValue value={`${url}/api/billing/webhook`} srLabel="Copy the webhook address" className="my-1 flex w-fit" />
          Polar is the merchant of record, so it handles tax and receipts.
        </>
      ),
      state: billingOn ? "done" : "optional",
      doc: { label: "Billing guide", href: docUrl("billing") },
    },
    {
      id: "polar",
      title: "Connect each price to a Polar product",
      body:
        paidPrices.length === 0
          ? "No paid prices yet. Add one to a plan first."
          : unlinked
            ? `${unlinked} of ${paidPrices.length} paid prices have no Polar product id yet. Checkout stays off for those until you paste one in.`
            : "Every paid price has a Polar product id.",
      state: paidPrices.length > 0 && unlinked === 0 ? "done" : billingOn ? "todo" : "optional",
      action: { label: "Add product ids", href: "/admin/plans" },
    },
    {
      id: "email",
      title: "Send real email",
      body: (
        <>
          Set <code className="font-mono text-caption">RESEND_API_KEY</code>, or <code className="font-mono text-caption">SMTP_URL</code> for your own mail server, and{" "}
          <code className="font-mono text-caption">EMAIL_FROM</code> on a verified domain. Until then, emails print to the server log.
        </>
      ),
      state: emailProvider() === "console" ? "optional" : "done",
      doc: { label: "Email guide", href: docUrl("email") },
    },
    {
      id: "mcp",
      title: "Connect an AI agent",
      body: "Mint an agent key and paste the config into Claude Code or Cursor. The agent edits content and posts through the same audited services you use.",
      state: keys.some((k) => !k.revokedAt) ? "done" : "todo",
      action: { label: "Mint a key", href: "/admin/agents" },
      doc: { label: "MCP guide", href: docUrl("mcp") },
    },
    {
      id: "deploy",
      title: "Deploy on your own server",
      body: (
        <>
          Run it with docker compose, Dokploy, Coolify or any Node host with Postgres. Set <code className="font-mono text-caption">DATABASE_URL</code> and{" "}
          <code className="font-mono text-caption">NEXT_PUBLIC_SITE_URL</code>.
        </>
      ),
      state: deployed ? "done" : "todo",
      doc: { label: "Deployment guide", href: docUrl("deployment") },
    },
  ];
  return saas ? steps : steps.filter((step) => !SAAS_STEPS.has(step.id));
}
