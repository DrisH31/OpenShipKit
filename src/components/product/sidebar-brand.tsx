"use client";

//
// The sidebar's own header: the product's mark and name, search (⌘K / Ctrl+K) and the
// collapse control live HERE, not in the page bar.
//  - Expanded: mark + name + detail line, then search and collapse at the right.
//  - Collapsed to the rail: only the mark, with search below it; on hover or
//    keyboard focus the mark turns into the expand icon, and a click expands.
//  - On a phone the sidebar is a drawer, and the same button closes it.
// The mark is the product's (src/components/site/logo.tsx), so a template user's
// rebrand reaches the app shell with no edit here.
//

import Link from "next/link";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { LogoMark } from "@/components/site/logo";
import { useModKey } from "@/hooks/use-mod-key";

export function SidebarBrand({ name, detail, href, search }: { name: string; detail: string; href: string; search?: React.ReactNode }) {
  const { state, isMobile, toggleSidebar } = useSidebar();
  const mod = useModKey();
  const collapsed = state === "collapsed" && !isMobile;

  const mark = (
    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface text-ink">
      <LogoMark className="size-5" />
    </span>
  );

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Expand the sidebar"
                aria-keyshortcuts="Meta+B Control+B"
                className="group/brand relative mx-auto grid size-10 place-items-center rounded-lg hover:bg-sidebar-accent"
              />
            }
          >
            <span className="transition-opacity duration-(--dur-pop) ease-out-quart group-hover/brand:opacity-0 group-focus-visible/brand:opacity-0 pointer-coarse:opacity-0">
              {mark}
            </span>
            <PanelLeftOpenIcon
              aria-hidden
              className="absolute size-[1.125rem] text-ink opacity-0 transition-opacity duration-(--dur-pop) ease-out-quart group-hover/brand:opacity-100 group-focus-visible/brand:opacity-100 pointer-coarse:opacity-100"
            />
          </TooltipTrigger>
          <TooltipContent side="right">
            Expand{" "}
            <KbdGroup className="ml-1">
              <Kbd>{mod}</Kbd>
              <Kbd>B</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
        {search}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-sidebar-accent">
        {mark}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-small font-semibold text-ink">{name}</span>
          <span className="truncate text-caption text-ink-3">{detail}</span>
        </span>
      </Link>
      {search}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={isMobile ? "Close the menu" : "Collapse the sidebar"}
              aria-keyshortcuts="Meta+B Control+B"
              className="grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-sidebar-accent hover:text-ink pointer-coarse:size-11"
            />
          }
        >
          <PanelLeftCloseIcon aria-hidden className="size-[1.125rem]" />
        </TooltipTrigger>
        <TooltipContent side="right">
          Collapse{" "}
          <KbdGroup className="ml-1">
            <Kbd>{mod}</Kbd>
            <Kbd>B</Kbd>
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
