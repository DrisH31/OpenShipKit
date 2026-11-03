"use client";

//
// The contact form. Its action is the page's server action (sendContactMessage,
// passed in as `action`) through useActionState, so it works with JavaScript off: the browser posts the form
// to /contact and the page renders with the answer. A failure, with or without
// JavaScript, comes back with what was typed and the form fills it in again,
// so a rate limit or an outage never costs the person their message. With
// JavaScript the answer replaces the form in place.
//
// `initial` still reads /contact?sent=1 or ?error=<code>, which the JSON route
// (/api/forms/contact) redirects a plain form post to.
//
// Native controls throughout (a <select>, not a custom listbox): they submit
// without JavaScript and every phone gives them its own picker.
//
// Focus (WCAG 2.4.3): when the answer replaces the form, focus moves to the
// "Message sent" heading, not back to <body>; on an "invalid" answer it moves
// to the first field to fix, which carries the error as its description.
//

import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CONTACT_FAILURE_MESSAGES,
  CONTACT_MESSAGE_MAX,
  CONTACT_TOPICS,
  isContactFailure,
  type ContactState,
  type ContactTopic,
} from "./contact-topics";
import { HoneypotField } from "./honeypot-field";

const label = "text-small font-semibold text-ink";
const field = "bg-surface";

export function ContactForm({
  action,
  initial,
  defaultEmail = "",
  defaultName = "",
}: {
  /** The page's server action (src/app/(marketing)/contact/actions.ts), passed in so src/components never imports src/app. */
  action: (prev: ContactState, form: FormData) => Promise<ContactState>;
  initial: { sent: boolean; error: string | null; topic: ContactTopic };
  defaultEmail?: string;
  defaultName?: string;
}) {
  const [state, formAction, sending] = useActionState(action, {
    sent: initial.sent,
    error: isContactFailure(initial.error) ? initial.error : null,
    at: 0,
  } satisfies ContactState);
  // "Send another message" hides the answer it was shown with (by its `at`), without a round trip.
  const [dismissed, setDismissed] = useState(-1);
  const sent = state.sent && state.at !== dismissed;
  // The error clears while a new send is on its way, so the same answer twice is announced twice.
  const error = sending ? null : state.error;
  const values = state.values;

  // Only an answer this visit produced moves focus. The first state (a ?sent=1 or ?error= load,
  // or the answer a no-JavaScript post rendered) keeps the page's own start.
  const shownAt = useRef(state.at);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const messageField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.at === shownAt.current) return;
    shownAt.current = state.at;
    if (state.sent) sentHeading.current?.focus();
    else if (state.error === "large") messageField.current?.focus();
    else if (state.error === "invalid") {
      const email = emailField.current;
      (email && !email.value.trim() ? email : (messageField.current ?? email))?.focus();
    }
  }, [state]);

  if (sent) {
    return (
      <div id="contact-form" role="status" className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-card p-6 sm:p-8">
        <CircleCheckIcon aria-hidden className="size-6 text-positive" />
        <h2 ref={sentHeading} tabIndex={-1} className="font-display text-h3 font-bold text-ink outline-none">
          Message sent
        </h2>
        <p className="max-w-[46ch] text-ink-2">
          Thanks for writing. It’s with a person now, and the reply will go to the email you gave.
        </p>
        <a
          href="/contact"
          onClick={(e) => {
            e.preventDefault();
            setDismissed(state.at);
          }}
          className="inline-flex min-h-11 items-center text-small font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink"
        >
          Send another message
        </a>
      </div>
    );
  }

  return (
    <form
      id="contact-form"
      action={formAction}
      className="relative flex flex-col gap-5 rounded-2xl border border-line bg-card p-6 sm:p-8"
    >
      {error && (
        <p id="contact-error" role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-4 py-3 text-small text-badge-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {CONTACT_FAILURE_MESSAGES[error]}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="contact-name" className={label}>
            Name <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <Input id="contact-name" name="name" autoComplete="name" maxLength={80} defaultValue={values?.name ?? defaultName} className={field} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="contact-email" className={label}>
            Email
          </label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            ref={emailField}
            defaultValue={values?.email ?? defaultEmail}
            aria-invalid={error === "invalid" || undefined}
            aria-describedby={error === "invalid" ? "contact-error" : undefined}
            className={field}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="contact-topic" className={label}>
          What’s it about?
        </label>
        <div className="relative">
          <select
            // A select's default isn't reapplied on a re-render: a new key takes the echoed topic.
            key={state.at}
            id="contact-topic"
            name="topic"
            defaultValue={values?.topic ?? initial.topic}
            className={cn(
              "h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-surface pr-10 pl-3 text-body text-ink transition-[border-color] duration-(--dur-hover) pointer-fine:text-small pointer-coarse:h-11 dark:bg-card",
            )}
          >
            {CONTACT_TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="contact-message" className={label}>
          Message
        </label>
        <Textarea
          id="contact-message"
          name="message"
          required
          minLength={3}
          maxLength={CONTACT_MESSAGE_MAX}
          rows={6}
          ref={messageField}
          defaultValue={values?.message ?? ""}
          aria-invalid={error === "invalid" || error === "large" || undefined}
          aria-describedby={error === "invalid" || error === "large" ? "contact-error" : undefined}
          className={cn(field, "min-h-36")}
        />
      </div>

      <HoneypotField />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-ink-3">We read every message.</p>
        <Button type="submit" size="lg" loading={sending} data-rank="2" className="w-full sm:w-auto">
          Send message
        </Button>
      </div>
    </form>
  );
}
