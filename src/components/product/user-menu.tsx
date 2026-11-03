"use client";

//
// Who's signed in, at the foot of the sidebar: name and email, light / dark /
// system, settings, and the way out. In the rail it shrinks to the avatar; the
// menu opens to the right. The button's accessible name is its visible text
// (name, email) plus "account menu", so a voice user can say what they see
// (WCAG 2.5.3); the email is ink-2, which keeps 4.5:1 on the hover/open fill.
//
// Sign-out is the auth adapter's own button (a form posting to its action),
// passed in from the server layout. The form is kept OUTSIDE the popup,
// hidden, so closing the menu can't unmount it; the menu's "Sign out" is a
// real menu item (reached with the arrow keys, listed by screen readers) that
// submits that form.
//

import { useRef } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ChevronsUpDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/** "Ada Lovelace" → "AL"; no name → the email's first letter. */
export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (name?.trim() ? parts.slice(0, 2) : parts.slice(0, 1)).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

export function UserMenu({
  name,
  email,
  settingsHref,
  signOut,
}: {
  name: string | null;
  email: string;
  settingsHref: string;
  signOut: React.ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const signOutHolder = useRef<HTMLDivElement>(null);
  const shown = name?.trim() || email;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={shown} />}>
            <Avatar className="size-8 rounded-md">
              <AvatarFallback className="rounded-md text-caption font-semibold">{initialsOf(name, email)}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-small font-semibold">{shown}</span>
              {name?.trim() ? <span className="truncate text-caption text-ink-2">{email}</span> : null}
              <span className="sr-only">, account menu</span>
            </span>
            <ChevronsUpDownIcon className="ml-auto size-4 text-ink-faint" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="min-w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col">
                <span className="truncate text-small font-semibold text-ink">{shown}</span>
                {name?.trim() ? <span className="truncate text-caption font-normal text-ink-3">{email}</span> : null}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-caption font-normal text-ink-3">Appearance</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
                <DropdownMenuRadioItem value="light">
                  <SunIcon aria-hidden /> Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <MoonIcon aria-hidden /> Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <MonitorIcon aria-hidden /> System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href={settingsHref} />}>
              <SettingsIcon aria-hidden /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOutHolder.current?.querySelector("form")?.requestSubmit()}>
              <LogOutIcon aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div ref={signOutHolder} hidden>
          {signOut}
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
