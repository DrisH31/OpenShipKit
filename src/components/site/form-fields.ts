//
// Field names the public forms and their routes must agree on. A plain module
// (no "server-only"), so the client forms (contact-form.tsx, newsletter-form.tsx)
// and the routes (src/app/api/forms/*) import the same constant: renaming it in
// one place can't silently switch the honeypot off in the other.
//

/**
 * The honeypot field. Off-screen in the form; a person never fills it, so a filled one is a bot.
 *
 * The name (and its label, in honeypot-field.tsx) means nothing to browser autofill or a
 * password manager on purpose. A field called "company" or "website" is exactly what
 * address autofill fills, even off-screen and with autocomplete="off", and a real
 * message would then be thrown away as a bot's.
 */
export const HONEYPOT = "hp_7f3k";
