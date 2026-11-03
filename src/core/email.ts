//
// The email contract:
//
//   src/adapters/email/resend   — Resend (RESEND_API_KEY), for production mail
//   src/adapters/email/smtp     — any SMTP server or relay (SMTP_URL), yours included
//   src/adapters/email/console  — prints to the server log (the default; development)
//
// Templates are plain functions in src/server/email-templates.ts that return
// { subject, html, text } — no email framework to learn.
//

import type { EmailProviderId } from "./types";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Optional: the same key within 24 h means Resend sends once (derive it from a job or token id). */
  idempotencyKey?: string;
}

/**
 * A provider's refusal. `permanent` means trying again can't help (a wrong
 * password, a refused address, a bad API key): sendEmail() reports it to the
 * caller instead of queuing a retry. Anything else a provider throws counts as
 * transient (an outage, a timeout, a rate limit).
 */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export const isPermanentEmailError = (error: unknown): boolean => error instanceof EmailDeliveryError && error.permanent;

export interface EmailProvider {
  readonly id: EmailProviderId;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}
