//
// The hero preview's demo, as plain data and one reducer: which admin screen is
// open, the hero title (saved, and the editor's draft), the sample post's status,
// the audit log, and the agent's one on-demand edit. No React and no imports
// beyond types, so it is tested directly (sections.test.ts) and costs the page
// almost nothing.
//
// The rules are the product's, in miniature:
//   - every change is an audit entry, newest first, with the value before and after;
//   - "Undo" writes the `before` value back as a NEW entry (content.restore /
//     post.restore, by you), so the log only grows — as /admin/audit/<id> does;
//   - only content and posts are restorable here (plans are too in the product,
//     but nothing on these screens shows a plan; feedback and keys never are);
//   - the agent's edit plays once, when asked, and can be watched again only after
//     it has been undone. Nothing here runs on a timer by itself (WCAG 2.2.2): the
//     component waits ~1 s between "calling" and "applied", and only after a press.
//

/** The screens the preview can show, in the admin nav's order. */
export const TABS = ["overview", "content", "posts", "agents", "audit"] as const;
export type TabId = (typeof TABS)[number];

/** The admin path each screen stands for (ADMIN_NAV's href), so the sidebar can tell tabs from the rest. */
export const TAB_HREF: Record<TabId, string> = {
  overview: "/admin",
  content: "/admin/content",
  posts: "/admin/posts",
  agents: "/admin/agents",
  audit: "/admin/audit",
};

/** What the agent changes the title to: the same words as the agent section's transcript (agent.tsx). */
export const AGENT_TITLE = "Ship it this weekend";
/** The agent key that makes the edit (its name on the Agent keys screen and in the log). */
export const AGENT_KEY = "claude-code";
/** The hero title before the sample "you" edit two days ago: what undoing that edit brings back. */
export const EARLIER_TITLE = "The open-source SaaS starter";
/** The post the sample Cursor agent published 12 minutes ago. */
export const SAMPLE_POST = "Launch week, day 1";

/** The entry kinds the demo writes, each a real audit action (describeAudit words them on the server). */
export type DemoAction = "content.update" | "content.restore" | "post.publish" | "post.restore" | "plan.update" | "feedback.update" | "agent_key.create";
/** Who made a change: you (the admin), the claude-code key, or the cursor key. */
export type DemoActor = "you" | "agent" | "cursor";
/** What a restorable entry changed: the hero's title, or the sample post's status. */
export type DemoThing = "hero" | "post";
export type PostState = "published" | "draft";
export type AgentPhase = "ready" | "calling" | "done";

export interface DemoEntry {
  id: string;
  action: DemoAction;
  actor: DemoActor;
  /** Set on content and post entries: what Undo puts back. */
  thing: DemoThing | null;
  before: string | null;
  after: string | null;
  /** 0 is "just now". */
  minutesAgo: number;
  /** Already put back by a later restore. */
  undone: boolean;
}

export interface DemoState {
  tab: TabId;
  /** The hero title as saved (what the site shows). */
  title: string;
  /** The editor's Title field; the mini-site shows it as you type. */
  draft: string;
  post: PostState;
  /** Newest first. */
  log: DemoEntry[];
  agent: AgentPhase;
  /** The agent's entry, once it has edited (for its card and the toolbar). */
  agentEntry: string | null;
  /** The claude-code key's "used just now" on the Agent keys screen. */
  agentUsed: boolean;
  /** The entry that has just arrived (its row is washed; its Undo, if any, is the one to press). */
  fresh: string | null;
  /** Bumped when the title changes by a save, the agent or an undo, so the mini-site headline marks it (never per keystroke). */
  pulse: number;
  /** For the polite live region. */
  message: string;
  seq: number;
}

export type DemoEvent =
  | { type: "tab"; tab: TabId }
  | { type: "edit"; value: string }
  | { type: "save" }
  | { type: "agent" }
  | { type: "agent-apply" }
  | { type: "undo"; id: string };

/** The longest title the hero schema accepts (heroSchema.title.max). */
export const TITLE_MAX = 120;
/** How many entries the demo keeps (the screens show 4 or 6). */
export const LOG_CAP = 8;

/** The starting state: the overview open, the site's own hero title, five sample changes. */
export function initialDemo(title: string): DemoState {
  const log: DemoEntry[] = [
    { id: "s1", action: "post.publish", actor: "cursor", thing: "post", before: "draft", after: "published", minutesAgo: 12, undone: false },
    { id: "s2", action: "plan.update", actor: "you", thing: null, before: null, after: null, minutesAgo: 60, undone: false },
    { id: "s3", action: "feedback.update", actor: "you", thing: null, before: null, after: null, minutesAgo: 120, undone: false },
    { id: "s4", action: "agent_key.create", actor: "you", thing: null, before: null, after: null, minutesAgo: 180, undone: false },
    { id: "s5", action: "content.update", actor: "you", thing: "hero", before: EARLIER_TITLE, after: title, minutesAgo: 2 * 24 * 60, undone: false },
  ];
  return { tab: "overview", title, draft: title, post: "published", log, agent: "ready", agentEntry: null, agentUsed: false, fresh: null, pulse: 0, message: "", seq: 0 };
}

/** Can this entry be put back from the preview? */
export function restorable(e: DemoEntry): boolean {
  return e.thing !== null && !e.undone && e.before !== null;
}

/** May the agent's edit be (re)played now? Only when it isn't running and hasn't been left in place. */
export function agentCanPlay(s: DemoState): boolean {
  if (s.agent === "ready") return true;
  if (s.agent === "calling") return false;
  return s.log.find((e) => e.id === s.agentEntry)?.undone ?? true;
}

/** The hero entries (for the content screen's history). */
export const heroEntries = (s: DemoState) => s.log.filter((e) => e.thing === "hero");

function add(s: DemoState, entry: Omit<DemoEntry, "id" | "minutesAgo" | "undone">): [DemoState, string] {
  const id = `d${s.seq + 1}`;
  const log = [{ ...entry, id, minutesAgo: 0, undone: false }, ...s.log].slice(0, LOG_CAP);
  return [{ ...s, log, seq: s.seq + 1, fresh: id }, id];
}

const quote = (t: string) => `“${t}”`;

export function demoReducer(s: DemoState, ev: DemoEvent): DemoState {
  switch (ev.type) {
    case "tab":
      return s.tab === ev.tab ? s : { ...s, tab: ev.tab };

    case "edit":
      return { ...s, draft: ev.value.slice(0, TITLE_MAX) };

    case "save": {
      const next = s.draft.trim();
      if (!next || next === s.title) return s;
      const [t] = add(s, { action: "content.update", actor: "you", thing: "hero", before: s.title, after: next });
      // The Save button says "Saved" itself (Button's doneLabel, announced); this adds what changed.
      return { ...t, title: next, draft: next, pulse: s.pulse + 1, message: `The title is ${quote(next)}, and the change is in the audit log.` };
    }

    case "agent": {
      if (!agentCanPlay(s)) return s;
      return { ...s, tab: "content", agent: "calling", message: `Agent ${AGENT_KEY} is calling content_update on hero.title.` };
    }

    case "agent-apply": {
      if (s.agent !== "calling") return s;
      const [t, id] = add(s, { action: "content.update", actor: "agent", thing: "hero", before: s.title, after: AGENT_TITLE });
      return {
        ...t,
        title: AGENT_TITLE,
        draft: AGENT_TITLE,
        agent: "done",
        agentEntry: id,
        agentUsed: true,
        pulse: s.pulse + 1,
        message: `Agent ${AGENT_KEY} changed the title to ${quote(AGENT_TITLE)}. The change is logged, with Undo beside it.`,
      };
    }

    case "undo": {
      const entry = s.log.find((e) => e.id === ev.id);
      if (!entry || !restorable(entry) || entry.before === null) return s;
      const marked = { ...s, log: s.log.map((e) => (e.id === entry.id ? { ...e, undone: true } : e)) };
      if (entry.thing === "hero") {
        const [t] = add(marked, { action: "content.restore", actor: "you", thing: "hero", before: s.title, after: entry.before });
        return { ...t, title: entry.before, draft: entry.before, pulse: s.pulse + 1, message: `Restored. The title is ${quote(entry.before)} again.` };
      }
      const status = entry.before === "draft" ? "draft" : "published";
      const [t] = add(marked, { action: "post.restore", actor: "you", thing: "post", before: s.post, after: status });
      return { ...t, post: status, message: `Restored. ${quote(SAMPLE_POST)} is ${status === "draft" ? "a draft" : "published"} again.` };
    }
  }
}
