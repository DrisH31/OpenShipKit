import "server-only";

//
// Which organisation a signed-in person is working in (OPENSHIPKIT_TENANCY=org).
// The choice is a preference in a cookie (ORG_COOKIE), never a permission:
// currentOrg() checks the membership on every read and falls back to their
// first organisation, so a tampered or stale cookie grants nothing. Set only
// for signed-in people, so anonymous visitors still get no cookies (AGENTS.md rule 15).
//

import { cookies } from "next/headers";
import type { User } from "@/core/types";
import { isProduction } from "./env";
import { listMyOrgs, teamsEnabled, type OrgAccess } from "./services/orgs";

export const ORG_COOKIE = "osk_org";

/** The organisation `user` is working in, with their role; null when teams are off or they belong to none. */
export async function currentOrg(user: User): Promise<OrgAccess | null> {
  if (!teamsEnabled()) return null;
  const mine = await listMyOrgs(user);
  if (mine.length === 0) return null;
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  return mine.find((m) => m.org.id === wanted) ?? mine[0];
}

/** Remember the organisation to open next time. Callers check membership first (switchOrg). */
export async function rememberOrg(orgId: string): Promise<void> {
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: isProduction(), path: "/", maxAge: 60 * 60 * 24 * 365 });
}
