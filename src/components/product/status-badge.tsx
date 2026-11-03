//
// A status as a word, a tone and an icon — never colour alone. Tones come from
// src/lib/status.ts so the dashboard and the admin always say the same thing.
// Server-safe.
//

import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon, CircleXIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Tone } from "@/lib/status";

const LOOK: Record<Tone, { variant: "positive" | "warning" | "danger" | "info" | "secondary"; Icon: typeof CircleCheckIcon }> = {
  positive: { variant: "positive", Icon: CircleCheckIcon },
  warning: { variant: "warning", Icon: CircleAlertIcon },
  danger: { variant: "danger", Icon: CircleXIcon },
  info: { variant: "info", Icon: CircleDotIcon },
  neutral: { variant: "secondary", Icon: CircleDashedIcon },
};

export function StatusBadge({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  const { variant, Icon } = LOOK[tone];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden data-icon="inline-start" />
      {label}
    </Badge>
  );
}
