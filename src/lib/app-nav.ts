//
// The product's places, in one list per shell: the sidebar, the breadcrumb and
// the command menu (⌘K) all read these, so a page is named the same way
// everywhere. The order never changes (people navigate by position).
//
// Icons are named by key, not by component: these lists cross from server
// layouts into client components, and only plain data can.
//
// These are the saas lists. Under OPENSHIPKIT_PROFILE=site the shell
// (src/components/product/product-shell.tsx) passes them through forProfile
// (src/core/profile.ts), which drops Billing and Plans; don't filter here.
//

export type NavIcon =
  | "home"
  | "billing"
  | "feedback"
  | "team"
  | "settings"
  | "admin"
  | "overview"
  | "users"
  | "content"
  | "posts"
  | "media"
  | "plans"
  | "subscribers"
  | "agents"
  | "jobs"
  | "audit"
  | "back";

export interface NavItem {
  group: string;
  href: string;
  label: string;
  icon: NavIcon;
  /** Matches only the exact path (a section's home, so /admin doesn't light up on /admin/users). */
  exact?: boolean;
}

/** The signed-in product. "Admin" is appended for admins by the layout. */
export const DASHBOARD_NAV: readonly NavItem[] = [
  { group: "Product", href: "/dashboard", label: "Home", icon: "home", exact: true },
  { group: "Product", href: "/dashboard/billing", label: "Billing", icon: "billing" },
  { group: "Product", href: "/dashboard/feedback", label: "Feedback", icon: "feedback" },
  { group: "Account", href: "/dashboard/team", label: "Team", icon: "team" },
  { group: "Account", href: "/dashboard/settings", label: "Settings", icon: "settings" },
];

export const DASHBOARD_ADMIN_LINK: NavItem = { group: "Account", href: "/admin", label: "Admin", icon: "admin" };

/** A nav badge shows counts up to this; past it, "9+". The shell reads one row past it to know. */
export const BADGE_CAP = 9;

/** The admin panel. Grouped by job: the site, the business, the machinery. */
export const ADMIN_NAV: readonly NavItem[] = [
  { group: "Admin", href: "/admin", label: "Overview", icon: "overview", exact: true },
  { group: "Site", href: "/admin/content", label: "Content", icon: "content" },
  { group: "Site", href: "/admin/posts", label: "Posts", icon: "posts" },
  { group: "Site", href: "/admin/media", label: "Media", icon: "media" },
  { group: "Business", href: "/admin/users", label: "Users", icon: "users" },
  { group: "Business", href: "/admin/plans", label: "Plans", icon: "plans" },
  { group: "Business", href: "/admin/feedback", label: "Feedback", icon: "feedback" },
  { group: "Business", href: "/admin/subscribers", label: "Subscribers", icon: "subscribers" },
  { group: "System", href: "/admin/agents", label: "Agent keys", icon: "agents" },
  { group: "System", href: "/admin/jobs", label: "Jobs", icon: "jobs" },
  { group: "System", href: "/admin/audit", label: "Audit log", icon: "audit" },
  { group: "System", href: "/dashboard", label: "Back to dashboard", icon: "back", exact: true },
];

/** The nav entry a path belongs to: /admin/users/123 → Users. The longest matching href wins. */
export function placeOf(nav: readonly NavItem[], path: string): NavItem | undefined {
  return [...nav]
    .sort((a, b) => b.href.length - a.href.length)
    .find((n) => path === n.href || (!n.exact && path.startsWith(`${n.href}/`)));
}

/** The nav as groups, in first-seen order. */
export function groupNav(nav: readonly NavItem[]): { label: string; items: NavItem[] }[] {
  const labels = [...new Set(nav.map((n) => n.group))];
  return labels.map((label) => ({ label, items: nav.filter((n) => n.group === label) }));
}
