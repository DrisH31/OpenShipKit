import "server-only";

//
// OPENSHIPKIT SHOWCASE — "Set it up with an AI agent": the visitor who saw the
// commands above can hand all of them to a coding agent instead. Three steps,
// one copyable starter prompt, and the MCP servers that let the agent go past
// the laptop (GitHub for the repository, Dokploy for the deployment,
// Cloudflare for DNS). The full prompt pack lives in the docs (/docs/ai-setup,
// written from docs/ai-setup.md); this section links to it rather than
// repeating it, so the two can't drift.
//
// The starter prompt is plain text that only names what the repository has:
// AGENTS.md, docs/getting-started.md, docs/ai-setup.md, npm run setup / dev /
// check, and the four hosts the deploy section shows. It follows the prompt
// pack's order (setup writes .env.local before the dev server starts) and its
// rule that content changes go through the site's MCP server, never
// src/content/defaults.ts (stored content overrides the defaults). It tells the agent to stop before
// deploying or creating accounts: the visitor stays in control (DESIGN.md, the
// bridge). Like the other showcase sections it renders only while the site is
// still named OpenShipKit.
//

import Link from "next/link";
import { ArrowRightIcon, ServerIcon, SparklesIcon } from "lucide-react";
import { CopyButton } from "@/components/product/copy-button";
import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { OPENSHIPKIT_CLONE_URL } from "@/shared/project";
import { ToolMarkIcon } from "./tool-mark-icon";

/** The prompt a visitor pastes into their agent. Exported for the checks in sections.test.ts. */
export const STARTER_PROMPT = [
  "Set up OpenShipKit for me, one step at a time.",
  "",
  `1. Clone ${OPENSHIPKIT_CLONE_URL} into ./my-saas. Read AGENTS.md and docs/getting-started.md before you change anything.`,
  "2. Ask me for my admin email. Run npm install, then npm run setup -- --admin-email <my email>, then start npm run dev and check that http://localhost:3000 loads.",
  "3. Run npm run check and tell me what passed.",
  "4. Ask me for my product's name, then follow step 2 of docs/ai-setup.md to rename the site through its own MCP server. Don't edit src/content/defaults.ts: stored content overrides it.",
  "",
  "Stop before deploying anything or creating any account, and ask me where it should run: a VPS with docker compose, Dokploy, Coolify or plain Node.",
].join("\n");

const STEPS = [
  { title: "Paste the starter prompt", text: "Into Claude Code, Cursor or any coding agent, in an empty folder." },
  { title: "Answer its questions", text: "Your product’s name and your admin email. It runs the commands and shows you each result." },
  { title: "Give it MCP servers to go further", text: "With them it can create the repository, the deployment and the DNS record, without you leaving the chat." },
];

const SERVERS = [
  { name: "GitHub", mark: "github", text: "Creates your repository and pushes the code." },
  { name: "Dokploy", mark: null, text: "Creates the Compose service, fills the variables and deploys." },
  { name: "Cloudflare", mark: "cloudflare", text: "Points your domain at the server." },
] as const;

export function AiSetup() {
  return (
    <section id="ai-setup" aria-labelledby="ai-setup-title" data-tone="page" className="py-section">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col lg:col-span-5">
            <SectionHeader
              id="ai-setup-title"
              eyebrow="Set it up with an AI agent"
              title="Or hand it all to your agent"
              lead="One prompt and your coding agent clones it, runs it and makes it yours, then stops and asks before anything goes live."
            />
            <ol className="mt-10 flex flex-col gap-6">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span aria-hidden className="figure flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-small text-ink">
                    {i + 1}
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-sans text-body leading-snug font-semibold text-ink">{s.title}</h3>
                    <p className="max-w-[44ch] text-small text-ink-2">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link
              href="/docs/ai-setup"
              className="group mt-8 inline-flex min-h-11 w-fit items-center gap-1.5 text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 transition-[text-decoration-color] duration-(--dur-hover) hover:decoration-ink"
            >
              The full prompt pack and MCP setup
              <ArrowRightIcon aria-hidden className="size-3.5 text-ink-3 transition-transform duration-(--dur-hover) ease-out-quart group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
            <figure data-mockup className="reveal overflow-hidden rounded-xl border border-line-strong bg-card shadow-mockup">
              <figcaption className="flex min-h-10 items-center gap-3 border-b border-line bg-[color-mix(in_oklab,var(--card),var(--ink)_3%)] py-1 pr-1.5 pl-3.5">
                <span aria-hidden className="flex shrink-0 gap-1.5">
                  {[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-line-strong" />)}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-caption text-ink-3">
                  <SparklesIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">starter prompt · paste into your agent</span>
                </span>
                <CopyButton value={STARTER_PROMPT} size="xs" variant="ghost" srLabel="Copy the starter prompt" className="shrink-0" />
              </figcaption>
              {/* Prose, not a command: it wraps, so it reads on a phone too. */}
              <div className="flex flex-col gap-3 p-5 font-mono text-small leading-relaxed text-ink">
                {STARTER_PROMPT.split("\n\n").map((para, i) => (
                  <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">
                    {para}
                  </p>
                ))}
              </div>
            </figure>

            <div>
              <p className="mb-3 text-small font-semibold text-ink">MCP servers the guide recommends</p>
              <ul className="grid gap-3 sm:grid-cols-3">
                {SERVERS.map((s) => (
                  <li key={s.name} className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
                    <span className="inline-flex items-center gap-2 text-small font-semibold text-ink">
                      {s.mark ? (
                        <ToolMarkIcon name={s.mark} className="size-4" />
                      ) : (
                        <ServerIcon aria-hidden className="size-4" strokeWidth={1.75} />
                      )}
                      {s.name}
                    </span>
                    <span className="text-small text-ink-2">{s.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
