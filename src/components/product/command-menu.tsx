"use client";

//
// ⌘K (Ctrl+K off Apple computers) from anywhere in the product: every place in the shell's nav, plus a few
// "do" commands the layout passes in ("New post"). Opens instantly (no
// animation): it is summoned from the keyboard many times a day.
//
//   trigger="icon"  one search icon, for the sidebar's top row (the shell)
//   trigger="bar"   a labelled button with its shortcut, for a page's own bar
//
// `onDone` runs after a choice, so a phone drawer can close behind it.
//
// Only the trigger and the shortcut load with the page. The palette
// (./command-palette: cmdk and its dialog stack) loads on the first ⌘K or
// click, and is preloaded when the pointer or focus reaches the trigger.
//

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type NavIcon, type NavItem } from "@/lib/app-nav";
import { useModKey } from "@/hooks/use-mod-key";
import { cn } from "@/lib/utils";

const loadPalette = () => import("./command-palette");
const CommandPalette = dynamic(() => loadPalette().then((m) => m.CommandPalette), { ssr: false });
/** Warm the palette's chunk before it is asked for (hover or focus on the trigger). */
const preload = () => void loadPalette();

/** A command that is an action, not a place: "New post" → /admin/posts/new?kind=post. */
export interface CommandAction {
  label: string;
  href: string;
  icon?: NavIcon;
  /** Extra words the search matches ("write", "article"). */
  keywords?: string[];
}

export function CommandMenu({
  nav,
  actions = [],
  trigger = "bar",
  onDone,
  className,
}: {
  nav: readonly NavItem[];
  actions?: CommandAction[];
  trigger?: "bar" | "icon";
  onDone?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Mounted from the first open on, so closing keeps it (and its exit) in place.
  const [wanted, setWanted] = useState(false);
  const router = useRouter();
  const mod = useModKey();
  const show = () => {
    setWanted(true);
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setWanted(true);
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    onDone?.();
    router.push(href);
  };

  return (
    <>
      {trigger === "icon" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={show}
                onPointerEnter={preload}
                onFocus={preload}
                aria-label="Search pages and actions"
                aria-keyshortcuts="Meta+K Control+K"
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-sidebar-accent hover:text-ink pointer-coarse:size-11",
                  className,
                )}
              />
            }
          >
            <SearchIcon aria-hidden className="size-[1.125rem]" />
          </TooltipTrigger>
          <TooltipContent side="right">
            Search
            <KbdGroup className="ml-1">
              <Kbd>{mod}</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button variant="outline" size="sm" onClick={show} onPointerEnter={preload} onFocus={preload} aria-keyshortcuts="Meta+K Control+K" className={cn("gap-3 text-ink-2", className)}>
          Search or run…
          <KbdGroup>
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
      )}
      {wanted ? <CommandPalette open={open} onOpenChange={setOpen} nav={nav} actions={actions} onChoose={go} /> : null}
    </>
  );
}
