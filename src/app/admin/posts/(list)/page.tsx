//
// /admin/posts — blog posts, changelog entries and pages, one kind at a time
// (?kind=), filterable by status (?status=) and searchable (?q=). Newest
// first; "Older" follows the DataStore's cursor. A bad cursor is a 400 from
// the store, shown as "start over" rather than a crash (listPage).
//

import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import type { PostKind, PostStatus } from "@/core/types";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { ExpiredPage, FilterTabs, NextPageLink, SearchForm, hrefWith, listPage } from "@/components/admin/filter-bar";
import { LinkPending } from "@/components/product/link-pending";
import { formatDate } from "@/lib/format";
import { POST_KIND, POST_STATUS } from "@/lib/status";
import { requireAdmin } from "@/server/session";
import { listPosts } from "@/server/services/posts";
import { featureOn } from "@/server/profile";
import { defaultPostKind } from "../list-href";

export const metadata: Metadata = { title: "Posts" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function PostsPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const sp = await searchParams;
  // With the blog switched off the list opens on the changelog (blog posts are still a tab: to unpublish or delete).
  const asked = one(sp.kind);
  const kind: PostKind = asked === "changelog" || asked === "page" || asked === "post" ? asked : defaultPostKind();
  const status: PostStatus | undefined = one(sp.status) === "draft" ? "draft" : one(sp.status) === "published" ? "published" : undefined;
  const q = one(sp.q)?.trim().slice(0, 100) || undefined;
  const cursor = one(sp.cursor) ?? null;

  const page = await listPage(() => listPosts({ kind, status, search: q, cursor, limit: 25 }));

  const word = POST_KIND[kind];
  // The default kind goes unsaid in links; with the blog off the default is the changelog, so "post" is said.
  const defaultKind: PostKind = defaultPostKind();
  const base = { kind: kind === defaultKind ? undefined : kind, status, q };
  // OPENSHIPKIT_WITHOUT=blog: existing blog posts stay listed (to unpublish or delete), no new ones.
  const canWrite = kind !== "post" || featureOn("blog");

  return (
    <>
      <PageHeader
        title="Posts"
        answer="Everything long-form: the blog, the changelog and static pages like privacy and terms. Drafts stay off the site until you publish."
        action={
          canWrite ? (
            <Link href={`/admin/posts/new?kind=${kind}`} className={buttonVariants({ size: "sm" })}>
              <PlusIcon aria-hidden /> New {word.label.toLowerCase()}
            </Link>
          ) : undefined
        }
      />
      {sp.deleted ? (
        <p role="status" className="text-small text-positive">
          Deleted. You can bring it back from the audit log.
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <FilterTabs
          label="Kind"
          options={(["post", "changelog", "page"] as const).map((k) => ({
            href: hrefWith("/admin/posts", { kind: k === defaultKind ? undefined : k, status }),
            label: POST_KIND[k].plural,
            active: k === kind,
          }))}
        />
        <FilterTabs
          label="Status"
          options={[
            { href: hrefWith("/admin/posts", { ...base, status: undefined }), label: "All", active: !status },
            { href: hrefWith("/admin/posts", { ...base, status: "draft" }), label: "Drafts", active: status === "draft" },
            { href: hrefWith("/admin/posts", { ...base, status: "published" }), label: "Published", active: status === "published" },
          ]}
        />
      </div>
      <SearchForm action="/admin/posts" value={q} placeholder={`Search ${word.plural.toLowerCase()}`} keep={{ kind: base.kind, status }} />

      {!page ? (
        <ExpiredPage href={hrefWith("/admin/posts", base)} />
      ) : page.items.length === 0 ? (
        q || status ? (
          <EmptyState kind="no-results" title="Nothing matches" body={`No ${word.plural.toLowerCase()} ${status ? `that are ${POST_STATUS[status].label.toLowerCase()} ` : ""}${q ? `match “${q}”` : ""}.`} action={<Link href={hrefWith("/admin/posts", { kind: base.kind })} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
        ) : (
          <EmptyState
            title={`No ${word.plural.toLowerCase()} yet`}
            body={
              kind === "page"
                ? "Pages are for things like privacy, terms and about. They live at /legal/<address>."
                : canWrite
                  ? `Write the first one. It stays a draft until you publish it.`
                  : "The blog is switched off on this site (OPENSHIPKIT_WITHOUT=blog)."
            }
            action={canWrite ? <Link href={`/admin/posts/new?kind=${kind}`} className={buttonVariants({ size: "sm" })}>New {word.label.toLowerCase()}</Link> : undefined}
          />
        )
      ) : (
        <>
          <div className="rounded-xl border border-line bg-card">
            <Table label="Posts">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Published</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[28rem] px-4 py-3 whitespace-normal">
                      <Link href={`/admin/posts/${p.id}`} className="font-semibold text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink focus-visible:decoration-ink">
                        {p.title}
                        <LinkPending className="ml-1.5 align-[-0.125em]" />
                      </Link>
                      {/* Wraps anywhere rather than truncating: an auto-layout cell can't clip, so a long slug would set the column's width and push Status off a phone. */}
                      <span className="block font-mono text-caption text-ink-3 [overflow-wrap:anywhere]">
                        {word.publicPath}/{p.slug}
                      </span>
                    </TableCell>
                    <TableCell className="w-px whitespace-nowrap">
                      <span className="flex flex-wrap gap-1.5">
                        <StatusBadge label={POST_STATUS[p.status].label} tone={POST_STATUS[p.status].tone} />
                        {/* Unlisted: live (if published) but off the lists. Pages have no list. */}
                        {p.listed || p.kind === "page" ? null : <StatusBadge label="Unlisted" tone="neutral" />}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{p.publishedAt ? formatDate(p.publishedAt) : "—"}</TableCell>
                    <TableCell className="hidden px-4 sm:table-cell">{formatDate(p.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <NextPageLink href={page.nextCursor ? hrefWith("/admin/posts", { ...base, cursor: page.nextCursor }) : null} />
        </>
      )}
    </>
  );
}
