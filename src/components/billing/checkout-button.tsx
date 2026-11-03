//
// <CheckoutButton planKey="pro" interval="month" label="Start 14-day trial" />
//
// A plain <form method="post"> to /api/billing/checkout with hidden fields —
// works with JavaScript off, in server and client components alike (it imports
// nothing server-only). The route sends signed-out visitors to sign-in and
// everyone else to Polar's hosted checkout. It grants nothing itself:
// access arrives with the verified webhook.
//

import type { PriceInterval } from "@/core/types";
import { SubmitButton, type SubmitButtonProps } from "./submit-button";

export interface CheckoutButtonProps {
  /** The plan's stable key ("pro"). The server looks up the product id; the client never sends one. */
  planKey: string;
  interval: PriceInterval;
  label: string;
  variant?: SubmitButtonProps["variant"];
  size?: SubmitButtonProps["size"];
  /** Classes for the button (the form itself is layout-neutral). */
  className?: string;
  /** Accessible name when several identical labels sit side by side, e.g. "Subscribe to Pro, billed yearly". */
  ariaLabel?: string;
}

/** A no-JS-safe checkout button for one plan price. */
export function CheckoutButton({ planKey, interval, label, variant, size, className, ariaLabel }: CheckoutButtonProps) {
  return (
    <form method="post" action="/api/billing/checkout" className="contents">
      <input type="hidden" name="planKey" value={planKey} />
      <input type="hidden" name="interval" value={interval} />
      <SubmitButton variant={variant} size={size} className={className} aria-label={ariaLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}
