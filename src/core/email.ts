//
// The email contract:
//
//   src/adapters/email/resend   — Resend (RESEND_API_KEY), for production mail
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

export interface EmailProvider {
  readonly id: EmailProviderId;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}
