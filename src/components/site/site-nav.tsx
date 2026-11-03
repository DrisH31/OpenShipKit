"use client";

//
// The header's links (desktop) and the phone menu. Client only for two small
// enhancements: the current page is read from the URL (so it is right in the
// server HTML too — usePathname runs during SSR), and the phone menu closes
// itself after a client-side navigation, on Escape, and when focus or a tap
// leaves it (its opaque panel covers the page, so focus must never move on to
// links hidden under it: WCAG 2.4.11). The menu is a native <details>, so it
// opens and every link works with JavaScript off.
//

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { MenuIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavLink {
  label: string;
  href: string;
}

/** True when `href` is the page being shown (or a section of it, for /blog/…). Anchors never are. */
export function isCurrent(pathname: string, href: string): boolean {
  if (!href.startsWith("/") || href.includes("#")) return false;
  const path = href.split("?")[0];
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isExternal(href: string) {
  return /^https?:\/\//.test(href) || href.startsWith("mailto:");
}

/** Desktop links: ink-2, the current page in ink on a tonal pill. */
export function NavLinks({ links, className }: { links: NavLink[]; className?: string }) {
  const pathname = usePathname() ?? "/";
  return (
    <ul className={cn("flex items-center gap-1", className)}>
      {links.map((l) => {
        const current = isCurrent(pathname, l.href);
        return (
          <li key={`${l.href}-${l.label}`}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              {...(isExternal(l.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={cn(
                "inline-flex h-9 items-center rounded-full px-3.5 text-small font-semibold text-ink-2 transition-[color,background-color] duration-(--dur-hover) ease-out-quart hover:bg-tonal hover:text-ink focus-visible:outline-offset-[-2px]",
                current && "bg-tonal text-ink",
              )}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The phone menu: a <details> whose summary is the menu button. The panel drops
 * under the header as a full-width sheet. Escape, a navigation, tabbing out of
 * it and a tap outside it close it. The current page carries a bar at its
 * leading edge (a border, so it holds in forced colours), not colour alone.
 */
export function MobileMenu({ links, children }: { links: NavLink[]; children?: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const menu = useRef<HTMLDetailsElement>(null);

  // A client-side navigation keeps the layout mounted, so close the menu ourselves.
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    // Focus moving to something outside the menu (Tab past its last control, Shift+Tab
    // before the button) closes it, so the next stop is never under the panel.
    const onFocusOut = (e: FocusEvent) => {
      if (el.open && e.relatedTarget instanceof Node && !el.contains(e.relatedTarget)) el.open = false;
    };
    // A tap or click outside the menu closes it too, as any sheet does.
    const onPointerDown = (e: PointerEvent) => {
      if (el.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("keydown", onKey);
    el.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      el.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <details ref={menu} className="group/menu lg:hidden">
      <summary
        className="relative inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full text-ink transition-colors duration-(--dur-hover) hover:bg-tonal [&::-webkit-details-marker]:hidden"
        aria-label="Menu"
      >
        <MenuIcon aria-hidden className="size-5 group-open/menu:hidden" />
        <XIcon aria-hidden className="hidden size-5 group-open/menu:block" />
      </summary>
      <div className="absolute inset-x-0 top-full z-(--z-overlay) border-b border-line-strong bg-bg px-gutter pt-2 pb-6 shadow-overlay">
        <nav aria-label="Main">
          <ul className="flex flex-col">
            {links.map((l) => {
              const current = isCurrent(pathname, l.href);
              return (
                <li key={`${l.href}-${l.label}`} className="border-b border-line">
                  <Link
                    href={l.href}
                    aria-current={current ? "page" : undefined}
                    onClick={() => {
                      if (menu.current) menu.current.open = false;
                    }}
                    className={cn(
                      "relative flex min-h-12 items-center text-body font-semibold text-ink-2 focus-visible:outline-offset-[-2px]",
                      // The current page: ink, and a bar in the gutter beside it (a border, so forced colours keep it).
                      current && "text-ink before:absolute before:inset-y-3 before:-left-3 before:border-l-[3px] before:border-ink before:content-['']",
                    )}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {/* the header shows these itself from 640 px */}
        {children && <div className="mt-5 flex flex-col gap-3 sm:hidden">{children}</div>}
      </div>
    </details>
  );
}
