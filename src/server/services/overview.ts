import "server-only";

//
// One read of "how is the site doing and what is it running on" — the admin
// home and the MCP tool site.overview. `growth` is new accounts and
// subscribers per UTC day over the last 30 days (the overview's trends).
//

import { getData } from "../data";
import { billingProvider, dataMode, emailProvider, isDemo, siteProfile, siteUrl } from "../env";
import { listAudit } from "./audit";

/** The span of the overview's trends, in days. */
export const GROWTH_DAYS = 30;

export async function getOverview() {
  const data = await getData();
  const checkedAt = new Date();
  const [stats, health, recent, growth] = await Promise.all([data.stats(), data.health(), listAudit({ limit: 10 }), data.growth(GROWTH_DAYS, checkedAt)]);
  return {
    siteUrl: siteUrl(),
    stack: {
      /** saas, or site: a landing page + blog with no pricing, billing or plans (billing is then none). */
      profile: siteProfile(),
      auth: "better-auth" as const,
      data: dataMode(),
      billing: billingProvider(),
      email: emailProvider(),
      demo: isDemo(),
    },
    health,
    /** When these figures were read (ISO): the overview says so once, for the set. */
    checkedAt: checkedAt.toISOString(),
    stats,
    growth,
    recentChanges: recent.items,
  };
}
