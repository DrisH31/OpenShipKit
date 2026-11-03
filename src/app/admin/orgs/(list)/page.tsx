//
// /admin/orgs — every organisation on the site (OPENSHIPKIT_TENANCY=org), for
// the site admin: name, address name, members, created. Read-only: what happens
// inside an organisation is its owners' business, and the site admin is not a
// member. 404 while teams are off.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { ExpiredPage, NextPageLink, SearchForm, hrefWith, listPage } from "@/components/admin/filter-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { adminListOrgs, teamsEnabled } from "@/server/services/orgs";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Organisations" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function OrgsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  if (!teamsEnabled()) notFound();
  const sp = await searchParams;
  const q = one(sp.q)?.trim().slice(0, 100) || undefined;
  const cursor = one(sp.cursor) ?? null;
  const page = await listPage(() => adminListOrgs({ search: q, cursor, limit: 50 }));

  return (
    <>
      <PageHeader title="Organisations" answer="Every team on the site, with how many people are in each. Owners manage their own organisation from its Team page." />
      <SearchForm action="/admin/orgs" value={q} placeholder="Search by name" label="Search organisations" />
      {!page ? (
        <ExpiredPage href={hrefWith("/admin/orgs", { q })} />
      ) : page.items.length === 0 ? (
        <EmptyState title={q ? "No organisation matches" : "No organisations yet"} body={q ? `Nothing named like “${q}”.` : "People create them from Team in their dashboard."} />
      ) : (
        <>
          <div className="rounded-xl border border-line bg-card">
            <Table label="Organisations">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Organisation</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="px-4 py-3">
                      <Link href={`/admin/orgs/${o.id}`} className="font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
                        {o.name}
                      </Link>
                      <span className="block text-caption text-ink-3">{o.slug}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">{o.members}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatDate(o.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <NextPageLink href={page.nextCursor ? hrefWith("/admin/orgs", { q, cursor: page.nextCursor }) : null} />
        </>
      )}
    </>
  );
}
