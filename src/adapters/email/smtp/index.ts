import "server-only";

//
// EMAIL_PROVIDER=smtp: any SMTP server or relay (on automatically when SMTP_URL
// is set and RESEND_API_KEY isn't). Your own Postfix or Stalwart, or Amazon
// SES, Postmark, Mailgun, Brevo, Fastmail or a Google Workspace relay, through
// their SMTP endpoint.
//
//   SMTP_URL    smtps://user:password@smtp.example.com:465   (TLS from the first byte)
//               smtp://user:password@smtp.example.com:587    (STARTTLS, required)
//               Percent-encode @ : / in the user name or password.
//   EMAIL_FROM  "Name <hello@your-domain>" on a domain the server may send for
//               (SPF + DKIM; docs/email.md). Required in production.
//
// Non-obvious rules:
//  - TLS is required for every host but this machine: with smtp:// the server
//    must offer STARTTLS, or nothing is sent. Otherwise one misconfigured port
//    sends the password, and every reset link, in plain text.
//  - A send that fails before the server accepts it (a 4xx reply, a dropped
//    connection, a timeout) is retried ONCE. SMTP has no idempotency key, so a
//    connection lost after the server accepted the message can, rarely, send it
//    twice. That is better than a sign-in link that never arrives.
//  - Errors never carry the recipient, the body or the password: provider text
//    is redacted, and the URL itself is never logged or thrown.
//  - Messages are only ever our own templates, but file and URL access stay
//    off anyway (nodemailer can otherwise read a path or fetch a URL named in
//    a message).
//

import { createTransport } from "nodemailer";
import type { EmailMessage, EmailProvider } from "@/core/email";
import { emailFrom, requireEnv } from "@/server/env";
import { parseSmtpUrl } from "@/server/env-rules";
import { redact } from "../redact";

/** The part of a nodemailer transport this adapter uses, which is what tests fake. */
export interface SmtpTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<{ messageId?: string }>;
}

export interface SmtpProviderOptions {
  /** Inject a transport (tests). Defaults to nodemailer, built from SMTP_URL on first send. */
  transport?: SmtpTransport;
  /** Wait before the one retry, in ms (tests pass 0). Default 1000. */
  retryDelayMs?: number;
}

type SmtpError = Error & { code?: string; responseCode?: number };

const TRANSIENT_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"]);

function isTransient(error: SmtpError): boolean {
  if (typeof error.responseCode === "number") return error.responseCode >= 400 && error.responseCode < 500;
  return TRANSIENT_CODES.has(error.code ?? "");
}

/** What to do about the common setup mistakes, appended to the thrown message. */
function hintFor(error: SmtpError): string {
  switch (error.code) {
    case "EAUTH":
    case "ENOAUTH":
      return " Check the user name and password in SMTP_URL (percent-encode @ : / in them).";
    case "ETLS":
      return " TLS failed: use smtps:// with port 465, or smtp:// with port 587.";
    case "EDNS":
      return " The SMTP host doesn't resolve: check the host in SMTP_URL.";
    case "ECONNECTION":
    case "ETIMEDOUT":
    case "ESOCKET":
      return " The server couldn't be reached: check the host and port, and that your host doesn't block outgoing SMTP ports.";
    case "EENVELOPE":
      return " The server refused the sender or recipient: EMAIL_FROM must be an address it may send for.";
    default:
      return "";
  }
}

/** SMTP as the app's EmailProvider. Lazy: the build and the registry never need SMTP_URL. */
export function createSmtpProvider(options: SmtpProviderOptions = {}): EmailProvider {
  let transport: SmtpTransport | null = options.transport ?? null;
  const smtp = (): SmtpTransport =>
    (transport ??= createTransport({
      ...parseSmtpUrl(requireEnv("SMTP_URL", "sending email over SMTP")),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    }));
  const retryDelayMs = options.retryDelayMs ?? 1_000;

  return {
    id: "smtp",
    async send(message: EmailMessage) {
      const mail = {
        from: emailFrom(),
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      };
      let lastError: SmtpError | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const info = await smtp().sendMail(mail);
          return { id: info.messageId ?? null };
        } catch (error) {
          lastError = error as SmtpError;
          if (attempt === 0 && isTransient(lastError)) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          else break;
        }
      }
      const e = lastError!;
      const detail = [e.code, e.responseCode ? `SMTP ${e.responseCode}` : null].filter(Boolean).join(", ");
      const text = redact(e.message ?? "unknown error").trim();
      const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
      throw new Error(`SMTP didn't send the email${detail ? ` (${detail})` : ""}: ${sentence}${hintFor(e)}`);
    },
  };
}
