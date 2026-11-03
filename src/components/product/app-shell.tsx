//
// The signed-in shell, shared by /dashboard and /admin: sidebar (a drawer on a
// phone), a top bar with the menu button, breadcrumb and scheme switch, the
// demo banner when there is no real database, the read-only strip for the
// demo admin (src/core/demo.ts), and the page. A record page names
// its breadcrumb leaf with <BreadcrumbLeaf> (the provider wraps the shell).
//
// Server component. The layouts pass plain data (nav lists, the user, badge
// counts) plus the auth adapter's sign-out button, rendered on the server.
// The sidebar's open/closed state comes from its cookie, so the first paint
// already has the person's choice.
//
// The shell mounts the one <Toaster> (sonner): <ActionForm>'s success toasts
// render here, and public pages never load it (src/app/layout.tsx).
//

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SchemeSwitch } from "@/components/theme/scheme-switch";
import { AppSidebar, type ShellUser } from "@/components/product/app-sidebar";
import { AppBreadcrumb, BreadcrumbLeafProvider } from "@/components/product/app-breadcrumb";
import { DemoBanner } from "@/components/product/demo-banner";
import { ReadOnlyBanner } from "@/components/product/read-only-banner";
import { Toaster } from "@/components/ui/sonner";
import type { CommandAction } from "@/components/product/command-menu";
import type { NavItem } from "@/lib/app-nav";
import { SkipLink } from "@/components/ui/skip-link";

export function AppShell({
  nav,
  brand,
  root,
  user,
  badges,
  actions,
  signOut,
  demo,
  readOnly = false,
  defaultOpen,
  children,
}: {
  nav: readonly NavItem[];
  brand: { name: string; detail: string; href: string };
  /** The breadcrumb's first crumb: "Dashboard" → /dashboard. */
  root: { label: string; href: string };
  user: ShellUser;
  badges?: Record<string, number>;
  actions?: CommandAction[];
  signOut: React.ReactNode;
  demo: boolean;
  /** The read-only demo admin is signed in: the "nothing saves" strip (src/core/demo.ts). */
  readOnly?: boolean;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <BreadcrumbLeafProvider>
        <SkipLink href="#content" />
        <AppSidebar nav={nav} brand={brand} user={user} badges={badges} actions={actions} signOut={signOut} settingsHref="/dashboard/settings" />
        <SidebarInset className="min-w-0 bg-bg">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/80 sm:px-6">
            <SidebarTrigger aria-label="Open the menu" className="md:hidden pointer-coarse:size-11" />
            <div className="min-w-0 flex-1">
              <AppBreadcrumb root={root} nav={nav} />
            </div>
            <SchemeSwitch />
          </header>
          {/* One strip, never two stacked: demo mode with the read-only demo admin is one combined note. */}
          {demo ? <DemoBanner readOnly={readOnly} /> : readOnly ? <ReadOnlyBanner /> : null}
          <div id="content" tabIndex={-1} className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </SidebarInset>
        <Toaster />
      </BreadcrumbLeafProvider>
    </SidebarProvider>
  );
}
