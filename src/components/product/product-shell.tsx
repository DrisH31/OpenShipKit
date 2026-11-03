import "server-only";

//
// <ProductShell kind="dashboard" | "admin"> — what the two layouts render: it
// loads everything the shell needs (product name, the auth adapter's sign-out
// button, the sidebar cookie, demo mode, what is waiting on an admin) and hands
// plain data to <AppShell>.
//
// The caller has already checked who is signed in (requireUser / requireAdmin)
// and passes that user in; this never decides access.
//
// Under OPENSHIPKIT_PROFILE=site the sidebar, breadcrumb and command menu leave
// out the SaaS-only places (Billing, Plans, "New plan"): forProfile, src/core/profile.ts.
//

import { cookies } from "next/headers";
import { forProfile } from "@/core/profile";
import type { User } from "@/core/types";
import { getAuthUI } from "@/server/auth-ui";
import { isDemoUser } from "@/server/demo";
import { isDemo, siteProfile } from "@/server/env";
import { getContent } from "@/server/services/content";
import { listFeedback } from "@/server/services/community";
import { ADMIN_NAV, BADGE_CAP, DASHBOARD_ADMIN_LINK, DASHBOARD_NAV } from "@/lib/app-nav";
import { AppShell } from "./app-shell";
import type { CommandAction } from "./command-menu";

const ADMIN_ACTIONS: CommandAction[] = [
  { label: "New blog post", href: "/admin/posts/new?kind=post", icon: "posts", keywords: ["write", "article"] },
  { label: "New changelog entry", href: "/admin/posts/new?kind=changelog", icon: "posts", keywords: ["release", "update"] },
  { label: "New plan", href: "/admin/plans/new", icon: "plans", keywords: ["price", "pricing"] },
  { label: "Mint an agent key", href: "/admin/agents#mint", icon: "agents", keywords: ["mcp", "claude", "cursor"] },
];

/**
 * New feedback, for the admin badge: one row past BADGE_CAP is enough to show
 * "9+", so no render reads more than that. A failure shows no badge rather
 * than breaking the shell.
 */
async function newFeedbackCount(): Promise<number> {
  try {
    return (await listFeedback({ status: "new", limit: BADGE_CAP + 1 })).items.length;
  } catch (error) {
    console.error("[shell] could not count new feedback", error);
    return 0;
  }
}

export async function ProductShell({ kind, user, children }: { kind: "dashboard" | "admin"; user: User; children: React.ReactNode }) {
  const isAdmin = user.role === "admin";
  const [site, authUI, jar, fresh] = await Promise.all([
    getContent("site"),
    getAuthUI(),
    cookies(),
    isAdmin ? newFeedbackCount() : Promise.resolve(0),
  ]);
  const { SignOutButton } = authUI;
  const profile = siteProfile();
  const nav = forProfile(profile, kind === "admin" ? ADMIN_NAV : isAdmin ? [...DASHBOARD_NAV, DASHBOARD_ADMIN_LINK] : DASHBOARD_NAV);
  const badges = fresh ? { "/admin/feedback": fresh, ...(kind === "dashboard" ? { "/admin": fresh } : {}) } : undefined;
  const actions = isAdmin ? forProfile(profile, ADMIN_ACTIONS) : [];
  return (
    <AppShell
      nav={nav}
      brand={{ name: site.name, detail: kind === "admin" ? "Admin" : "Dashboard", href: kind === "admin" ? "/admin" : "/dashboard" }}
      root={kind === "admin" ? { label: "Admin", href: "/admin" } : { label: "Dashboard", href: "/dashboard" }}
      user={{ name: user.name, email: user.email }}
      badges={badges}
      actions={actions}
      signOut={<SignOutButton className="w-full justify-start" />}
      demo={isDemo()}
      readOnly={isDemoUser(user)}
      defaultOpen={jar.get("sidebar_state")?.value !== "false"}
    >
      {children}
    </AppShell>
  );
}
