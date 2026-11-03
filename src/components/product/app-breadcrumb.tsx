"use client";

//
// Where you are, in the shell's top bar: the shell's name, the place (from the
// same nav list as the sidebar) and one level deeper on a record or sub-page.
// The place links back; the last crumb is the page. Record ids are never shown
// raw: a record page names its leaf with <BreadcrumbLeaf name="Welcome" /> (the
// post's title, the user's email), and "Details" stands in until it mounts.
// <BreadcrumbLeafProvider> (in AppShell) carries the name from the page up to
// the top bar.
//

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { placeOf, type NavItem } from "@/lib/app-nav";

/** Long names are cut so the bar stays one line on a phone; the page's H1 has the whole name. */
const LEAF_MAX = 40;

type Leaf = { path: string; name: string } | null;
const LeafCtx = createContext<{ leaf: Leaf; setLeaf: (leaf: Leaf) => void }>({ leaf: null, setLeaf: () => {} });

export function BreadcrumbLeafProvider({ children }: { children: React.ReactNode }) {
  const [leaf, setLeaf] = useState<Leaf>(null);
  return <LeafCtx.Provider value={{ leaf, setLeaf }}>{children}</LeafCtx.Provider>;
}

/** Name this page's last crumb (a record's title or email). Renders nothing itself. */
export function BreadcrumbLeaf({ name }: { name: string }) {
  const { setLeaf } = useContext(LeafCtx);
  const path = usePathname();
  useEffect(() => {
    const trimmed = name.trim();
    setLeaf(trimmed ? { path, name: trimmed.length > LEAF_MAX ? `${trimmed.slice(0, LEAF_MAX - 1).trimEnd()}…` : trimmed } : null);
    return () => setLeaf(null);
  }, [name, path, setLeaf]);
  return null;
}

function leafFor(place: NavItem, path: string): string | null {
  if (path === place.href) return null;
  const rest = path.slice(place.href.length + 1).split("/")[0] ?? "";
  if (!rest) return null;
  if (rest === "new") return `New ${place.label.toLowerCase().replace(/s$/, "")}`;
  if (rest === "export") return "Export";
  // An id or a key: name it generically; the page's H1 says which one.
  return "Details";
}

export function AppBreadcrumb({ root, nav }: { root: { label: string; href: string }; nav: readonly NavItem[] }) {
  const path = usePathname();
  const named = useContext(LeafCtx).leaf;
  const place = placeOf(nav, path);
  const generic = place ? leafFor(place, path) : null;
  // A name set by the page wins, but only on the page that set it (never a stale one after navigating).
  const leaf = generic && named?.path === path ? named.name : generic;
  const atRoot = !place || place.href === root.href;
  return (
    <Breadcrumb>
      {/* One line: a long record name is cut with an ellipsis (its full name is the H1), never wrapped. */}
      <BreadcrumbList className="flex-nowrap">
        {atRoot && !leaf ? (
          <BreadcrumbItem>
            <BreadcrumbPage>{place?.label ?? root.label}</BreadcrumbPage>
          </BreadcrumbItem>
        ) : (
          <>
            <BreadcrumbItem className="hidden sm:inline-flex">
              <BreadcrumbLink render={<Link href={root.href} />}>{root.label}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:block" />
            {place && leaf ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link href={place.href} />}>{place.label}</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">{leaf}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage>{place?.label ?? root.label}</BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
