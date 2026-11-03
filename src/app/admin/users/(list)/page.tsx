//
// /admin/users — everyone with an account, newest first: search by email or
// name (?q=), filter admins (?role=admin), page with "Older" (?cursor=). The
// read-only demo admin sees other people's emails and names masked, and no
// search (src/shared/privacy-mask.ts).
//

import type { Metadata } from "next";
import Link from "next/link";
import type { Role } from "@/core/types";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { breakableEmail } from "@/components/product/copy-value";
import { ExpiredPage, FilterTabs, NextPageLink, SearchForm, hrefWith, listPage } from "@/components/admin/filter-bar";
import { LinkPending } from "@/components/product/link-pending";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";
import { showEmail, showName } from "@/shared/privacy-mask";
import { privacyLens } from "@/server/demo";
import { requireAdmin } from "@/server/session";
import { listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Users" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdmin();
  const lens = privacyLens(me);
  const sp = await searchParams;
  // The read-only demo admin sees addresses masked, so search is off for it: a match on an exact
  // address would tell a visitor that person has an account (src/shared/privacy-mask.ts).
  const q = lens.masking ? undefined : one(sp.q)?.trim().slice(0, 100) || undefined;
  const role: Role | undefined = one(sp.role) === "admin" ? "admin" : undefined;
  const cursor = one(sp.cursor) ?? null;
  const now = new Date();

  const page = await listPage(() => listUsers({ search: q, role, cursor, limit: 50 }));

  return (
    <>
      <PageHeader title="Users" answer="Everyone who has signed up. Open someone to change their role, ban them, or see what they pay for." />
      {sp.deleted ? (
        <p role="status" className="text-small text-positive">
          The user is deleted, with their sign-in methods and sessions.
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <SearchForm action="/admin/users" value={q} placeholder="Search by email or name" keep={{ role }} label="Search users" />
          {lens.masking ? <p className="text-caption text-ink-3">Search is off in the read-only demo, so it can’t be used to look up someone’s address.</p> : null}
        </div>
        <FilterTabs
          label="Role"
          options={[
            { href: hrefWith("/admin/users", { q }), label: "Everyone", active: !role },
            { href: hrefWith("/admin/users", { q, role: "admin" }), label: "Admins", active: role === "admin" },
          ]}
        />
      </div>
      {!page ? (
        <ExpiredPage href={hrefWith("/admin/users", { q, role })} />
      ) : page.items.length === 0 ? (
        q || role ? (
          <EmptyState kind="no-results" title="Nobody matches" body={q ? `No one’s email or name contains “${q}”.` : "No admins match."} action={<Link href="/admin/users" className={buttonVariants({ variant: "outline", size: "sm" })}>Clear search</Link>} />
        ) : (
          <EmptyState title="No users yet" body="People appear here after they sign up. Emails in ADMIN_EMAILS become admins on their first sign-in." />
        )
      ) : (
        <>
          <div className="rounded-xl border border-line bg-card">
            <Table label="Users">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="hidden px-4 md:table-cell">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-[22rem] px-4 py-3 whitespace-normal">
                      <Link href={`/admin/users/${u.id}`} className="font-semibold text-ink underline decoration-transparent underline-offset-4 [overflow-wrap:anywhere] hover:decoration-ink focus-visible:decoration-ink">
                        {breakableEmail(showEmail(lens, u.email))}
                        <LinkPending className="ml-1.5 align-[-0.125em]" />
                      </Link>
                      {u.name || u.id === me.id ? (
                        <span className="block text-caption text-ink-3">
                          {u.name ? showName(lens, u.name, u.email) : null}
                          {u.id === me.id ? (u.name ? " · you" : "You") : ""}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge label={u.role === "admin" ? "Admin" : "User"} tone={u.role === "admin" ? "info" : "neutral"} />
                        {u.banned ? <StatusBadge label="Banned" tone="danger" /> : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(u.createdAt)}</TableCell>
                    <TableCell className="hidden px-4 md:table-cell">
                      {u.lastSeenAt ? <time dateTime={u.lastSeenAt} title={formatDateTime(u.lastSeenAt)}>{relativeTime(u.lastSeenAt, now)}</time> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <NextPageLink href={page.nextCursor ? hrefWith("/admin/users", { q, role, cursor: page.nextCursor }) : null} />
        </>
      )}
    </>
  );
}
