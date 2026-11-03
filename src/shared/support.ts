//
// "Support the project": where the OpenShipKit showcase's header action goes
// once its maintainer has a checkout to point at — a Polar checkout link for a
// pay-what-you-want product, where the visitor types the amount. Polar is the
// merchant of record, so the site keeps no payment code, webhook or table for
// it: the link is the whole integration.
//
// Set by OPENSHIPKIT_SUPPORT_URL (src/server/env.ts). Shown only on the
// showcase (isShowcase): a renamed site never asks its visitors to pay for the
// template, whatever is set. Unset or not an https URL → no support button, and
// the header keeps the content's own action ("Get the code").
// Pure; safe on client and server.
//

/** The header's support action, as shown. */
export const SUPPORT_LABEL = "Support the project";

/** The support checkout's URL, or null when unset or not an absolute https URL. */
export function resolveSupportUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}
