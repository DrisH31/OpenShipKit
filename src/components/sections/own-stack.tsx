import "server-only";

//
// OPENSHIPKIT SHOWCASE — "Own every layer" (DESIGN.md, layer 2, row 3): what
// runs where. Answers the visitor's main fear, lock-in, with the architecture
// itself: four layers inside one frame labelled "Your server", and the two
// optional outside services beside it, each marked off until a key is added.
//
// This is OpenShipKit's own story, not content: the landing page shows it only
// while the site is still named OpenShipKit (src/app/(marketing)/page.tsx).
// Keep it true to the code — env names from src/server/env.ts and the
// adapters, versions from SPEC.md §4.
//
// Plain lists and headings, so it reads as a description to a screen reader
// and to search; the frame and tiles are drawing only. No motion.
//

import {
  BotIcon,
  CircleOffIcon,
  CreditCardIcon,
  DatabaseIcon,
  KeyRoundIcon,
  MailIcon,
  PanelsTopLeftIcon,
  ServerIcon,
  type LucideIcon,
} from "lucide-react";
import { Section } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { cn } from "@/lib/utils";

interface Layer {
  Icon: LucideIcon;
  name: string;
  /** What it is, in the mono caption under the name. */
  tech: string;
  text: string;
}

/** Inside the frame: everything that runs on the founder's own machine. */
const OWN: Layer[] = [
  {
    Icon: PanelsTopLeftIcon,
    name: "The app",
    tech: "Next.js 16 · React 19",
    text: "Your pages, the dashboard, the admin and the API, as one Node process.",
  },
  {
    Icon: DatabaseIcon,
    name: "Your data",
    tech: "Postgres 18 · Drizzle",
    text: "Every user, plan, post and audit entry, in tables you can back up, query and move.",
  },
  {
    Icon: KeyRoundIcon,
    name: "Sign-in",
    tech: "Better Auth, in the app",
    text: "Passwords, magic links, sessions and two-factor, stored in your own Postgres.",
  },
  {
    Icon: BotIcon,
    name: "The agent door",
    tech: "MCP server at /api/mcp",
    text: "AI agents work through scoped keys and the same rules as the admin, and every write is logged.",
  },
];

/** Outside the frame: optional, off by default, one interface each. */
const OPTIONAL: (Layer & { env: string })[] = [
  {
    Icon: CreditCardIcon,
    name: "Payments",
    tech: "Polar",
    text: "Checkout, tax and receipts, as merchant of record. Without it, free plans still work.",
    env: "POLAR_ACCESS_TOKEN",
  },
  {
    Icon: MailIcon,
    name: "Email",
    tech: "Resend",
    text: "Sign-in links and notices. Locally they print to the terminal; a live site needs it before its first sign-up.",
    env: "RESEND_API_KEY",
  },
];

/** What a founder doesn't have to sign up for. Generic on purpose: no company is named. */
const ABSENT = ["No hosted sign-in service", "No database company", "No tracking script"];

function LayerTile({
  layer,
  status,
  className,
  children,
}: {
  layer: Layer;
  /** A word for the tile's state, in text (never colour alone): "On" inside the server, "Off" outside it. */
  status: "On" | "Off";
  className?: string;
  children?: React.ReactNode;
}) {
  const { Icon } = layer;
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-line bg-card p-5", className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-tonal text-ink">
          <Icon className="size-[1.125rem]" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="font-sans text-body leading-snug font-semibold text-ink">{layer.name}</h3>
          <p className="font-mono text-caption text-ink-3">{layer.tech}</p>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-line px-2 text-caption font-semibold text-ink-2">
          <span aria-hidden className={cn("size-1.5 rounded-full", status === "On" ? "bg-positive" : "border border-ink-faint")} />
          {status}
        </span>
      </div>
      <p className="text-small text-ink-2">{layer.text}</p>
      {children}
    </div>
  );
}

export function OwnStack() {
  return (
    <Section tone="band" id="own" aria-labelledby="own-title">
      <SectionHeader
        id="own-title"
        eyebrow="What runs where"
        title="Every layer runs on a server you control"
        lead="The app, the database and sign-in run side by side on your own machine. The only outside services are optional, off until you add a key, and each one sits behind a single small interface."
        className="max-w-3xl"
      />

      <div className="mt-12 grid gap-4 sm:mt-14 lg:grid-cols-12 lg:gap-6">
        {/* the server: a frame in the page tone, so it reads as a place the tiles sit in */}
        <div className="flex flex-col gap-4 rounded-2xl border border-line-strong bg-bg p-4 sm:p-5 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
            <p className="inline-flex items-center gap-2 text-small font-semibold text-ink">
              <ServerIcon aria-hidden className="size-4 text-ink-3" />
              Your server
            </p>
            <p className="font-mono text-caption text-ink-3">docker compose · Dokploy · Coolify · node</p>
          </div>
          <ul className="grid flex-1 gap-3 sm:auto-rows-fr sm:grid-cols-2" aria-label="Runs on your server">
            {OWN.map((layer) => (
              <li key={layer.name} className="flex">
                <LayerTile layer={layer} status="On" className="w-full" />
              </li>
            ))}
          </ul>
        </div>

        {/* the optional services: a dashed frame, because they aren't there until you add them */}
        <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-field/60 p-4 sm:p-5 lg:col-span-4">
          <p className="inline-flex items-center gap-2 px-1 text-small font-semibold text-ink">
            <CircleOffIcon aria-hidden className="size-4 text-ink-3" />
            Optional, off by default
          </p>
          <ul className="grid flex-1 gap-3 sm:auto-rows-fr sm:grid-cols-2 lg:grid-cols-1" aria-label="Optional services">
            {OPTIONAL.map((layer) => (
              <li key={layer.name} className="flex">
                <LayerTile layer={layer} status="Off" className="w-full bg-card/60">
                  <p className="mt-auto font-mono text-caption break-all text-ink-3">
                    <span className="sr-only">Turns on with </span>
                    {layer.env}=…
                  </p>
                </LayerTile>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-small text-ink-2" aria-label="Not in the stack">
        {ABSENT.map((a) => (
          <li key={a} className="inline-flex items-center gap-2">
            <span aria-hidden className="h-px w-3 bg-ink-faint" />
            {a}
          </li>
        ))}
      </ul>
    </Section>
  );
}
