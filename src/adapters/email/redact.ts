//
// Provider error text, made safe to log and to throw: email providers quote
// addresses ("550 <someone@example.com>: mailbox unavailable") and, now and
// then, the credential they were given. Every email adapter passes provider
// text through redact() before it leaves the adapter.
//

/** Redact credentials in URLs, email addresses and Resend API keys from provider text. */
export function redact(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[credentials]@")
    // An address's local part never holds / [ ], so the [credentials]@host left above isn't taken for one.
    .replace(/[^\s<>"'`(),;:/[\]]+@[^\s<>"'`(),;:]+/g, "[address]")
    .replace(/\bre_[A-Za-z0-9_]{6,}/g, "re_[redacted]");
}
