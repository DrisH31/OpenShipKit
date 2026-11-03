/* Standards (web-design): PAGE-1 Content in the first byte · PAGE-2 The real product, shown · PAGE-4 Loops can be paused · UI-5 Dashboards: the answer first · UI-9 Undo over confirm */
//
// The hero's product preview: OpenShipKit's own admin, working, with sample
// data. Five of its screens — Overview, Content (the hero editor), Posts, Agent
// keys, Audit log — rendered here on the server from the same sources as the
// real ones: the admin nav (ADMIN_NAV with NAV_ICONS — only the five screens shown,
// in its order; the places the preview can't open are left out, not drawn dead),
// the overview's KPI labels and "Running on" pairs, the hero section's label
// and description (CONTENT_KEYS), the status words (POST_STATUS, StatusBadge),
// and audit sentences written by describeAudit/actorWords. The product
// components (KPI, Sparkline, Delta, DetailList, Table, StatusBadge, Badge)
// render here and ship no JavaScript of their own beyond Table's.
//
// What changes lives in ONE client module (./hero-preview/demo.tsx): the tabs,
// the change lists, the title field and its mini-site, the agent's card, a
// post's status, a key's last use. They are small islands inside these
// server-rendered screens, sharing one reducer (./hero-preview/demo-state.ts).
// The overview is the first frame and the page's LCP: all of its words are in
// the server HTML, and nothing is at opacity 0 on load.
//
// The signature moment (DESIGN.md): "Watch an agent edit" in the toolbar plays
// the agent's edit ONCE, when pressed — the content_update call, the headline
// changing, the new audit entry with its Undo highlighted. Never on load, never
// in a loop (WCAG 2.2.2); reduced motion gets the same states without movement.
//
// Rules: every figure is sample data and is labelled so once, for every screen
// (the sidebar's foot; above each screen on a phone, where the sidebar is a row); the
// figures agree with each other (the sparkline ends on the users figure, the
// deltas match the series, the cursor key was "used 12 min ago" when it
// published the post 12 min ago, claude-code is "never used" until it edits).
// The address bar shows this site's own host (`url`, from the Hero).
//

import { ActivityIcon, BotIcon, CircleCheckIcon, KeyRoundIcon } from "lucide-react";
import type { AuditEntry } from "@/core/types";
import { CONTENT_KEYS } from "@/core/content";
import { BrowserChrome } from "@/components/marketing/browser-chrome";
import { Delta } from "@/components/product/delta";
import { DetailList } from "@/components/product/detail-list";
import { KPI } from "@/components/product/kpi";
import { NAV_ICONS } from "@/components/product/nav-icons";
import { Sparkline } from "@/components/product/sparkline";
import { StatusBadge } from "@/components/product/status-badge";
import { LogoMark } from "@/components/site/logo";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADMIN_NAV } from "@/lib/app-nav";
import { actorWords, describeAudit } from "@/lib/audit-words";
import { formatDate, relativeTime } from "@/lib/format";
import { POST_STATUS } from "@/lib/status";
import { AgentButton, AgentKeyUse, AuditList, DemoProvider, DemoScreens, HeroEditor, MintKey, PostStatus, RecentChanges, ScreenLink, type DemoCopy } from "./hero-preview/demo";
import { AGENT_KEY, SAMPLE_POST, TAB_HREF, TABS, type DemoAction, type DemoActor, type TabId } from "./hero-preview/demo-state";

// Sample series: weekly sign-ups summed into total users, so the KPI, its delta
// and its sparkline are one story. Last value = the figure shown.
const USERS = [1032, 1061, 1090, 1118, 1149, 1183, 1214, 1246, 1284];
const USERS_NOW = USERS[USERS.length - 1];
const USERS_DELTA = (USERS_NOW - USERS[USERS.length - 2]) / USERS[USERS.length - 2];
const PAYING = [171, 176, 183, 188, 194, 199, 205, 208, 212];
const PAYING_NOW = PAYING[PAYING.length - 1];
const PAYING_DELTA = (PAYING_NOW - PAYING[PAYING.length - 2]) / PAYING[PAYING.length - 2];

/** The preview's clock: fixed, so relative times ("12 min ago") are the same on the server and in the browser. */
const NOW = new Date("2026-10-06T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const YOU = "you@example.com";

/** One sample audit record per kind of change the demo writes, shaped as the services write them. */
const SAMPLE_ENTRIES: Record<DemoAction, AuditEntry> = (() => {
  const base = { id: "sample", actor: { type: "user" as const, id: null, label: YOU }, before: null, createdAt: NOW.toISOString() };
  const hero = { ...base, entity: "content", entityId: "hero", after: null };
  const post = { ...base, entity: "post", entityId: "sample-post", after: { title: SAMPLE_POST, kind: "post" } };
  return {
    "content.update": { ...hero, action: "content.update" },
    "content.restore": { ...hero, action: "content.restore" },
    "post.publish": { ...post, action: "post.publish" },
    "post.restore": { ...post, action: "post.restore" },
    "plan.update": { ...base, action: "plan.update", entity: "plan", entityId: "sample-plan", after: { name: "Pro" } },
    "feedback.update": { ...base, action: "feedback.update", entity: "feedback", entityId: "sample-feedback", after: { status: "planned" } },
    "agent_key.create": { ...base, action: "agent_key.create", entity: "agent_key", entityId: "sample-key", after: { name: AGENT_KEY } },
  };
})();

const ACTORS: Record<DemoActor, AuditEntry["actor"]> = {
  you: { type: "user", id: null, label: YOU },
  agent: { type: "agent", id: null, label: `agent:${AGENT_KEY}` },
  cursor: { type: "agent", id: null, label: "agent:cursor" },
};

/** The demo's words, from the admin's own describeAudit and actorWords. */
export function previewCopy(): DemoCopy {
  const words = {} as DemoCopy["words"];
  for (const [k, e] of Object.entries(SAMPLE_ENTRIES) as [DemoAction, AuditEntry][]) {
    const w = describeAudit(e);
    words[k] = { verb: w.verb, target: w.target };
  }
  const actors = {} as DemoCopy["actors"];
  for (const [k, actor] of Object.entries(ACTORS) as [DemoActor, AuditEntry["actor"]][]) actors[k] = actorWords({ ...SAMPLE_ENTRIES["content.update"], actor });
  return { words, actors, now: NOW.toISOString() };
}

/** The demo's configuration (no DATABASE_URL, BILLING_PROVIDER none, EMAIL_PROVIDER console), in the overview's words.
 *  Email says "local only": in production the console provider logs only To and Subject, so it can't stand in for Resend. */
const RUNNING_ON = [
  { label: "Auth", value: "Better Auth, in your database" },
  { label: "Data", value: "Embedded Postgres (PGlite, .data/pglite)" },
  { label: "Payments", value: "Off (set POLAR_ACCESS_TOKEN)" },
  { label: "Email", value: "Printed to the terminal (local only)" },
];

/** Sample posts, newest first. The first is the one the cursor key published 12 min ago; its badge follows the demo. */
const POSTS = [
  { title: SAMPLE_POST, path: "/blog/launch-week-day-1", status: "sample", listed: true, published: ago(12) },
  { title: "Let AI agents run your site", path: "/blog/mcp-server", status: "published", listed: true, published: "2026-10-01T09:00:00.000Z" },
  { title: "Self-hosting on your own VPS", path: "/blog/self-hosting", status: "published", listed: false, published: "2026-09-24T09:00:00.000Z" },
  { title: "Why your users table should be yours", path: "/blog/own-your-users", status: "published", listed: true, published: "2026-09-17T09:00:00.000Z", wide: true },
  { title: "Moving off a hosted auth service", path: "/blog/leaving-hosted-auth", status: "draft", listed: true, published: null },
] as const;

/** The mint form's scopes, in its words (src/components/admin/mint-key-form.tsx; sections.test.ts keeps them in step). */
const SCOPES = [
  { value: "read", label: "Read", body: "Read content, posts, plans and feedback. Changes nothing.", tone: "neutral" },
  { value: "write", label: "Write", body: "Read, plus edit and publish content, posts and plans, and triage feedback.", tone: "info" },
  { value: "admin", label: "Admin", body: "Write, plus users, roles, subscribers and agent keys. Only for agents you fully trust.", tone: "warning" },
] as const;
const scopeOf = (v: (typeof SCOPES)[number]["value"]) => SCOPES.find((s) => s.value === v)!;

/** Sample agent keys. claude-code was minted 3 h ago (the log says so) and is unused until the agent edits. */
const KEYS = [
  { name: AGENT_KEY, scope: "write", hint: "7f3a", minted: ago(180), used: null },
  { name: "cursor", scope: "write", hint: "c21e", minted: "2026-09-30T15:20:00.000Z", used: ago(12) },
  { name: "ci-reader", scope: "read", hint: "09bd", minted: "2026-09-12T08:05:00.000Z", used: ago(60) },
] as const;

const nf = new Intl.NumberFormat("en-US");

/** A screen's header, as the admin's PageHeader: the title and the one-line answer.
 *  "Sample data" sits in the sidebar's foot from 768 px; below it, where the sidebar is a row, it sits here. */
function ScreenHead({ title, answer, eyebrow }: { title: string; answer: string; eyebrow?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {eyebrow ? <span className="text-caption text-ink-3">{eyebrow}</span> : null}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-display text-h3 leading-tight font-bold text-ink">{title}</span>
        <Badge variant="secondary" className="md:hidden">
          Sample data
        </Badge>
      </span>
      <span className="text-small text-pretty text-ink-2">{answer}</span>
    </div>
  );
}

const CARD = "rounded-xl border border-line bg-card";

function OverviewScreen({ url }: { url: string }) {
  return (
    <>
      <ScreenHead title="Overview" answer="Everything is answering. Here’s what the site runs on and what changed lately." />
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-small ${CARD}`}>
        <CircleCheckIcon aria-hidden className="size-4 text-positive" />
        <span className="font-semibold text-ink">Database healthy</span>
        <span aria-hidden className="text-ink-3 max-sm:hidden">·</span>
        <span className="min-w-0 truncate text-ink-2">{url}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label="Users" value={nf.format(USERS_NOW)} trend={<Sparkline values={USERS} />} delta={<Delta value={USERS_DELTA} against="last week" />} className="p-4" />
        <KPI label="Paying now" value={nf.format(PAYING_NOW)} delta={<Delta value={PAYING_DELTA} against="last week" />} className="p-4" />
        <KPI label="Subscribers" value={nf.format(3906)} note="On the email list" className="hidden p-4 lg:flex" />
        <KPI label="Open feedback" value="7" note="New, planned or in progress" className="hidden p-4 lg:flex" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className={`overflow-hidden ${CARD}`}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
            <span className="flex items-center gap-2 text-body font-semibold text-ink">
              <ActivityIcon aria-hidden className="size-4 text-ink-3" /> Recent changes
            </span>
            <ScreenLink tab="audit">Audit log</ScreenLink>
          </div>
          {/* five on a phone, where the column is long; four beside "Running on" from 1024 px */}
          <RecentChanges count={5} className="lg:[&>li:nth-child(5)]:hidden" />
        </div>
        <div className={`hidden flex-col gap-3 p-4 lg:flex ${CARD}`}>
          <span className="text-small font-semibold text-ink">Running on</span>
          <DetailList variant="pairs" items={RUNNING_ON} className="text-caption" />
        </div>
      </div>
    </>
  );
}

function PostsScreen() {
  const published = <StatusBadge label={POST_STATUS.published.label} tone={POST_STATUS.published.tone} />;
  const draft = <StatusBadge label={POST_STATUS.draft.label} tone={POST_STATUS.draft.tone} />;
  return (
    <>
      <ScreenHead title="Posts" answer="Everything long-form: the blog, the changelog and static pages like privacy and terms. Drafts stay off the site until you publish." />
      <div className={CARD}>
        <Table label="Posts">
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden px-4 md:table-cell">Published</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {POSTS.map((p) => (
              <TableRow key={p.path} className={"wide" in p ? "max-sm:hidden" : undefined}>
                <TableCell className="max-w-[24rem] px-4 py-2.5 whitespace-normal">
                  <span className="block font-semibold text-ink">{p.title}</span>
                  <span className="block font-mono text-caption text-ink-3 [overflow-wrap:anywhere] max-sm:hidden">{p.path}</span>
                </TableCell>
                <TableCell className="w-px whitespace-nowrap">
                  <span className="flex flex-col items-start gap-1.5 sm:flex-row">
                    {p.status === "sample" ? <PostStatus published={published} draft={draft} /> : p.status === "published" ? published : draft}
                    {p.listed ? null : <StatusBadge label="Unlisted" tone="neutral" />}
                  </span>
                </TableCell>
                <TableCell className="hidden px-4 md:table-cell">
                  {p.status === "sample" ? <PostStatus published={formatDate(p.published)} draft="—" /> : p.published ? formatDate(p.published) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function AgentsScreen() {
  return (
    <>
      <ScreenHead title="Agent keys" answer="Let an AI agent run this site through its MCP server. It works through the same validated, audited services as this panel." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-start">
        <div className={`flex flex-col gap-3 p-4 ${CARD}`}>
          <span className="flex items-center gap-2 text-body font-semibold text-ink">
            <KeyRoundIcon aria-hidden className="size-4 text-ink-3" /> Mint a key
          </span>
          <MintKey scopes={SCOPES.map((s) => ({ value: s.value, label: s.label, body: s.body }))} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-small font-semibold text-ink">Active keys</span>
          <ul className={CARD}>
            {KEYS.map((k) => {
              const scope = scopeOf(k.scope);
              return (
                <li key={k.name} className="flex items-start gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
                  <BotIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink">
                      {k.name}
                      <StatusBadge label={scope.label} tone={scope.tone} />
                    </span>
                    <span className="text-caption text-ink-3">
                      <span className="font-mono">…{k.hint}</span> · minted {formatDate(k.minted)} by {YOU} ·{" "}
                      {k.used ? `used ${relativeTime(k.used, NOW)}` : <AgentKeyUse never="never used" now={`used ${relativeTime(NOW, NOW)}`} />}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}

export function HeroPreview({ siteName, url, title, eyebrow, className }: { siteName: string; url: string; title: string; eyebrow: string; className?: string }) {
  const hero = CONTENT_KEYS.hero;
  // The admin nav's screens that the preview opens, in its order.
  const nav = ADMIN_NAV.flatMap((item) => {
    const tab = TABS.find((t) => TAB_HREF[t] === item.href);
    if (!tab) return [];
    const Icon = NAV_ICONS[item.icon];
    return [{ tab, label: item.label, icon: <Icon className="size-4 shrink-0" /> }];
  });
  const panels: Record<TabId, React.ReactNode> = {
    overview: <OverviewScreen url={url} />,
    content: (
      <>
        <ScreenHead eyebrow="Content" title={hero.label} answer={hero.description} />
        <HeroEditor siteName={siteName} eyebrow={eyebrow} host={url.replace(/\/admin$/, "")} logo={<LogoMark className="size-3.5" />} />
      </>
    ),
    posts: <PostsScreen />,
    agents: <AgentsScreen />,
    audit: (
      <>
        <ScreenHead title="Audit log" answer="Every change, who made it (a person or an agent key), and the value before and after. Content, posts and plans can be put back." />
        <div className={`overflow-hidden ${CARD}`}>
          {/* six rows; five on a phone, where each Undo takes its own line */}
          <AuditList count={6} className="max-sm:[&>li:nth-child(6)]:hidden" />
        </div>
      </>
    ),
  };

  return (
    <DemoProvider title={title} copy={previewCopy()}>
      <BrowserChrome url={url} actions={<AgentButton />} role="region" aria-label={`Interactive preview of the ${siteName} admin, with sample data`} className={["hp-frame", className].filter(Boolean).join(" ")}>
        <DemoScreens
          brand={
            <>
              <LogoMark className="size-5" />
              <span className="truncate font-display text-small font-bold text-ink">{siteName}</span>
            </>
          }
          nav={nav}
          panels={panels}
        />
      </BrowserChrome>
    </DemoProvider>
  );
}
