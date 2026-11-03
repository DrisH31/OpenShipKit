//
// <PortalButton /> — "Manage billing": a plain <form method="post"> to
// /api/billing/portal, which redirects to Polar's customer portal
// (cancel, change card, invoices). Works with JavaScript off; safe in server
// and client components.
//

import { SubmitButton, type SubmitButtonProps } from "./submit-button";

export interface PortalButtonProps {
  label?: string;
  variant?: SubmitButtonProps["variant"];
  size?: SubmitButtonProps["size"];
  className?: string;
}

/** Opens Polar's customer portal for the signed-in user. */
export function PortalButton({ label = "Manage billing", variant = "outline", size, className }: PortalButtonProps) {
  return (
    <form method="post" action="/api/billing/portal" className="contents">
      <SubmitButton variant={variant} size={size} className={className}>
        {label}
      </SubmitButton>
    </form>
  );
}
