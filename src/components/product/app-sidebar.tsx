"use client";

//
// The product shell's sidebar: full height, neutral, its own collapse control
// and search (⌘K) at the top, a 56 px icon rail with tooltips, and who's
// signed in at the foot. Used by both shells (/dashboard and /admin) with a
// different nav list.
//
// Geometry (from the design system): one 12 px edge for the header, groups and
// footer, so the mark, every icon and the avatar share one centre line, which
// is the rail's centre too: nothing moves sideways when it collapses.
// On a phone it is a drawer, and choosing a place closes it.
//
// The places are a navigation landmark ("Admin" / "Dashboard"); the account
// menu at the foot sits outside it. A badge's count is part of its link's
// name ("Feedback, 3 new"); the visible pill and the rail's dot are decoration.
//

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { SidebarBrand } from "@/components/product/sidebar-brand";
import { CommandMenu, type CommandAction } from "@/components/product/command-menu";
import { UserMenu } from "@/components/product/user-menu";
import { NAV_ICONS } from "@/components/product/nav-icons";
import { BADGE_CAP, groupNav, placeOf, type NavItem } from "@/lib/app-nav";

const badgeText = (n: number) => (n > BADGE_CAP ? `${BADGE_CAP}+` : String(n));
const badgeWords = (n: number) => (n > BADGE_CAP ? `more than ${BADGE_CAP} new` : `${n} new`);

export interface ShellUser {
  name: string | null;
  email: string;
}

export function AppSidebar({
  nav,
  brand,
  user,
  badges,
  actions,
  signOut,
  settingsHref,
}: {
  nav: readonly NavItem[];
  brand: { name: string; detail: string; href: string };
  user: ShellUser;
  /** A count per nav href — only what is waiting on the person (new feedback). */
  badges?: Record<string, number>;
  /** Extra "do" commands for ⌘K ("New post"). */
  actions?: CommandAction[];
  /** The auth adapter's sign-out button, rendered on the server. */
  signOut: React.ReactNode;
  settingsHref: string;
}) {
  const path = usePathname();
  const here = placeOf(nav, path)?.href;
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center px-2 py-0 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:py-2">
        <SidebarBrand {...brand} search={<CommandMenu trigger="icon" nav={nav} actions={actions} onDone={close} />} />
      </SidebarHeader>
      <SidebarContent className="pt-2">
        <nav aria-label={brand.detail} className="flex flex-col">
          {groupNav(nav).map((g) => (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((item) => {
                    const Icon = NAV_ICONS[item.icon];
                    const badge = badges?.[item.href];
                    const active = item.href === here;
                    return (
                      <SidebarMenuItem key={item.href + item.label}>
                        <SidebarMenuButton
                          render={<Link href={item.href} aria-current={active ? "page" : undefined} onClick={close} />}
                          isActive={active}
                          tooltip={badge ? `${item.label} · ${badgeWords(badge)}` : item.label}
                          className="relative"
                        >
                          <Icon aria-hidden />
                          <span>{item.label}</span>
                          {badge ? <span className="sr-only">, {badgeWords(badge)}</span> : null}
                          {/* In the rail the count can't fit: a dot keeps the signal, the tooltip says the number. */}
                          {badge ? (
                            <span
                              aria-hidden
                              className="absolute top-1.5 left-[1.4rem] hidden size-2 rounded-full bg-warning ring-2 ring-bg group-data-[collapsible=icon]:block"
                            />
                          ) : null}
                        </SidebarMenuButton>
                        {badge ? (
                          <SidebarMenuBadge aria-hidden className="right-2 rounded-full bg-warning-soft px-2 text-badge-warning">
                            {badgeText(badge)}
                          </SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu name={user.name} email={user.email} settingsHref={settingsHref} signOut={signOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
