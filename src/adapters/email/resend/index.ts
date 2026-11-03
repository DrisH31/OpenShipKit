import "server-only";

//
// EMAIL_PROVIDER=resend — Resend's API (on automatically when RESEND_API_KEY is set).
//
//   RESEND_API_KEY  re_… — a "Sending access" key is enough (Resend → API Keys)
//   EMAIL_FROM      "Name <hello@mail.your-domain>" on a domain verified in Resend
//                   (SPF + DKIM records; see docs). The default onboarding@resend.dev
//                   only delivers to the address that owns the Resend account.
//
// Non-obvious rules:
//  - The SDK returns { data, error } instead of throwing. We throw, so a failed
//    sign-in link never looks like a sent one, and the caller sees the reason.
//  - Every send carries an Idempotency-Key (the caller's, or one made per send),
//    and a transient failure (rate limit, 5xx, network) is retried ONCE with the
//    same key — Resend then never delivers the message twice.
//  - No PII in logs or errors: never the recipient, the body or the key. Resend's
//    own messages can quote an address, so email-like text is redacted.
//

import { randomUUID } from "node:crypto";
import { Resend, type CreateEmailOptions, type CreateEmailRequestOptions, type CreateEmailResponse, type ErrorResponse } from "resend";
import type { EmailMessage, EmailProvider } from "@/core/email";
import { emailFrom, isProduction, requireEnv } from "@/server/env";

/** The subset of the Resend client this adapter uses — what tests fake. */
export interface ResendClient {
  emails: { send(payload: CreateEmailOptions, options?: CreateEmailRequestOptions): Promise<CreateEmailResponse> };
}

export interface ResendProviderOptions {
  /** Inject a client (tests). Defaults to the real SDK client, created on first send. */
  client?: ResendClient;
  /** Wait before the one retry, in ms (tests pass 0). Default 750. */
  retryDelayMs?: number;
}

/** A message may carry its own idempotency key (e.g. derived from a job id); otherwise one is made per send. */
type KeyedMessage = EmailMessage & { idempotencyKey?: string };

/** Error names worth one retry: Resend says "try again", or the request never got an answer. */
const TRANSIENT = new Set<ErrorResponse["name"]>([
  "rate_limit_exceeded",
  "concurrent_idempotent_requests",
  "internal_server_error",
  "application_error",
]);

function isTransient(error: ErrorResponse): boolean {
  return TRANSIENT.has(error.name) || (error.statusCode !== null && error.statusCode >= 500);
}

/** Redact anything that looks like an email address or an API key from provider text. */
export function redact(text: string): string {
  return text.replace(/[^\s<>"'`(),;:]+@[^\s<>"'`(),;:]+/g, "[address]").replace(/\bre_[A-Za-z0-9_]{6,}/g, "re_[redacted]");
}

/** What to do about the common setup mistakes, appended to the thrown message. */
function hintFor(error: ErrorResponse): string {
  const message = error.message.toLowerCase();
  if (error.name === "missing_api_key" || error.name === "invalid_api_key") return " Check RESEND_API_KEY.";
  if (error.name === "restricted_api_key") return " The key can't send email: create one with Sending access.";
  if (message.includes("testing emails") || message.includes("own email address")) {
    return " Without a verified domain Resend only delivers to your own address: verify one and set EMAIL_FROM on it.";
  }
  if (error.name === "invalid_from_address" || message.includes("not verified")) {
    return " Set EMAIL_FROM to an address on a domain verified in Resend (Resend → Domains).";
  }
  if (error.name === "daily_quota_exceeded" || error.name === "monthly_quota_exceeded") return " Your Resend plan's quota is used up.";
  return "";
}

let warnedDefaultFrom = false;

/** Resend as the app's EmailProvider. Lazy: the build and the registry never need the key. */
export function createResendProvider(options: ResendProviderOptions = {}): EmailProvider {
  let client: ResendClient | null = options.client ?? null;
  const resend = (): ResendClient => (client ??= new Resend(requireEnv("RESEND_API_KEY", "sending email with Resend")));
  const retryDelayMs = options.retryDelayMs ?? 750;

  return {
    id: "resend",
    async send(message: KeyedMessage) {
      const from = emailFrom();
      if (isProduction() && from.includes("@resend.dev") && !warnedDefaultFrom) {
        warnedDefaultFrom = true;
        console.warn("[email:resend] EMAIL_FROM is a resend.dev address; it only delivers to your own inbox. Verify a domain and set EMAIL_FROM.");
      }
      const payload: CreateEmailOptions = {
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      };
      const requestOptions: CreateEmailRequestOptions = { idempotencyKey: message.idempotencyKey ?? `openshipkit-${randomUUID()}` };

      let result = await resend().emails.send(payload, requestOptions);
      if (result.error && isTransient(result.error)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        result = await resend().emails.send(payload, requestOptions);
      }
      if (result.error) {
        const { name, statusCode } = result.error;
        throw new Error(
          `Resend didn't send the email (${name}${statusCode ? `, HTTP ${statusCode}` : ""}): ${redact(result.error.message)}${hintFor(result.error)}`,
        );
      }
      return { id: result.data?.id ?? null };
    },
  };
}
