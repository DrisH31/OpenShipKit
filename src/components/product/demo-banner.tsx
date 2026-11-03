//
// The strip at the top of the dashboard and admin when the app runs in demo
// mode (no DATABASE_URL: the embedded Postgres in .data/pglite). It says what
// that means and what to do before real people sign up. Server component; the
// layout decides whether to render it (isDemo()).
//
// When the read-only demo admin is also signed in (`readOnly`), the two notes
// are one strip, not two stacked: the read-only sentence leads (it's what the
// person in front of it needs to know) in the info tone, and the demo-mode
// sentence follows. A real deployment never runs in demo mode, so the live
// showcase shows ReadOnlyBanner on its own.
//

import { DatabaseIcon, EyeIcon } from "lucide-react";
import { DEMO_BANNER_TEXT } from "@/core/demo";
import { docUrl } from "@/lib/docs";
import { cn } from "@/lib/utils";

export function DemoBanner({ readOnly = false }: { readOnly?: boolean }) {
  const Icon = readOnly ? EyeIcon : DatabaseIcon;
  return (
    <div role="note" className={cn("border-b border-line px-4 py-2 text-small text-ink sm:px-6", readOnly ? "bg-info-soft" : "bg-warning-soft")}>
      {/* The icon beside the words at any length; the guide link runs on inline at the end. */}
      <p className="mx-auto flex max-w-6xl items-start gap-2">
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", readOnly ? "text-info" : "text-warning")} />
        <span className="min-w-0">
          {readOnly ? <strong className="font-semibold">{DEMO_BANNER_TEXT}</strong> : <strong className="font-semibold">Demo mode.</strong>} Data lives in the embedded
          Postgres in <code className="font-mono text-caption">.data/pglite</code> on this machine. Set <code className="font-mono text-caption">DATABASE_URL</code> before you deploy.{" "}
          <a href={docUrl("deployment")} className="font-semibold whitespace-nowrap underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
            Deployment guide
          </a>
        </span>
      </p>
    </div>
  );
}
