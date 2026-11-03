import "server-only";

//
// OPENSHIPKIT SHOWCASE — the MCP server, told and shown. Answers the sceptic's
// question "is the agent thing real?" with the three facts that make it safe
// (scoped keys, an audit log, undo for content, posts and plans — feedback,
// users, subscribers and keys are logged but not restorable, docs/mcp.md), a
// session drawn as the agent's own transcript (what you asked, the tool it
// called, the before and after, the undo), and the two commands that connect
// it. Like "Own every layer" and "Deploy", it is OpenShipKit's own story and is
// shown only while the site is still named OpenShipKit (src/app/(marketing)/page.tsx).
//
// The key lives in OPENSHIPKIT_MCP_KEY, which .mcp.json reads: never tell a
// visitor to paste it into a committed file. The transcript uses the server's
// real tool names (content_update, audit_restore in src/server/mcp/tools), the
// script's real first line (scripts/mcp-key.mts) and the default hero title;
// keep them in step when those change. The transcript is a picture of a
// session (role="img" with a description), so nothing in it is focusable.
//

import Link from "next/link";
import { ArrowRightIcon, BotIcon, CircleCheckIcon, HistoryIcon, KeyRoundIcon, Undo2Icon, WrenchIcon } from "lucide-react";
import { CodePanel, type CodeLine } from "@/components/marketing/code-panel";
import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { DEFAULT_CONTENT } from "@/content/defaults";

const CONNECT: CodeLine[] = [
  { kind: "cmd", text: "npm run mcp:key -- --name claude --scope write" },
  { kind: "out", text: "Key created for “claude” (write). Shown once: osk_…" },
  { kind: "cmd", text: "export OPENSHIPKIT_MCP_KEY=osk_…" },
  { kind: "note", text: "# this repo's .mcp.json reads it; the key never lands in a file" },
];

const FACTS = [
  {
    Icon: KeyRoundIcon,
    title: "Scoped keys",
    text: "Each key is read, write or admin. Revoke one from the admin and it stops working on the next call.",
  },
  {
    Icon: HistoryIcon,
    title: "Every write is logged",
    text: "Content, posts, plans and feedback changes are recorded with the value before and after, and who made them.",
  },
  {
    Icon: Undo2Icon,
    title: "Undo content, posts and plans",
    text: "Restore a page, a post or a plan to any earlier version, from the audit log or by asking the agent.",
  },
];

const BEFORE = DEFAULT_CONTENT.hero.title;
const AFTER = "Ship it this weekend";

function You({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-tonal px-3.5 py-2 text-small text-ink">{children}</p>
    </div>
  );
}

function ToolCall({ name, target, children }: { name: string; target: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card text-ink">
        <BotIcon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-line-strong bg-card">
        <p className="flex items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-caption">
          <WrenchIcon className="size-3 shrink-0 text-ink-3" />
          <span className="font-semibold text-ink">{name}</span>
          <span className="truncate text-ink-3">{target}</span>
        </p>
        <div className="flex flex-col gap-1 px-3 py-2 font-mono text-caption">{children}</div>
      </div>
    </div>
  );
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 pt-0.5 font-sans text-caption text-ink-2">
      <CircleCheckIcon className="size-3.5 shrink-0 text-positive" />
      {children}
    </p>
  );
}

/** The session, drawn as the agent's own transcript. */
function Transcript() {
  return (
    <figure
      data-mockup
      role="img"
      aria-label={`An agent session: asked to change the hero title to “${AFTER}”, the agent calls content_update on the hero, the change is saved and audited; asked to undo it, it calls audit_restore and the title is “${BEFORE}” again.`}
      className="reveal overflow-hidden rounded-xl border border-line-strong bg-bg shadow-mockup"
    >
      <div aria-hidden className="flex min-h-10 items-center gap-3 border-b border-line bg-card px-3.5 py-1">
        <span className="flex shrink-0 gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-line-strong" />)}
        </span>
        <span className="truncate font-mono text-caption text-ink-3">claude code · openshipkit mcp</span>
        <span className="ml-auto inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-tonal px-2.5 text-caption font-semibold text-ink-2">
          <span className="size-1.5 rounded-full bg-positive" />
          write key
        </span>
      </div>
      <div aria-hidden className="flex flex-col gap-4 p-4 sm:p-5">
        <You>Change the hero title to “{AFTER}”</You>
        <ToolCall name="content_update" target="hero.title">
          <span className="truncate rounded-sm bg-danger-soft/60 px-1.5 text-ink">− “{BEFORE}”</span>
          <span className="truncate rounded-sm bg-positive-soft/60 px-1.5 text-ink">+ “{AFTER}”</span>
          <Done>Saved, and written to the audit log</Done>
        </ToolCall>
        <You>Undo that</You>
        <ToolCall name="audit_restore" target="hero">
          <Done>Restored the version before: “{BEFORE}”</Done>
        </ToolCall>
      </div>
    </figure>
  );
}

export function Agent() {
  return (
    <section id="agents" aria-labelledby="agents-title" data-tone="page" className="py-section">
      <Container>
        <SectionHeader
          id="agents-title"
          eyebrow="An MCP server, built in"
          title="Let your agent run the site, with an undo button"
          lead="Claude, Cursor and any MCP client can edit every section of this page, publish posts, change prices and answer feedback, through the same services and rules the admin uses."
          className="max-w-3xl"
        />
        <div className="mt-12 grid items-start gap-10 sm:mt-14 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col gap-8 lg:col-span-5 lg:pt-1">
            <ul className="flex flex-col gap-6">
              {FACTS.map(({ Icon, title, text }) => (
                <li key={title} className="flex gap-4">
                  <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-surface ring-1 ring-line">
                    <Icon className="size-[1.125rem] text-ink" strokeWidth={1.75} />
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-sans text-body leading-snug font-semibold text-ink">{title}</h3>
                    <p className="max-w-[46ch] text-small text-ink-2">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="max-w-[46ch] text-small text-ink-2">
              Mint a key with one command (or in the admin under Agent keys), and your agent finds the server
              through this repository’s <code className="font-mono text-ink">.mcp.json</code>.
            </p>
            <Link
              href="/docs/ai-setup"
              className="group -mt-4 inline-flex min-h-11 w-fit items-center gap-1.5 text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 transition-[text-decoration-color] duration-(--dur-hover) hover:decoration-ink"
            >
              The AI setup guide
              <ArrowRightIcon aria-hidden className="size-3.5 text-ink-3 transition-transform duration-(--dur-hover) ease-out-quart group-hover:translate-x-0.5" />
            </Link>
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
            <Transcript />
            <CodePanel title="connect your agent · in your checkout" lines={CONNECT} />
          </div>
        </div>
      </Container>
    </section>
  );
}
