"use client";

//
// The ⌘K palette itself: the dialog with the search box and the list of
// places and actions. Loaded on demand by <CommandMenu> (next/dynamic), on
// the first ⌘K or click, and preloaded when the pointer or focus reaches the
// trigger: cmdk brings its own dialog stack (Radix Dialog, focus scope,
// remove-scroll), which no signed-in page should parse before anyone asks
// for the palette.
//

import { PlusIcon } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NAV_ICONS } from "@/components/product/nav-icons";
import { groupNav, type NavItem } from "@/lib/app-nav";
import type { CommandAction } from "@/components/product/command-menu";

export function CommandPalette({
  open,
  onOpenChange,
  nav,
  actions,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: readonly NavItem[];
  actions: readonly CommandAction[];
  onChoose: (href: string) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Commands" description="Search pages and actions">
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches. Try a page name, like “billing”.</CommandEmpty>
        {actions.length ? (
          <CommandGroup heading="Actions">
            {actions.map((a) => {
              const Icon = a.icon ? NAV_ICONS[a.icon] : PlusIcon;
              return (
                <CommandItem key={a.href} keywords={a.keywords} onSelect={() => onChoose(a.href)}>
                  <Icon aria-hidden /> {a.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {groupNav(nav).map((g) => (
          <CommandGroup key={g.label} heading={g.label}>
            {g.items.map((n) => {
              const Icon = NAV_ICONS[n.icon];
              return (
                <CommandItem key={n.href + n.label} keywords={[n.group]} onSelect={() => onChoose(n.href)}>
                  <Icon aria-hidden /> {n.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
