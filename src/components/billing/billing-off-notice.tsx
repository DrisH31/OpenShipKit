//
// <BillingOffNotice audience="customer" | "owner" /> — what to show while
// payments are switched off (BILLING_PROVIDER none, the default).
//
//   customer  one calm line: nothing can be bought yet, free plans work.
//             For the pricing page and a customer's billing page.
//   owner     the same, plus the steps to turn Polar on (billingSetupSteps,
//             the one copy of them). For an admin's billing page, /admin and
//             the dashboard's setup checklist — never for customers. Pass
//             `webhookUrl` (siteUrl() + "/api/billing/webhook") so the
//             webhook step names the real address.
//
// The page decides: `if (!(await isBillingEnabled())) <BillingOffNotice … />`
// (isBillingEnabled from src/server/services/billing). This file imports
// nothing server-only, so it renders in server and client components alike.
// A static note, not a live region: it is there on first paint.
//

import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { billingSetupSteps } from "./format";

export interface BillingOffNoticeProps {
  audience: "customer" | "owner";
  /** Owner only: the site's webhook address, shown in the setup step. */
  webhookUrl?: string;
  className?: string;
}

/** A note that payments are off; for owners it lists how to switch Polar on. */
export function BillingOffNotice({ audience, webhookUrl, className }: BillingOffNoticeProps) {
  if (audience === "customer") {
    return (
      <Alert role="note" className={cn("max-w-2xl", className)}>
        <InfoIcon aria-hidden />
        <AlertDescription className="text-ink-2">
          Payments aren’t switched on yet, so paid plans can’t be bought right now. Free plans work as usual.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert role="note" className={cn("max-w-2xl", className)}>
      <InfoIcon aria-hidden />
      <AlertTitle>Payments are off</AlertTitle>
      <AlertDescription className="text-ink-2">
        <p>
          Plans show on the pricing page and free plans work, but nothing can be bought. Billing is optional: turn on Polar
          (merchant of record — it handles VAT and sales tax) when you’re ready to charge.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          {billingSetupSteps(webhookUrl).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </AlertDescription>
    </Alert>
  );
}
