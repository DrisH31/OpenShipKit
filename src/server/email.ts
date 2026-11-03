import "server-only";

//
// sendEmail() — the one way the app sends mail: Resend when RESEND_API_KEY is
// set, your own SMTP server when SMTP_URL is, otherwise the console provider
// prints each message to the server log
// (development: copy sign-up and reset links from the terminal). Templates live
// in src/server/email-templates.ts.
//

import type { EmailMessage, EmailProvider } from "@/core/email";
import { emailProvider } from "./env";

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

export async function sendEmail(message: EmailMessage): Promise<{ id: string | null }> {
  return (await getEmail()).send(message);
}
