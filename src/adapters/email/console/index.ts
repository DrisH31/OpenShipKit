import "server-only";

//
// EMAIL_PROVIDER=console — prints each message to the server log instead of
// sending it. The default, so sign-up links and password resets work in
// development with nothing configured: copy the link from the terminal.
//
// In production the body is NOT printed: it holds live password-reset,
// magic-link and verification links, and container logs are read by dashboards
// and log shippers. Only To and Subject are logged, with a reminder to set
// RESEND_API_KEY or SMTP_URL. EMAIL_CONSOLE_PRINT_BODIES=true prints bodies
// anyway, for bootstrapping a site before email is set up (turn it off again after).
//

import type { EmailProvider } from "@/core/email";
import { consoleEmailPrintsBodies } from "@/server/env";

export function createConsoleProvider(): EmailProvider {
  return {
    id: "console",
    async send(message) {
      const printBody = consoleEmailPrintsBodies();
      console.info(
        [
          "",
          "──────── email (console provider — not sent) ────────",
          `To:      ${message.to}`,
          `Subject: ${message.subject}`,
          "",
          printBody
            ? message.text
            : "(body withheld in production: it may hold a live sign-in link. Set RESEND_API_KEY or SMTP_URL to send mail, or EMAIL_CONSOLE_PRINT_BODIES=true to print it.)",
          "─────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      return { id: null };
    },
  };
}
