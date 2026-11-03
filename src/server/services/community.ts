import "server-only";

//
// Feedback (bug / feature / general / contact form) and the email list.
//

import type { Actor, Feedback, FeedbackKind, FeedbackStatus, Page, Subscriber, SubscriberStatus, User } from "@/core/types";
import { emailSchema, feedbackCreateSchema, feedbackUpdateSchema } from "@/core/schemas";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { recordAudit } from "./audit";
import { ServiceError, parseInput } from "./errors";

/**
 * Public: the contact form and the dashboard's feedback form. Spam control is
 * the caller's (rate limit + honeypot). The email typed into the form wins —
 * it is where the reply goes — and a signed-in person's account email fills in
 * only when the field was left empty (the dashboard form has none). The user
 * link always comes from the session.
 */
export async function submitFeedback(input: unknown, user: User | null): Promise<Feedback> {
  assertNotDemo(user);
  const parsed = parseInput(feedbackCreateSchema, input);
  if (!user && !parsed.email) throw new ServiceError("invalid", "An email address is required");
  return (await getData()).feedback.create({
    ...parsed,
    userId: user?.id ?? null,
    email: parsed.email ?? user?.email ?? null,
    name: parsed.name ?? user?.name ?? null,
  });
}

export async function listFeedback(query: { status?: FeedbackStatus; kind?: FeedbackKind; userId?: string; limit?: number; cursor?: string | null }): Promise<Page<Feedback>> {
  return (await getData()).feedback.list(query);
}

export async function updateFeedback(id: string, patch: unknown, actor: Actor): Promise<Feedback> {
  assertNotDemo(actor);
  const parsed = parseInput(feedbackUpdateSchema, patch);
  const data = await getData();
  const before = await data.feedback.getById(id);
  if (!before) throw new ServiceError("not_found", `No feedback ${id}`);
  const after = await data.feedback.update(id, parsed);
  await recordAudit(actor, "feedback.update", "feedback", id, { status: before.status, adminNote: before.adminNote }, { status: after.status, adminNote: after.adminNote });
  return after;
}

/**
 * Public: the footer's signup. Idempotent, and it never re-subscribes: an
 * address that unsubscribed comes back with status "unsubscribed", unchanged,
 * because anyone can type anyone's address into a public form. Callers must
 * answer every outcome the same way (new, already on the list, opted out), so
 * the form can't be used to learn who is on the list; `created` and the status
 * are for logs and the admin, never for the response.
 *
 * OPEN DECISION: an opted-out person who really wants back in has no way to
 * do it themselves yet. The trusted path is confirm-by-email — a signed,
 * expiring link mailed to the address, whose click re-subscribes it (a
 * SubscribersRepo.resubscribe and an audited "subscriber.resubscribe"). Not
 * built, and neither the admin nor MCP can re-subscribe an address either:
 * until it exists, an opt-out is final.
 */
export async function subscribe(email: unknown, source: string | null): Promise<{ subscriber: Subscriber; created: boolean }> {
  const parsed = parseInput(emailSchema, email);
  return (await getData()).subscribers.add(parsed, source?.slice(0, 60) ?? null);
}

export async function unsubscribe(email: unknown, actor: Actor | null): Promise<Subscriber | null> {
  assertNotDemo(actor);
  const parsed = parseInput(emailSchema, email);
  const result = await (await getData()).subscribers.unsubscribe(parsed);
  if (result && actor) await recordAudit(actor, "subscriber.unsubscribe", "subscriber", result.id, null, { email: parsed });
  return result;
}

export async function listSubscribers(query: { status?: SubscriberStatus; search?: string; limit?: number; cursor?: string | null }): Promise<Page<Subscriber>> {
  return (await getData()).subscribers.list(query);
}
