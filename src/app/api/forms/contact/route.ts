//
// POST /api/forms/contact — the contact endpoint for scripts and fetch callers.
//
// Takes name, email, topic, message (and the honeypot) as a form post or JSON.
// The /contact page's own form doesn't post here: it uses a server action
// (src/app/(marketing)/contact/actions.ts), so a failed send without JavaScript
// re-renders the form with what was typed. Both share
// src/server/services/contact.ts: the rate limit, the honeypot, storage as feedback of kind "contact", and the copy to
// the site's contact email.
//
// Fetch callers get JSON { ok } or { ok: false, error, message }. A plain form
// post (an old page, a hand-written form) still gets a 303 to /contact?sent=1
// or /contact?error=<code>.
//
// Order: Origin, then the rate limit, then the body (read with a 64 KB cap),
// so a cross-site or flooding caller is refused before anything is buffered.
//

import { CONTACT_FAILURE_MESSAGES, isContactTopic, type ContactFailure, type ContactTopic } from "@/components/site/contact-topics";
import { isSameOrigin, json, readFields, seeOther, wantsJson, withParam } from "@/server/http";
import { contactRateLimit, deliverContact } from "@/server/services/contact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<ContactFailure, number> = { forbidden: 403, invalid: 400, large: 413, limited: 429, server: 500 };

export async function POST(request: Request): Promise<Response> {
  const asJson = wantsJson(request);
  let topic: ContactTopic = "general";

  const fail = (code: ContactFailure, retryAfter?: number) =>
    asJson
      ? json(STATUS[code], { ok: false, error: code, message: CONTACT_FAILURE_MESSAGES[code] }, retryAfter ? { "Retry-After": String(retryAfter) } : {})
      : seeOther(withParam(withParam("/contact", "topic", topic), "error", code, "contact-form"));
  const ok = () => (asJson ? json(200, { ok: true }) : seeOther("/contact?sent=1#contact-form"));

  // Both before the body is read: nothing is buffered for a cross-site or flooding caller.
  if (!isSameOrigin(request)) return fail("forbidden");
  const limit = await contactRateLimit();
  if (!limit.ok) return fail(limit.error, limit.retryAfterSeconds);

  const fields = await readFields(request);
  if (fields === null) return fail("large");
  if (isContactTopic(fields.topic)) topic = fields.topic;

  const result = await deliverContact(fields);
  return result.ok ? ok() : fail(result.error, result.retryAfterSeconds);
}
