//
// The contact form's topics and answers, shared by the form
// (src/components/site/contact-form.tsx), its server action
// (src/app/(marketing)/contact/actions.ts) and its route
// (src/app/api/forms/contact). A plain module, so both server and client code
// can import the values; the failure sentences are written once, here.
//

export const CONTACT_TOPICS = [
  { value: "general", label: "A question" },
  { value: "sales", label: "Sales and plans" },
  { value: "support", label: "Help with my account" },
  { value: "press", label: "Press or partnerships" },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]["value"];

export function isContactTopic(v: unknown): v is ContactTopic {
  return CONTACT_TOPICS.some((t) => t.value === v);
}

export function topicLabel(v: ContactTopic): string {
  return CONTACT_TOPICS.find((t) => t.value === v)?.label ?? "A question";
}

/** Why a message wasn’t taken. The route answers with these; the form says each in plain words. */
export const CONTACT_FAILURES = ["forbidden", "invalid", "large", "limited", "server"] as const;

export type ContactFailure = (typeof CONTACT_FAILURES)[number];

export function isContactFailure(v: unknown): v is ContactFailure {
  return CONTACT_FAILURES.some((f) => f === v);
}

/** Each failure in plain words: the ONE table, shown by the form and returned by the JSON route. */
export const CONTACT_FAILURE_MESSAGES: Record<ContactFailure, string> = {
  forbidden: "This form only accepts messages sent from this site. Reload the page and try again.",
  invalid: "Add your email and a message of at least a few words.",
  large: "That message is too long to send. Shorten it and try again.",
  limited: "Too many messages from this network. Wait a few minutes and try again.",
  server: "Something went wrong on our side, and your message wasn’t sent. Try again in a minute.",
};

/** The longest message the form takes (the feedback schema’s own limit). */
export const CONTACT_MESSAGE_MAX = 5000;

/** What the person typed, echoed back on a failure so nothing has to be typed twice. */
export interface ContactValues {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
}

/** The contact form's useActionState value. `at` changes on every answer, so two identical answers still count. */
export interface ContactState {
  sent: boolean;
  error: ContactFailure | null;
  values?: ContactValues;
  /** Milliseconds since epoch when the answer was produced; 0 for the page's own first state. */
  at: number;
}
