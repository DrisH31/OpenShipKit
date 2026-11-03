//
// "Try the demo": a plain form that POSTs to /api/demo, which signs the
// visitor in as the read-only demo admin and opens /admin. No credentials and
// no JavaScript needed. Rendered only in the auth pages' note on the
// OpenShipKit showcase, and only when the demo is on (demoEnabled()).
//

import { FlaskConicalIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TryDemoButton({
  variant = "outline",
  size = "default",
  className,
  formClassName,
  icon = false,
}: {
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "default" | "sm" | "lg";
  className?: string;
  formClassName?: string;
  /** A small flask before the label (the auth note's button). */
  icon?: boolean;
}) {
  return (
    <form method="post" action="/api/demo" className={formClassName}>
      <button type="submit" className={cn(buttonVariants({ variant, size }), className)}>
        {icon ? <FlaskConicalIcon aria-hidden data-icon="inline-start" className="size-4" /> : null}
        Try the demo
      </button>
    </form>
  );
}
