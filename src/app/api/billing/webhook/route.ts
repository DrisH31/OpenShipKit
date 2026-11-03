//
// POST /api/billing/webhook — the ONLY place billing state enters the app.
// The Polar adapter (src/adapters/billing/polar) verifies the signature over
// the raw body, re-fetches the object from Polar, and hands that state to the
// billing write path (its BillingWebhookSink), which writes and audits it.
// 404 when billing is off, and under OPENSHIPKIT_PROFILE=site.
//
// The body is read HERE, and only here, by streaming with the shared byte cap
// (readCapped in src/server/http.ts): the endpoint is public and the
// signature can only be checked after the read, so a chunked upload with no
// Content-Length must not be buffered past the cap. Over it → 413. This is the
// one webhook body cap: the adapter trusts the bytes it is handed. It gets a
// Request over those exact bytes (never re-serialised: a JSON round-trip would
// break the signature) and the Standard Webhooks headers.
//
// Keep this path public and unwrapped: no auth, no body parsing before the
// adapter, no WAF / bot challenge in front of it. The proxy never touches /api.
//

import { BILLING_DISABLED_MESSAGE } from "@/components/billing/format";
import { getBilling } from "@/server/billing";
import { readCapped } from "@/server/http";
import { saasOnlyResponse } from "@/server/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The webhook body cap, the only one (see above). Polar events are a few KB. */
const WEBHOOK_BODY_BYTES = 1024 * 1024;

/** The headers the provider signs with (Standard Webhooks), plus the body's type. Nothing else is passed on. */
const FORWARDED_HEADERS = ["webhook-id", "webhook-timestamp", "webhook-signature", "content-type"] as const;

export async function POST(request: Request): Promise<Response> {
  // OPENSHIPKIT_PROFILE=site: no billing routes at all (docs/site-profile.md).
  const off = saasOnlyResponse();
  if (off) return off;
  try {
    const billing = await getBilling();
    if (!billing) return Response.json({ error: "billing_disabled", message: BILLING_DISABLED_MESSAGE }, { status: 404 });

    const body = await readCapped(request, WEBHOOK_BODY_BYTES);
    if (body === null) return Response.json({ error: "too_large" }, { status: 413, headers: { "cache-control": "no-store" } });

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return await billing.handleWebhook(new Request(request.url, { method: "POST", headers, body }));
  } catch (error) {
    // Misconfiguration (a missing secret) or an outage: 500 so Polar retries, and the log says why.
    console.error("[billing] webhook failed", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return Response.json({ error: "webhook_failed" }, { status: 500 });
  }
}
