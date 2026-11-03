import "server-only";

//
// sendEmail() — the one way the app sends mail: Resend when RESEND_API_KEY is
// set, your own SMTP server when SMTP_URL is, otherwise the console provider
// prints each message to the server log
// (development: copy sign-up and reset links from the terminal). Templates live
// in src/server/email-templates.ts.
//
// It sends straight away. If that fails (a provider outage, a rate limit, an
// SMTP server that's down), the message is queued as an email.send background
// job (src/server/jobs/email.ts) and retried for a few minutes, and the caller
// sees success: the email is on its way. Only when it can't even be queued
// does sendEmail throw. Every message gets an idempotency key before the
// first attempt, so a retry is never a second Resend delivery.
//

import { randomUUID } from "node:crypto";
import type { EmailMessage, EmailProvider } from "@/core/email";
import { emailProvider } from "./env";
import { log } from "./log";

let provider: Promise<EmailProvider> | null = null;

function getEmail(): Promise<EmailProvider> {
  if (!provider) {
    provider = (async () => {
      const id = emailProvider();
      if (id === "resend") return (await import("@/adapters/email/resend")).createResendProvider();
      if (id === "smtp") return (await import("@/adapters/email/smtp")).createSmtpProvider();
      return (await import("@/adapters/email/console")).createConsoleProvider();
    })();
  }
  return provider;
}

/** One attempt through the provider, no retries. The email.send job calls this. */
export async function deliverEmail(message: EmailMessage): Promise<{ id: string | null }> {
  return (await getEmail()).send(message);
}

/** Sends now, or queues a retry when the provider fails. `queued` says which. */
export async function sendEmail(message: EmailMessage): Promise<{ id: string | null; queued?: true }> {
  const keyed: EmailMessage = { ...message, idempotencyKey: message.idempotencyKey ?? `openshipkit-${randomUUID()}` };
  try {
    return await deliverEmail(keyed);
  } catch (error) {
    try {
      const { enqueueJob } = await import("./jobs");
      const { emailJob } = await import("./jobs/email");
      const { job } = await enqueueJob(emailJob, keyed);
      log.warn("email", `send failed; queued as job ${job.id} to retry`, error);
      return { id: null, queued: true };
    } catch (queueError) {
      log.error("email", "send failed and couldn't be queued for a retry", queueError);
      throw error;
    }
  }
}
