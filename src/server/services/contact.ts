import "server-only";

//
// The contact form's write path, once, for both doors: the route (POST
// /api/forms/contact, for fetch and JSON callers) and the page's server action
// (src/app/(marketing)/contact/actions.ts, which the form itself uses, with or
// without JavaScript). Each caller checks the origin its own way first; both
// share the rate limit, the honeypot, storage and the notification here.
//
// Stored as feedback of kind "contact" through the community service (validated
// there), so it shows up in /admin/feedback and to MCP agents. If the site has
// a contact email, a copy is sent there with Reply-To set to the sender.
//

import { CONTACT_MESSAGE_MAX, isContactTopic, topicLabel, type ContactFailure, type ContactValues } from "@/components/site/contact-topics";
import { HONEYPOT } from "@/components/site/form-fields";
import { escapeHtml } from "../email-templates";
import { sendEmail } from "../email";
import { clientIp, rateLimit } from "../rate-limit";
import { isDemoUser } from "../demo";
import { getCurrentUser } from "../session";
import { submitFeedback } from "./community";
import { getContent } from "./content";
import { ServiceError } from "./errors";

export type ContactResult = { ok: true } | { ok: false; error: ContactFailure; retryAfterSeconds?: number };

/** Five messages per network per ten minutes, shared by the route and the action. Check it before reading a body. */
export async function contactRateLimit(): Promise<ContactResult> {
  const limit = rateLimit(`forms:contact:${await clientIp()}`, 5, 10 * 60_000);
  return limit.ok ? { ok: true } : { ok: false, error: "limited", retryAfterSeconds: limit.retryAfterSeconds };
}

/** The submitted fields as the form shows them again: trimmed where the form would, the topic made valid. */
export function contactValues(fields: Record<string, string | undefined>): ContactValues {
  return {
    name: (fields.name ?? "").trim().slice(0, 80),
    email: (fields.email ?? "").trim(),
    topic: isContactTopic(fields.topic) ? fields.topic : "general",
    message: (fields.message ?? "").trim(),
  };
}

/**
 * The sender's account, if any. The read-only demo admin writes as an
 * anonymous visitor here: the contact form is public anyway, and a message
 * linked to the shared demo account would show on its user page to the next
 * visitor (docs/auth.md → "The read-only demo admin").
 */
async function signedInUser() {
  try {
    const user = await getCurrentUser();
    return isDemoUser(user) ? null : user;
  } catch {
    return null; // a contact form must work even when auth is misconfigured
  }
}

async function notify(input: ContactValues): Promise<void> {
  const site = await getContent("site");
  if (!site.contactEmail) return;
  const from = input.name ? `${input.name} <${input.email || "no email"}>` : input.email || "someone";
  const subject = `[${site.name}] ${topicLabel(input.topic)} from ${input.name || input.email || "a visitor"}`.slice(0, 200);
  const text = `${topicLabel(input.topic)}\nFrom: ${from}\n\n${input.message}\n`;
  const html = `<p><strong>${escapeHtml(topicLabel(input.topic))}</strong><br>From: ${escapeHtml(from)}</p><p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>`;
  try {
    await sendEmail({ to: site.contactEmail, subject, text, html, ...(input.email ? { replyTo: input.email } : {}) });
  } catch (error) {
    // Stored already; a mail outage must not turn a delivered message into an error.
    console.error("[forms/contact] notification email failed", error);
  }
}

/** Store one message and send the copy. The rate limit is the caller's (it runs before the body is read). */
export async function deliverContact(fields: Record<string, string | undefined>): Promise<ContactResult> {
  // A filled honeypot is a bot: answer as if it worked, store nothing. Logged without the
  // message, so a false positive (autofill reaching the field) can be noticed.
  if (fields[HONEYPOT]?.trim()) {
    console.info("[forms/contact] honeypot filled: message dropped");
    return { ok: true };
  }

  const values = contactValues(fields);
  if (values.message.length > CONTACT_MESSAGE_MAX) return { ok: false, error: "large" };

  let stored: { name: string | null; email: string | null };
  try {
    stored = await submitFeedback(
      {
        kind: "contact",
        title: topicLabel(values.topic),
        message: values.message,
        email: values.email || null,
        name: values.name || null,
      },
      await signedInUser(),
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === "invalid") return { ok: false, error: "invalid" };
    console.error("[forms/contact] could not store the message", error);
    return { ok: false, error: "server" };
  }

  // The stored row has the signed-in user's email when the field was left empty.
  await notify({ ...values, name: stored.name ?? "", email: stored.email ?? "" });
  return { ok: true };
}
