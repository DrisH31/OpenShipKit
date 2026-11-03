//
// The strip at the top of every dashboard and admin page while the read-only
// demo admin is signed in (src/core/demo.ts). Calm on purpose: the controls
// below stay visible, so a visitor sees the real admin, and a save answers
// with the same sentence the services refuse with. Server component; the
// shell decides whether to render it.
//

import { EyeIcon } from "lucide-react";
import { DEMO_BANNER_TEXT } from "@/core/demo";

export function ReadOnlyBanner() {
  return (
    <div role="note" className="border-b border-line bg-info-soft px-4 py-2 text-small text-ink sm:px-6">
      <p className="mx-auto flex max-w-6xl items-center gap-2">
        <EyeIcon aria-hidden className="size-4 shrink-0 text-info" />
        <span>{DEMO_BANNER_TEXT}</span>
      </p>
    </div>
  );
}
