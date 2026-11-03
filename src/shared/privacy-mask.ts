//
// What the read-only demo admin may see of other people: the ONE place that
// decides. Pure, safe on the client and the server; applied where admin data
// is rendered or serialised (the admin pages, the audit list and diff, the
// overview's recent changes, agent keys' "minted by"), never in the services,
// so a real admin and MCP see exactly what they did before.
//
// A lens is built per request from the viewer (privacyLens() in
// src/server/demo.ts): `masking` is on only for the demo account, and the
// viewer's own address is always shown as is.
//
// The rules, while masking:
//   - an email → its first letter, the first letter of its domain and the
//     top-level domain: "alice@gmail.com" → "a•••@g•••.com". Inside any text
//     (an audit label, a JSON value) every address is masked the same way.
//   - a person's name → each word's first letter: "Alice Smith" → "A••• S•••".
//   - free text a person typed (a feedback or contact message, an admin's
//     private note, a session's IP and browser) → hidden: "[hidden in the demo]".
//     Cutting it short isn't safe enough: a message's first line is often
//     "Hi, I'm <name> from <company>, call me on …".
//   - a feedback title (one line, often a summary) → shown with addresses and
//     phone-like numbers replaced, cut to 80 characters.
//   - audit before/after JSON → every string's addresses masked; for people's
//     records (user, feedback, subscriber) also names masked and free text
//     hidden by key.
// Plan names, post titles, agent key names and content are the site's own
// words, not personal data, and stay as they are.
//

import type { AuditEntry, Feedback } from "@/core/types";

export interface PrivacyLens {
  /** True for the read-only demo viewer: other people's details are masked. */
  readonly masking: boolean;
  /** The viewer's own address (lower case), always shown unmasked. */
  readonly selfEmail: string | null;
}

/** A real admin: nothing masked. */
export const NO_MASK: PrivacyLens = { masking: false, selfEmail: null };

/** What stands in for text a person typed. */
export const HIDDEN_IN_DEMO = "[hidden in the demo]";

const DOTS = "•••";

/** The first character (a whole code point, so an emoji or accent isn't split). */
function firstChar(s: string): string {
  return Array.from(s.trim())[0] ?? "";
}

/** "alice@gmail.com" → "a•••@g•••.com". Not an address → its first character and dots. */
export function maskEmail(email: string): string {
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return value ? `${firstChar(value)}${DOTS}` : value;
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split(".").filter(Boolean);
  const tld = labels.length > 1 ? `.${labels.at(-1)}` : "";
  return `${firstChar(local)}${DOTS}@${firstChar(labels[0] ?? "")}${DOTS}${tld}`;
}

/** "Alice van der Berg" → "A••• v••• d••• B•••". */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${firstChar(word)}${DOTS}`)
    .join(" ");
}

// Deliberately loose: a false positive only masks more.
const EMAIL_IN_TEXT = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
// Seven or more digits with the separators phone numbers use: "+44 20 7946 0958", "(555) 010-9999".
const PHONE_IN_TEXT = /\+?\d(?:[\s().-]*\d){6,}/g;

/** Every email address inside `text` masked; `keep` (the viewer's own) stays. */
export function maskEmailsIn(text: string, keep: string | null = null): string {
  return text.replace(EMAIL_IN_TEXT, (found) => (keep && found.toLowerCase() === keep ? found : maskEmail(found)));
}

/** One line of free text with addresses and phone-like numbers replaced, at most `max` characters. */
export function redactFreeText(text: string, max = 80): string {
  const clean = text.replace(EMAIL_IN_TEXT, "[email]").replace(PHONE_IN_TEXT, "[phone]").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function isSelf(lens: PrivacyLens, email: string): boolean {
  return lens.selfEmail !== null && email.trim().toLowerCase() === lens.selfEmail;
}

/** An address as this viewer may see it. */
export function showEmail(lens: PrivacyLens, email: string): string {
  return !lens.masking || isSelf(lens, email) ? email : maskEmail(email);
}

/** A person's name as this viewer may see it. `ownerEmail`: whose name it is, when known (their own stays). */
export function showName(lens: PrivacyLens, name: string, ownerEmail?: string | null): string {
  if (!lens.masking || (ownerEmail && isSelf(lens, ownerEmail))) return name;
  return maskName(name);
}

/** Text a person typed (a message, a private note) as this viewer may see it. */
export function showFreeText(lens: PrivacyLens, text: string): string {
  return lens.masking ? HIDDEN_IN_DEMO : text;
}

/** A short title a person typed, as this viewer may see it. */
export function showTitle(lens: PrivacyLens, text: string): string {
  return lens.masking ? redactFreeText(text) : text;
}

/** Any text that may carry addresses (a label, an id), with them masked for this viewer. */
export function showText(lens: PrivacyLens, text: string): string {
  return lens.masking ? maskEmailsIn(text, lens.selfEmail) : text;
}

/** Records about people: their names and free text are masked by key, too. */
const PERSONAL_ENTITIES = new Set(["user", "feedback", "subscriber"]);
const NAME_KEYS = new Set(["name"]);
const FREE_TEXT_KEYS = new Set(["message", "adminNote", "ipAddress", "userAgent"]);
const TITLE_KEYS = new Set(["title"]);

function maskValue(lens: PrivacyLens, personal: boolean, value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    if (personal && key !== null && value) {
      if (NAME_KEYS.has(key)) return maskName(value);
      if (FREE_TEXT_KEYS.has(key)) return HIDDEN_IN_DEMO;
      if (TITLE_KEYS.has(key)) return redactFreeText(value);
    }
    return maskEmailsIn(value, lens.selfEmail);
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(lens, personal, v, null));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskValue(lens, personal, v, k)]));
  }
  return value;
}

/** A JSON value from the audit log (before/after) as this viewer may see it. `entity` says whose record it is. */
export function maskJson(lens: PrivacyLens, entity: string, value: unknown): unknown {
  if (!lens.masking) return value;
  return maskValue(lens, PERSONAL_ENTITIES.has(entity), value, null);
}

/** An audit entry as this viewer may see it: the actor's label, the record id and before/after masked. */
export function maskAuditEntry(lens: PrivacyLens, entry: AuditEntry): AuditEntry {
  if (!lens.masking) return entry;
  return {
    ...entry,
    actor: { ...entry.actor, label: showText(lens, entry.actor.label) },
    entityId: entry.entityId === null ? null : showText(lens, entry.entityId),
    before: maskJson(lens, entry.entity, entry.before),
    after: maskJson(lens, entry.entity, entry.after),
  };
}

/** An id → email map (the people audit lines name) as this viewer may see it. */
export function maskEmailMap(lens: PrivacyLens, emails: Readonly<Record<string, string>>): Record<string, string> {
  if (!lens.masking) return { ...emails };
  return Object.fromEntries(Object.entries(emails).map(([id, email]) => [id, showEmail(lens, email)]));
}

/**
 * A feedback or contact message as this viewer may see it: the sender's name
 * and address masked, the title redacted, the message and the private note
 * hidden. `email` stays non-null when there was one, so the layout is the same.
 */
export function maskFeedback(lens: PrivacyLens, f: Feedback): Feedback {
  if (!lens.masking) return f;
  return {
    ...f,
    name: f.name ? showName(lens, f.name, f.email) : null,
    email: f.email ? showEmail(lens, f.email) : null,
    title: f.title ? showTitle(lens, f.title) : null,
    message: showFreeText(lens, f.message),
    adminNote: f.adminNote ? showFreeText(lens, f.adminNote) : null,
  };
}
