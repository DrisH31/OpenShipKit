"use server";

//
// The contact form's server action. The form calls it through useActionState,
// so it works the same with JavaScript off: the browser posts to /contact, Next
// runs this, and the page renders with the answer — and, on a failure, with
// the name, email, topic and message filled back in (nothing typed is lost to a
// rate limit or an outage).
//
// Next checks the Origin of every server action post against the host, so the
// cross-site check the route does by hand is built in here. The rest (rate
// limit, honeypot, storage, notification) is shared with the route:
// src/server/services/contact.ts.
//

import type { ContactState } from "@/components/site/contact-topics";
import { contactRateLimit, contactValues, deliverContact } from "@/server/services/contact";

export async function sendContactMessage(_prev: ContactState, form: FormData): Promise<ContactState> {
  const fields: Record<string, string> = {};
  for (const [key, value] of form) if (typeof value === "string" && !key.startsWith("$ACTION")) fields[key] = value;
  const values = contactValues(fields);

  const limit = await contactRateLimit();
  const result = limit.ok ? await deliverContact(fields) : limit;
  return result.ok
    ? { sent: true, error: null, at: Date.now() }
    : { sent: false, error: result.error, values, at: Date.now() };
}
