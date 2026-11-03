import "server-only";

//
// OPENSHIPKIT SHOWCASE — the feature cards' pictures: one small, real moment
// of the product per feature, so the grid shows what each part does instead of
// an icon and a promise (DESIGN.md: features was the page's most generic
// section). Keyed by the feature's icon name in the default content
// (src/content/defaults.ts); a feature with another icon gets no picture.
//
// Every word in them is the product's own: the admin's nav (ADMIN_NAV), the
// tables in the Drizzle schema, the webhook route, the feeds and files the SEO
// layer serves, the posts' statuses. Sample values (an address, a title) are
// marked as samples by being obviously so (you@example.com). Decorative to
// assistive tech (aria-hidden, nothing focusable): the card's own title and
// sentence say the same thing in words.
//
// Rendered only on the showcase (features.tsx): on a renamed site the same
// icons describe someone else's product.
//

import { CircleCheckIcon, CircleMinusIcon, CornerDownRightIcon } from "lucide-react";
import { CodeSnippet } from "@/components/marketing/code-snippet";
import { NAV_ICONS } from "@/components/product/nav-icons";
import { ADMIN_NAV, DASHBOARD_NAV } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

/** A small window inside the card's well: the card colour, a hairline, and a title strip. */
function Window({ title, className, children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line-strong bg-card shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]", className)}>
      {title && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-caption text-ink-3">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => <span key={i} className="size-1.5 rounded-full bg-line-strong" />)}
          </span>
          <span className="truncate">{title}</span>
        </div>
      )}
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-ink-2">{label}</span>
      <span className="flex h-8 items-center rounded-md border border-field px-2.5 text-caption text-ink">{value}</span>
    </div>
  );
}

function SignIn() {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
      <Window title="/sign-in">
        <div className="flex flex-col gap-2.5 p-3">
          <Field label="Email" value="you@example.com" />
          <Field label="Password" value="••••••••••" />
          <span className="flex h-8 items-center justify-center rounded-full bg-ink text-caption font-semibold text-bg">Sign in</span>
          <span className="text-center text-caption text-ink-2">or email me a sign-in link</span>
        </div>
      </Window>
      {/* Set lower than the form so the eye reads form → row; the caption says it's cause and effect. */}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 pl-1 text-caption text-ink-3">
          <CornerDownRightIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
          The row it writes
        </span>
        <Window title="your postgres">
          <CodeSnippet
            lang="sql"
            className="px-3 py-2"
            code={"select email, two_factor_enabled\n  from auth_user;\n-- you@example.com | t"}
          />
        </Window>
      </div>
    </div>
  );
}

const EVENTS = [
  { ok: true, what: "order.paid", result: "signature verified · Pro granted", when: "just now" },
  { ok: true, what: "subscription.updated", result: "signature verified · renews", when: "2 h ago" },
  { ok: false, what: "checkout redirect", result: "ignored · a redirect grants nothing", when: "2 h ago" },
];

function Billing() {
  return (
    <Window title="POST /api/billing/webhook">
      <ul className="divide-y divide-line">
        {EVENTS.map((e) => {
          const Icon = e.ok ? CircleCheckIcon : CircleMinusIcon;
          return (
            <li key={e.what} className="flex items-start gap-2.5 px-3 py-2">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", e.ok ? "text-positive" : "text-ink-3")} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-caption text-ink">{e.what}</span>
                <span className="truncate text-caption text-ink-2">{e.result}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Window>
  );
}

function Admin() {
  const admin = ADMIN_NAV.filter((n) => n.icon !== "back" && n.icon !== "overview");
  const users = DASHBOARD_NAV.filter((n) => n.icon !== "home");
  return (
    <div className="grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] gap-3">
      <Window title="/dashboard">
        <ul className="flex flex-col gap-0.5 p-2">
          {users.map((n) => {
            const Icon = NAV_ICONS[n.icon];
            return (
              <li key={n.href} className="flex h-7 items-center gap-2 rounded-md px-2 text-caption text-ink-2 first:bg-tonal first:font-semibold first:text-ink">
                <Icon className="size-3.5 shrink-0 text-ink-3" />
                <span className="truncate">{n.label}</span>
              </li>
            );
          })}
        </ul>
      </Window>
      <Window title="/admin">
        <ul className="grid grid-cols-1 gap-0.5 p-2 sm:grid-cols-2">
          {admin.map((n) => {
            const Icon = NAV_ICONS[n.icon];
            return (
              <li key={n.href} className="flex h-7 items-center gap-2 px-2 text-caption text-ink-2">
                <Icon className="size-3.5 shrink-0 text-ink-3" />
                <span className="truncate">{n.label}</span>
              </li>
            );
          })}
        </ul>
      </Window>
    </div>
  );
}

function Data() {
  return (
    <Window title="your server · terminal">
      <CodeSnippet
        lang="bash"
        className="px-3 py-2.5"
        code={[
          "$ ./deploy/backups/backup.sh",
          "# pg_dump of every table, and the uploads beside it",
          "$ docker compose run --rm migrate",
          "  applied 0004_post_listed",
          "$ docker compose exec postgres psql -U openshipkit openshipkit",
          "openshipkit=# select count(*) from auth_user;",
        ].join("\n")}
      />
    </Window>
  );
}

const FILES = ["/sitemap.xml", "/blog/rss.xml", "/llms.txt", "/opengraph-image"];

function Seo() {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-1.5">
        {FILES.map((f) => (
          <li key={f} className="inline-flex h-7 items-center rounded-full border border-line-strong bg-card px-2.5 font-mono text-caption text-ink-2">
            {f}
          </li>
        ))}
      </ul>
      <Window title="view-source · JSON-LD">
        <CodeSnippet
          lang="json"
          className="px-3 py-2"
          code={'{\n  "@type": "BlogPosting",\n  "headline": "Launch week, day 1",\n  "publisher": { "@id": "https://example.com/#organization" }\n}'}
        />
      </Window>
    </div>
  );
}

function Blog() {
  return (
    <Window title="/admin/posts · editor">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-display text-small font-bold text-ink">Launch week, day 1</span>
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-positive-soft px-2 text-caption font-semibold text-badge-positive-ink">Published</span>
        </div>
        <CodeSnippet
          lang="md"
          className="rounded-md border border-line px-2.5 py-1.5"
          code={"## What shipped\nSign-in, billing and the **admin**,\non a server you own."}
        />
        <span className="text-caption text-ink-3">Markdown · tags: launch</span>
      </div>
    </Window>
  );
}

/** The picture for a feature, by its icon name, or null. */
export const FEATURE_MOMENTS: Record<string, () => React.ReactNode> = {
  "shield-check": SignIn,
  "credit-card": Billing,
  "layout-dashboard": Admin,
  database: Data,
  search: Seo,
  "file-text": Blog,
};
