"use client";

//
// A record that isn't there (a deleted post, a mistyped user id), shown INSIDE
// the product shell by src/app/{admin,dashboard}/not-found.tsx, so the person
// keeps the sidebar and gets a way back to the list they came from — never the
// marketing 404. The place comes from the URL and the same nav list as the
// sidebar; in the admin, a record that has an audit trail links to it (where a
// deleted post or plan can be brought back).
//

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { BreadcrumbLeaf } from "@/components/product/app-breadcrumb";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { placeOf, type NavItem } from "@/lib/app-nav";

/** The audit entity for a record under each admin place, for "See its history". */
const AUDITED: Record<string, string> = {
  "/admin/posts": "post",
  "/admin/plans": "plan",
  "/admin/users": "user",
  "/admin/content": "content",
};

export function RecordNotFound({ nav, root }: { nav: readonly NavItem[]; root: { label: string; href: string } }) {
  const path = usePathname();
  const place = placeOf(nav, path);
  const back = place && place.href !== path ? place : root;
  const entity = place ? AUDITED[place.href] : undefined;
  const id = place && entity ? decodeURIComponent(path.slice(place.href.length + 1).split("/")[0] ?? "") : "";
  return (
    <>
      <BreadcrumbLeaf name="Not found" />
      <PageHeader title="Not found" />
      <EmptyState
        kind="no-results"
        title="That record doesn’t exist"
        body="It may have been deleted, or the link is mistyped."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={back.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to {back.label}
            </Link>
            {entity && id ? (
              <Link href={`/admin/audit?${new URLSearchParams({ entity, entityId: id })}`} className={buttonVariants({ variant: "link", size: "sm" })}>
                See its history in the audit log
              </Link>
            ) : null}
          </div>
        }
      />
    </>
  );
}
