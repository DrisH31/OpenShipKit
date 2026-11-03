import "server-only";

//
// OPENSHIPKIT SHOWCASE — "Deploy anywhere you control", the page's signature
// moment (DESIGN.md, the bridge). Four places to run it — a VPS, Dokploy,
// Coolify, plain Node — each a tab with what it needs, the exact commands (in
// colour, copyable) and, for the two dashboards, the clicks in order. Like
// "Own every layer", this is OpenShipKit's own story and renders only while
// the site is still named OpenShipKit.
//
// No JavaScript: native radios, and CSS :has() shows the chosen panel. Without
// :has() support every panel is shown, one after another. Arrow keys move
// between targets (a native radio group); the legend names the group.
//
// Keep the commands true: package.json scripts, docker-compose.yml and the
// guides in deploy/ (infra-docs owns those; update this list when they change).
// sections.test.ts checks every `npm run` script and `scripts/*` file named
// here exists, and that the VPS setup runs in a throwaway Node container.
//   - VPS: deploy/vps/README.md §5–6 and "Updating" — setup in a container (the
//     server has no Node.js; without --domain compose refuses to start), then
//     `--profile https` for Caddy. Updates are three steps, never one
//     `up -d --build` (that stops the old app before migrations run).
//   - Dokploy / Coolify: deploy/dokploy.md and deploy/coolify.md — the env file
//     is generated on a laptop (`npm run setup -- --compose …`) and pasted in;
//     the dashboard does the rest. The Caddy profile is never used there.
//   - Node: `npm start` runs the standalone server (next.config.ts: output
//     "standalone"; `next start` doesn't support it), copying .next/static and
//     public/ (only if it exists). A systemd server updates with
//     deploy/node/deploy.sh (deploy/node/README.md, "Updating").
//

import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon, CheckIcon } from "lucide-react";
import { CodePanel, type CodeLine } from "@/components/marketing/code-panel";
import { Section } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { cn } from "@/lib/utils";
import { OPENSHIPKIT_CLONE_URL, repoPath } from "@/shared/project";
import { ToolMarkIcon } from "./tool-mark-icon";

/** Generating a server's env file on a laptop, for a dashboard to paste (deploy/dokploy.md §2, deploy/coolify.md §2). */
const LAPTOP_ENV: CodeLine[] = [
  { kind: "note", text: "# in your checkout: writes .env with generated secrets" },
  { kind: "cmd", text: "npm run setup -- --compose --domain example.com --admin-email you@example.com" },
  { kind: "cmd", text: "cat .env" },
  { kind: "note", text: "# paste it into the dashboard's environment, then delete the local .env" },
];

interface Panel {
  title: string;
  lines: CodeLine[];
}

interface Target {
  id: string;
  name: string;
  /** The mark shown in the pill (a tool-marks name); none when it has none. */
  mark?: string;
  note?: string;
  facts: [string, string][];
  /** Terminal panels, in order. */
  panels: Panel[];
  /** The dashboard clicks, in order, when there is a dashboard. */
  clicks?: { title: string; steps: React.ReactNode[] };
  /** The guide in deploy/. */
  guide: string;
  /** Literal classes, so Tailwind sees them: hidden unless this target's radio is checked. */
  panel: string;
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-sm bg-tonal px-1 py-0.5 font-mono text-[0.92em] text-ink">{children}</code>
);

/** The four hosts, in the order the radios show them. Exported for the command checks. */
export const DEPLOY_TARGETS: Target[] = [
  {
    id: "vps",
    name: "A VPS",
    mark: "docker",
    note: "docker compose",
    facts: [
      ["You need", "Any Linux server with Docker, and a domain pointed at it"],
      ["It runs", "The app, Postgres 18 and Caddy for HTTPS, from one compose file"],
      ["To update", "Build, migrate, then swap the app: the old one serves until the new one is ready"],
    ],
    panels: [
      {
        title: "your server · first deploy",
        lines: [
          { kind: "cmd", text: `git clone ${OPENSHIPKIT_CLONE_URL} && cd openshipkit` },
          { kind: "note", text: "# writes .env with generated secrets; the server needs no Node.js" },
          {
            kind: "cmd",
            text: 'docker run --rm -v "$PWD":/app -w /app --user "$(id -u):$(id -g)" node:24.21.0-alpine3.24 \\\n  node scripts/setup.mts --compose --domain example.com --admin-email you@example.com',
          },
          { kind: "cmd", text: "docker compose --profile https up -d --build" },
        ],
      },
      {
        title: "your server · update",
        lines: [
          { kind: "cmd", text: "git pull" },
          { kind: "cmd", text: "docker compose --profile https build" },
          { kind: "cmd", text: "docker compose run --rm migrate" },
          { kind: "cmd", text: "docker compose --profile https up -d" },
        ],
      },
    ],
    guide: repoPath("deploy/vps/README.md"),
    panel: "group-has-[#deploy-vps:checked]/deploy:grid",
  },
  {
    id: "dokploy",
    name: "Dokploy",
    facts: [
      ["You need", "A server with Dokploy installed"],
      ["It runs", "The same compose file, behind Dokploy’s Traefik for domains and HTTPS"],
      ["To update", "Redeploy, or turn on Auto Deploy so every push to main ships"],
    ],
    panels: [{ title: "your laptop · the variables", lines: LAPTOP_ENV }],
    clicks: {
      title: "In Dokploy",
      steps: [
        <>Create Service → <strong className="font-semibold text-ink">Compose</strong>, from your repository; Compose Path <Code>./docker-compose.yml</Code></>,
        <>Environment: paste the <Code>.env</Code>; leave <Code>DATABASE_URL</Code> and <Code>DOMAIN</Code> empty</>,
        <>Domains: service <Code>app</Code>, port <Code>3000</Code>, HTTPS with Let’s Encrypt</>,
        <>Deploy, and watch <Code>migrate</Code> finish before the app starts</>,
      ],
    },
    guide: repoPath("deploy/dokploy.md"),
    panel: "group-has-[#deploy-dokploy:checked]/deploy:grid",
  },
  {
    id: "coolify",
    name: "Coolify",
    mark: "coolify",
    facts: [
      ["You need", "A server with Coolify installed"],
      ["It runs", "The same compose file, behind Coolify’s proxy and certificates"],
      ["To update", "Redeploy, or connect the repository for automatic deploys"],
    ],
    panels: [{ title: "your laptop · the variables", lines: LAPTOP_ENV }],
    clicks: {
      title: "In Coolify",
      steps: [
        <>New → Resource → your repository; Build Pack <strong className="font-semibold text-ink">Docker Compose</strong>, file <Code>/docker-compose.yml</Code></>,
        <>Fill the variables it lists from your <Code>.env</Code>; leave <Code>DATABASE_URL</Code> and <Code>DOMAIN</Code> empty</>,
        <>On the <Code>app</Code> service, Domains: <Code>https://example.com:3000</Code></>,
        <>Deploy, and watch <Code>migrate</Code> finish before the app starts</>,
      ],
    },
    guide: repoPath("deploy/coolify.md"),
    panel: "group-has-[#deploy-coolify:checked]/deploy:grid",
  },
  {
    id: "node",
    name: "Plain Node",
    mark: "node",
    facts: [
      ["You need", "Node.js 24 and a Postgres database, anywhere"],
      ["It runs", "One Node process; Postgres wherever you keep it"],
      ["To update", "Pull, build, migrate, restart: deploy/node/deploy.sh does all four"],
    ],
    panels: [
      {
        title: "your host · build and run",
        lines: [
          { kind: "note", text: "# DATABASE_URL and the secrets come from the environment" },
          { kind: "cmd", text: "npm ci && npm run build" },
          { kind: "cmd", text: "npm run db:migrate && npm run db:seed" },
          { kind: "cmd", text: "npm start" },
          { kind: "note", text: "# copies the static assets into the standalone server, then runs it" },
        ],
      },
    ],
    guide: repoPath("deploy/node/README.md"),
    panel: "group-has-[#deploy-node:checked]/deploy:grid",
  },
];

/** What doesn't change with the host: the reasons it can move. */
const SAME = ["Your data in Postgres", "Sign-in inside your app", "No secrets at build time"];

function Clicks({ title, steps }: { title: string; steps: React.ReactNode[] }) {
  return (
    <div className="rounded-xl border border-line-strong bg-card">
      <p className="border-b border-line px-4 py-2.5 text-small font-semibold text-ink">{title}</p>
      <ol className="flex flex-col gap-3 p-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-small text-ink-2">
            <span aria-hidden className="figure flex size-6 shrink-0 items-center justify-center rounded-full bg-tonal text-caption text-ink">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Deploy() {
  return (
    <Section tone="band" id="deploy" aria-labelledby="deploy-title">
      <div className="group/deploy">
        <SectionHeader
          id="deploy-title"
          eyebrow="Deploy anywhere you control"
          title="Move hosts without asking anyone"
          lead="The build needs no secrets and no database, so it runs wherever Node.js and Postgres do. Pick where yours goes; moving later is a database dump and a restore."
          className="max-w-3xl"
        />

        <fieldset className="mt-12">
          <legend className="mb-4 text-small font-semibold text-ink">Where will it run?</legend>
          <div className="flex flex-wrap gap-2">
            {DEPLOY_TARGETS.map((t, i) => (
              <label
                key={t.id}
                className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-field px-4 text-small font-semibold text-ink transition-[background-color,border-color,color,scale] duration-(--dur-hover) ease-out-quart select-none hover:[&:not(:has(:checked))]:bg-tonal active:scale-[0.98] active:duration-(--dur-press) has-[:checked]:border-action has-[:checked]:bg-action has-[:checked]:text-action-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
              >
                <input
                  type="radio"
                  name="deploy-target"
                  id={`deploy-${t.id}`}
                  value={t.id}
                  defaultChecked={i === 0}
                  className="peer sr-only"
                />
                <CheckIcon aria-hidden className="hidden size-4 peer-checked:block" />
                {t.mark && <ToolMarkIcon name={t.mark} className="size-4 peer-checked:hidden" />}
                {t.name}
                {t.note && <span className="font-normal">· {t.note}</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-8 flex flex-col gap-10">
          {DEPLOY_TARGETS.map((t) => (
            <div
              key={t.id}
              className={cn(
                "swap-in grid gap-8 supports-[selector(:has(*))]:hidden lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12",
                t.panel,
              )}
            >
              <div className="flex flex-col gap-6">
                <h3 className="sr-only">{t.name}</h3>
                <dl className="flex flex-col divide-y divide-line border-y border-line">
                  {t.facts.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-4 py-4">
                      <dt className="text-small text-ink-3">{k}</dt>
                      <dd className="text-small text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <a
                  href={t.guide}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex min-h-11 w-fit items-center gap-1.5 text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 transition-[text-decoration-color] duration-(--dur-hover) hover:decoration-ink"
                >
                  The full {t.name === "A VPS" ? "VPS" : t.name} guide
                  <ArrowUpRightIcon aria-hidden className="size-3.5 text-ink-3" />
                </a>
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                {t.panels.map((p) => (
                  <CodePanel key={p.title} title={p.title} lines={p.lines} />
                ))}
                {t.clicks && <Clicks {...t.clicks} />}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-5 border-t border-line pt-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-6">
            <p className="shrink-0 text-small font-semibold text-ink">The same on every host</p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-small text-ink-2">
              {SAME.map((u) => (
                <li key={u} className="inline-flex items-center gap-1.5">
                  <CheckIcon aria-hidden className="size-3.5 text-ink-faint" />
                  {u}
                </li>
              ))}
            </ul>
          </div>
          <Link
            href="/docs/ai-setup"
            className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 transition-[text-decoration-color] duration-(--dur-hover) hover:decoration-ink"
          >
            Let an agent deploy it
            <ArrowRightIcon aria-hidden className="size-3.5 text-ink-3 transition-transform duration-(--dur-hover) ease-out-quart group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </Section>
  );
}
