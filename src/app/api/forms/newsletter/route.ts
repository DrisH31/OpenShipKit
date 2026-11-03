//
// POST /api/forms/newsletter — the footer's email signup.
//
// Takes `email` (and the honeypot, and `redirect`: the page the form was on) as
// a form post or JSON. Stored through the community service with source
// "footer". Signing up twice is not an error, and the answer never says whether
// the address was already known or had unsubscribed (it stays unsubscribed:
// see below). Form posts get a 303 back to the page with
// ?newsletter=ok|invalid|limited|error#newsletter; fetch callers get JSON
// { ok, status }.
//
// Order: Origin, then the rate limit, then the body (read with a 64 KB cap),
// so a cross-site or flooding caller is refused before anything is buffered.
// Those two early answers go back to the page in the Referer (same origin only).
//

import { clientIp, rateLimit } from "@/server/rate-limit";
import { subscribe } from "@/server/services/community";
import { ServiceError } from "@/server/services/errors";
import { isSameOrigin, json, readFields, refererPath, safeReturnPath, seeOther, wantsJson, withParam } from "@/server/http";
import { HONEYPOT } from "@/components/site/form-fields";
import { log } from "@/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "ok" | "invalid" | "limited" | "error" | "forbidden";
const HTTP: Record<Status, number> = { ok: 200, invalid: 400, limited: 429, error: 500, forbidden: 403 };

export async function POST(request: Request): Promise<Response> {
  const asJson = wantsJson(request);
  let back = "/";

  const answer = (status: Status, extra: Record<string, unknown> = {}) =>
    asJson
      ? json(HTTP[status], { ok: status === "ok", status, ...extra })
      : seeOther(withParam(back, "newsletter", status === "forbidden" ? "error" : status, "newsletter"));

  // Both before the body is read: nothing is buffered for a cross-site or flooding caller.
  if (!isSameOrigin(request)) return answer("forbidden");
  back = refererPath(request, "/");
  const limit = rateLimit(`forms:newsletter:${await clientIp()}`, 5, 10 * 60_000);
  if (!limit.ok) return answer("limited", { retryAfterSeconds: limit.retryAfterSeconds });

  const fields = await readFields(request);
  if (fields === null) return answer("invalid"); // over 64 KB: no email address is that long
  back = safeReturnPath(fields.redirect, back);
  if (fields[HONEYPOT]?.trim()) {
    // A bot: say yes, store nothing. Logged (without the address), so a false positive can be seen.
    log.info("forms/newsletter", "honeypot filled: signup dropped");
    return answer("ok");
  }

  try {
    const { subscriber } = await subscribe(fields.email ?? "", "footer");
    if (subscriber.status === "unsubscribed") {
      // Signed up again after unsubscribing: the store keeps the opt-out until the person confirms
      // through a flow the app trusts (an emailed, signed link; not built yet). The answer is the
      // same as for anyone else, so the form never reveals who once opted out. Logged without the
      // address, so the owner can see it happen.
      log.info("forms/newsletter", "signup for an unsubscribed address: left unsubscribed");
    }
    // No `created` either: whether an address was already on the list is not the caller's business.
    return answer("ok");
  } catch (error) {
    if (error instanceof ServiceError && error.code === "invalid") return answer("invalid");
    log.error("forms/newsletter", "could not subscribe", error);
    return answer("error");
  }
}
