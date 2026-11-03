"use client";

/* Standards (web-design): LAY-4 Touch targets · LAY-8 Focus is visible and never hidden · MOT-2 Animate transform and opacity only · MOT-8 Reduced motion ships less · PAGE-4 Loops can be paused · UI-9 Undo over confirm · UI-17 Feedback where the action happened */
//
// The hero preview's state, in ONE client module. The screens themselves are
// rendered on the server (hero-preview.tsx) with the product's own components;
// this file holds only what changes: the provider (the demo's reducer, the
// agent's one timer and the polite live region), the sidebar's tabs and the
// stacked panels, and the small islands that read the state — the change lists,
// the hero editor with its mini-site, a post's status, a key's last use, the
// scope picker.
//
// Words never come from here: the audit sentences, actor names and time strings
// are written on the server by describeAudit/actorWords (they import zod through
// the content registry, which must not ship to the browser) and passed in as
// `copy`. sections.test.ts checks they match.
//
// Tabs follow the WAI-ARIA tabs pattern: role="tablist" with roving tabindex,
// Left/Right and Up/Down move and select (the list is a column from 768 px and
// a row below), Home/End jump; each panel is a role="tabpanel" labelled by its
// tab. The panels share one grid cell, so the frame is as tall as the tallest
// screen and never jumps when a tab changes (.hp-screen, motion.css).
//

import { createContext, useContext, useEffect, useId, useReducer, useRef, useState } from "react";
import { BotIcon, CheckIcon, PlayIcon, RotateCcwIcon, Undo2Icon, UserIcon, WrenchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AGENT_KEY,
  AGENT_TITLE,
  TABS,
  TITLE_MAX,
  agentCanPlay,
  demoReducer,
  initialDemo,
  restorable,
  type DemoAction,
  type DemoActor,
  type DemoEntry,
  type DemoEvent,
  type DemoState,
  type TabId,
} from "./demo-state";

/** The server's words for the demo: describeAudit/actorWords output, so the preview says what the admin says. */
export interface DemoCopy {
  words: Record<DemoAction, { verb: string; target: string }>;
  actors: Record<DemoActor, string>;
  /** The preview's fixed clock (ISO), so "12 min ago" is the same on the server and in the browser. */
  now: string;
}

/** How long the agent's call takes before its edit lands: long enough to read the call card. */
const AGENT_CALL_MS = 1100;

interface Ctx {
  s: DemoState;
  dispatch: (e: DemoEvent) => void;
  copy: DemoCopy;
  uid: string;
  /** Open the audit log and put focus on an entry's Undo. */
  showInAudit: (id: string) => void;
}
const DemoContext = createContext<Ctx | null>(null);
function useDemo(): Ctx {
  const c = useContext(DemoContext);
  if (!c) throw new Error("A hero preview island must be inside <DemoProvider>.");
  return c;
}

const tabId = (uid: string, t: TabId) => `${uid}-tab-${t}`;
const panelId = (uid: string, t: TabId) => `${uid}-panel-${t}`;

export function DemoProvider({ title, copy, children }: { title: string; copy: DemoCopy; children: React.ReactNode }) {
  const [s, dispatch] = useReducer(demoReducer, title, initialDemo);
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const focusEntry = useRef<string | null>(null);

  // The agent's one call: from "calling" to applied after a beat. Only ever started by a press.
  useEffect(() => {
    if (s.agent !== "calling") return;
    const t = setTimeout(() => dispatch({ type: "agent-apply" }), AGENT_CALL_MS);
    return () => clearTimeout(t);
  }, [s.agent]);

  // After "See it in the audit log": once the audit panel is shown, focus the entry's Undo.
  useEffect(() => {
    if (s.tab !== "audit" || !focusEntry.current) return;
    const id = focusEntry.current;
    focusEntry.current = null;
    document.getElementById(panelId(uid, "audit"))?.querySelector<HTMLElement>(`[data-entry="${id}"]`)?.focus();
  }, [s.tab, uid]);

  const showInAudit = (id: string) => {
    focusEntry.current = id;
    if (s.tab === "audit") document.getElementById(panelId(uid, "audit"))?.querySelector<HTMLElement>(`[data-entry="${id}"]`)?.focus();
    else dispatch({ type: "tab", tab: "audit" });
  };

  return (
    <DemoContext.Provider value={{ s, dispatch, copy, uid, showInAudit }}>
      {children}
      <p role="status" className="sr-only">
        {s.message}
      </p>
    </DemoContext.Provider>
  );
}

/* ── the toolbar's one control: plays the agent's edit once, on demand ─────── */

export function AgentButton() {
  const { s, dispatch, showInAudit } = useDemo();
  const playable = agentCanPlay(s);
  const done = s.agent === "done" && !playable && s.agentEntry;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      loading={s.agent === "calling"}
      onClick={() => (playable ? dispatch({ type: "agent" }) : done ? showInAudit(s.agentEntry!) : undefined)}
      className="bg-card max-sm:px-3"
    >
      {done ? (
        <>
          <CheckIcon aria-hidden className="text-positive" /> See it in the audit log
        </>
      ) : (
        <>
          <PlayIcon aria-hidden className="fill-current text-action-text" /> {s.agentEntry ? "Watch it again" : "Watch an agent edit"}
        </>
      )}
    </Button>
  );
}

/* ── the sidebar's tabs and the stacked panels ─────────────────────────────── */

export interface DemoNavItem {
  tab: TabId;
  label: string;
  icon: React.ReactNode;
}

export function DemoScreens({ brand, nav, panels }: { brand: React.ReactNode; nav: DemoNavItem[]; panels: Record<TabId, React.ReactNode> }) {
  const { s, dispatch, uid } = useDemo();
  const list = useRef<HTMLDivElement>(null);
  const order = nav.map((i) => i.tab);

  // In the phone's sideways row, keep the open screen's tab in view (the row only; never the page).
  useEffect(() => {
    const row = list.current;
    const tab = document.getElementById(tabId(uid, s.tab));
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    const left = tab.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - 8;
  }, [s.tab, uid]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = order.indexOf(s.tab);
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? order[(i + 1) % order.length]
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? order[(i - 1 + order.length) % order.length]
      : e.key === "Home" ? order[0]
      : e.key === "End" ? order[order.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    dispatch({ type: "tab", tab: next });
    document.getElementById(tabId(uid, next))?.focus();
  };

  return (
    <div className="grid bg-bg md:grid-cols-[11rem_minmax(0,1fr)]">
      {/* sidebar: the five screens the preview opens, on the page tone with a hairline edge (COL-6), and the one
          "Sample data" label at its foot. Below 768 px it is a row of the five above the screen, scrolling sideways. */}
      <div className="flex min-w-0 flex-col border-b border-line-strong md:gap-4 md:border-r md:border-b-0 md:p-3">
        <div aria-hidden className="hidden items-center gap-2 px-2 pt-1 md:flex">
          {brand}
        </div>
        <div
          ref={list}
          role="tablist"
          aria-label="Admin screens"
          onKeyDown={onKeyDown}
          className="hp-tabs scroll-shade flex gap-1 overflow-x-auto px-2 py-2 [--scroll-cover:var(--bg)] md:flex-col md:gap-0.5 md:overflow-visible md:p-0"
        >
          {nav.map((item) => (
            <button
              key={item.tab}
              type="button"
              role="tab"
              data-preview-nav
              id={tabId(uid, item.tab)}
              aria-selected={s.tab === item.tab}
              aria-controls={panelId(uid, item.tab)}
              tabIndex={s.tab === item.tab ? 0 : -1}
              onClick={() => dispatch({ type: "tab", tab: item.tab })}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-small whitespace-nowrap text-ink-2 transition-colors duration-(--dur-hover) hover:bg-tonal hover:text-ink pointer-coarse:h-11 md:h-8 md:px-2 md:pointer-coarse:h-10",
                s.tab === item.tab && "bg-tonal font-semibold text-ink",
              )}
            >
              <span aria-hidden className={cn("hidden md:inline-flex [&_svg]:size-4", s.tab === item.tab ? "text-ink" : "text-ink-3")}>
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-auto hidden items-center gap-2 px-2 pb-1 text-caption text-ink-3 md:flex">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-3" /> Sample data
        </p>
      </div>

      <div className="grid min-w-0 *:[grid-area:1/1]">
        {TABS.map((t) => {
          const on = s.tab === t;
          return (
            <div
              key={t}
              id={panelId(uid, t)}
              role="tabpanel"
              aria-labelledby={tabId(uid, t)}
              tabIndex={on ? 0 : -1}
              inert={!on}
              data-off={on ? undefined : ""}
              data-screen={t}
              className="hp-screen flex min-w-0 flex-col gap-4 p-4 focus-visible:outline-offset-[-2px] sm:p-5"
            >
              {panels[t]}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A real button that opens a screen, styled as the overview's "Audit log" link. */
export function ScreenLink({ tab, children }: { tab: TabId; children: React.ReactNode }) {
  const { dispatch, uid } = useDemo();
  return (
    <button
      type="button"
      aria-controls={panelId(uid, tab)}
      onClick={() => {
        dispatch({ type: "tab", tab });
        document.getElementById(tabId(uid, tab))?.focus();
      }}
      className="inline-flex min-h-8 items-center text-small text-ink-2 underline decoration-ink-faint underline-offset-4 hover:text-ink hover:decoration-ink pointer-coarse:min-h-11"
    >
      {children}
    </button>
  );
}

/* ── change lists ──────────────────────────────────────────────────────────── */

function when(copy: DemoCopy, e: DemoEntry): string {
  const now = new Date(copy.now);
  return relativeTime(new Date(now.getTime() - e.minutesAgo * 60_000), now);
}

function ChangeRow({ e, fresh, children, detail }: { e: DemoEntry; fresh: boolean; children?: React.ReactNode; detail?: React.ReactNode }) {
  const { copy } = useDemo();
  const w = copy.words[e.action];
  const Icon = e.actor === "you" ? UserIcon : BotIcon;
  return (
    <li className={cn("relative flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-line px-4 py-2.5 first:border-t-0 sm:flex-nowrap", fresh && "hp-arrived")}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", e.actor === "you" ? "text-ink-3" : "text-ink")} />
      {/* on a phone the text takes the row, so an Undo drops to its own line under it */}
      <span className="flex min-w-0 flex-1 flex-col max-sm:basis-[calc(100%-1.75rem)]">
        <span className="text-small text-pretty text-ink">
          <span className="font-semibold">{w.verb}</span> {w.target}
        </span>
        {detail}
        <span className="text-caption text-ink-3">
          {copy.actors[e.actor]} · {when(copy, e)}
        </span>
      </span>
      {children}
    </li>
  );
}

/** The overview's "Recent changes": the newest few, as sentences (each opens its entry in the product). */
export function RecentChanges({ count, className }: { count: number; className?: string }) {
  const { s } = useDemo();
  return (
    <ol className={cn("flex flex-col", className)}>
      {s.log.slice(0, count).map((e) => (
        <ChangeRow key={e.id} e={e} fresh={e.id === s.fresh} />
      ))}
    </ol>
  );
}

/** Undo for one entry; it stays in place as "Restored" once used, so focus never falls off the page. */
function UndoButton({ e, highlight }: { e: DemoEntry; highlight: boolean }) {
  const { dispatch, copy } = useDemo();
  const w = copy.words[e.action];
  const name = `${w.verb} ${w.target}`;
  return (
    <Button
      type="button"
      size="xs"
      data-entry={e.id}
      variant={e.undone ? "ghost" : highlight ? "default" : "outline"}
      aria-disabled={e.undone || undefined}
      aria-label={e.undone ? `Restored: ${name}` : `Undo: ${name}`}
      onClick={() => (e.undone ? undefined : dispatch({ type: "undo", id: e.id }))}
      className="shrink-0 pointer-coarse:h-9 max-sm:ml-7"
    >
      {/* both labels in one cell: the button keeps its width when it turns into "Restored" */}
      <span className="grid items-center justify-items-center *:[grid-area:1/1]">
        <span className={cn("flex items-center gap-1", e.undone && "invisible")}>
          <Undo2Icon /> Undo
        </span>
        <span className={cn("flex items-center gap-1", !e.undone && "invisible")}>
          <CheckIcon className={cn("text-positive", e.undone && "pop-in")} /> Restored
        </span>
      </span>
    </Button>
  );
}

const q = (t: string | null) => (t === null ? "" : `“${t}”`);

/** The audit log: every change, newest first, with Undo on what can be put back. */
export function AuditList({ count, className }: { count: number; className?: string }) {
  const { s } = useDemo();
  return (
    <ol className={cn("flex flex-col", className)}>
      {s.log.slice(0, count).map((e) => (
        <ChangeRow
          key={e.id}
          e={e}
          fresh={e.id === s.fresh}
          detail={
            e.thing === "hero" && e.after !== null ? (
              <span className="text-caption text-pretty text-ink-2">
                {q(e.before)} → {q(e.after)}
              </span>
            ) : null
          }
        >
          {e.thing ? <UndoButton e={e} highlight={e.id === s.fresh && restorable(e) && !e.action.endsWith(".restore")} /> : null}
        </ChangeRow>
      ))}
    </ol>
  );
}

/* ── the content screen: the hero editor, the agent's card and the mini-site ─ */

export function HeroEditor({ siteName, eyebrow, host, logo }: { siteName: string; eyebrow: string; host: string; logo: React.ReactNode }) {
  const { s, dispatch, uid } = useDemo();
  const [saved, setSaved] = useState(0);
  const dirty = s.draft.trim() !== "" && s.draft.trim() !== s.title;
  const input = `${uid}-title`;
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), 1800);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    // Phone: the field, the picture it changes, then the agent. From 1024 px: field and agent left, picture right.
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <form
          className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-card p-4 lg:col-start-1 lg:row-start-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dirty) return;
            dispatch({ type: "save" });
            setSaved((n) => n + 1);
          }}
        >
          <label htmlFor={input} className="text-small font-semibold text-ink">
            Title
          </label>
          <Input
            id={input}
            value={s.draft}
            maxLength={TITLE_MAX}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => dispatch({ type: "edit", value: e.target.value })}
          />
          <div className="mt-1 flex items-center gap-3">
            {/* outline while there is nothing to save: a disabled solid accent reads as a muddy, broken button */}
            <Button type="submit" size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty && !saved} done={saved > 0 && !dirty} doneLabel="Saved">
              Save
            </Button>
            <span className="text-caption text-ink-3">{dirty ? "Not saved yet" : "The preview follows as you type"}</span>
          </div>
        </form>
      <MiniSite siteName={siteName} eyebrow={eyebrow} host={host} logo={logo} />
      <AgentCard />
    </div>
  );
}

function AgentCard() {
  const { s, copy } = useDemo();
  const entry = s.log.find((e) => e.id === s.agentEntry);
  const shown = s.agent === "calling" || entry;
  const before = entry ? entry.before : s.title;
  return (
    // Tall enough for the finished call (its Undo on its own line on a phone), so the frame never grows when it lands.
    <div className="flex min-h-[12.5rem] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card sm:min-h-[11rem] lg:col-start-1 lg:row-start-2">
      <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-small font-semibold text-ink">
        <BotIcon aria-hidden className="size-4 text-ink-3" /> Agent activity
        <span className="ml-auto truncate font-mono text-caption font-normal text-ink-3">
          {AGENT_KEY}
        </span>
      </p>
      {!shown ? (
        <p className="flex flex-1 items-center gap-2.5 px-4 py-3 text-small text-pretty text-ink-2">
          <PlayIcon aria-hidden className="size-3.5 shrink-0 fill-current text-action-text" />
          <span>
            Press <span className="font-semibold text-ink">Watch an agent edit</span> to see {AGENT_KEY} change this title over MCP, with Undo.
          </span>
        </p>
      ) : (
        <div className="swap-in flex flex-col gap-1.5 px-4 py-3">
          <p className="flex items-center gap-2 font-mono text-caption">
            <WrenchIcon aria-hidden className="size-3 shrink-0 text-ink-3" />
            <span className="font-semibold text-ink">content_update</span>
            <span className="truncate text-ink-3">hero.title</span>
          </p>
          <span className="truncate rounded-sm bg-danger-soft/60 px-1.5 font-mono text-caption text-ink">− {q(before)}</span>
          <span className="truncate rounded-sm bg-positive-soft/60 px-1.5 font-mono text-caption text-ink">+ {q(AGENT_TITLE)}</span>
          <div className="mt-1 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 text-caption text-ink-2">
            {s.agent === "calling" ? (
              <span className="flex items-center gap-1.5">
                <Spinner className="size-3.5" aria-hidden role={undefined} /> Calling the tool…
              </span>
            ) : entry && entry.undone ? (
              <span className="flex items-center gap-1.5">
                <RotateCcwIcon aria-hidden className="size-3.5 shrink-0 text-ink-3" /> Undone by {copy.actors.you}: {q(entry.before)} is back
              </span>
            ) : entry ? (
              <>
                <span className="flex items-center gap-1.5">
                  <CheckIcon aria-hidden className="size-3.5 shrink-0 text-positive" /> Saved, and written to the audit log
                </span>
                <UndoButton e={entry} highlight />
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** The landing page's first screen in miniature: its headline follows the editor's draft as you type. */
function MiniSite({ siteName, eyebrow, host, logo }: { siteName: string; eyebrow: string; host: string; logo: React.ReactNode }) {
  const { s } = useDemo();
  const headline = s.draft.trim() || "Untitled";
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-bg shadow-control lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch">
      <figcaption className="flex items-center gap-2 border-b border-line bg-card px-3 py-1.5 text-caption text-ink-3">
        <span className="font-semibold text-ink-2">Live preview</span>
        <span className="ml-auto truncate">{host}</span>
      </figcaption>
      <div aria-hidden className="flex items-center justify-between gap-3 px-4 pt-3">
        <span className="flex min-w-0 items-center gap-1.5">
          {logo}
          <span className="truncate font-display text-caption font-bold text-ink">{siteName}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="hidden h-1.5 w-6 rounded-full bg-tonal-hover sm:block" />
          <span className="hidden h-1.5 w-6 rounded-full bg-tonal-hover sm:block" />
          <span className="h-1.5 w-6 rounded-full bg-tonal-hover" />
          <span className="h-4 w-12 rounded-full bg-action" />
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 pt-6 pb-8 text-center sm:pt-8 sm:pb-10">
        {eyebrow ? <span className="text-caption font-semibold tracking-[0.08em] text-ink-3 uppercase">{eyebrow}</span> : null}
        {/* two lines are reserved, so a one-line title doesn't shrink the picture (a third line may grow it) */}
        <div className="flex min-h-[2.1em] items-center justify-center font-display text-h3 leading-[1.05]">
          <p key={s.pulse} className={cn("line-clamp-3 max-w-[18ch] font-bold text-balance break-words text-ink", s.pulse > 0 && "hp-pulse")}>
            {headline}
          </p>
        </div>
        <span aria-hidden className="mt-1 flex w-full flex-col items-center gap-1.5">
          <span className="h-1.5 w-[78%] rounded-full bg-tonal-hover" />
          <span className="h-1.5 w-[58%] rounded-full bg-tonal-hover" />
        </span>
        <span aria-hidden className="mt-2 flex gap-2">
          <span className="h-5 w-16 rounded-full bg-action" />
          <span className="h-5 w-14 rounded-full border border-field" />
        </span>
      </div>
    </figure>
  );
}

/* ── small islands on the server-rendered screens ─────────────────────────── */

/** Whatever shows the sample post's state (its badge, its published date): follows an undo of its publish. */
export function PostStatus({ published, draft }: { published: React.ReactNode; draft: React.ReactNode }) {
  const { s } = useDemo();
  return <>{s.post === "published" ? published : draft}</>;
}

/** The claude-code key's last use: "never used" until the agent's edit, then "used just now". */
export function AgentKeyUse({ never, now }: { never: string; now: string }) {
  const { s } = useDemo();
  return <>{s.agentUsed ? now : never}</>;
}

/** The mint form's scope choice: real radios (Write first, as in the admin), and an honest note for the button. */
export function MintKey({ scopes }: { scopes: { value: string; label: string; body: string }[] }) {
  const { uid } = useDemo();
  const [scope, setScope] = useState(scopes[1]?.value ?? scopes[0].value);
  const [pressed, setPressed] = useState(false);
  const current = scopes.find((x) => x.value === scope) ?? scopes[0];
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-small font-semibold text-ink">Scope</legend>
        <div className="flex flex-wrap gap-2">
          {scopes.map((x) => (
            <label
              key={x.value}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-small text-ink-2 hover:bg-tonal has-checked:border-ink has-checked:font-semibold has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus pointer-coarse:h-11"
            >
              <input type="radio" name={`${uid}-scope`} value={x.value} checked={scope === x.value} onChange={() => setScope(x.value)} className="size-3.5 accent-(--color-action)" />
              {x.label}
            </label>
          ))}
        </div>
        <p className="text-caption text-ink-2">{current.body}</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setPressed(true)}>
          Mint key
        </Button>
        <p role="status" className="min-w-0 flex-1 text-caption text-ink-3">
          {pressed ? "Sample data: no key is made here. In your admin the key is shown once, then kept only as a hash." : ""}
        </p>
      </div>
    </div>
  );
}
