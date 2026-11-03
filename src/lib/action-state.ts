//
// The one shape every dashboard and admin server action returns, for
// useActionState: { ok, message, issues? , ... }.
//
// Rules:
//  - A ServiceError (thrown on purpose by src/server/services) becomes
//    { ok: false, message } with its zod issues, so the form can show each one
//    next to its field. Matched by name, not instanceof, so this file never
//    imports src/server (it is shared with client components).
//  - Anything else is a bug or an outage: logged on the server, and the person
//    sees a plain "something went wrong" — never a stack or a driver message.
//  - `at` changes on every result, so a form can tell two identical results
//    apart (and toast twice).
//  - `data` carries a small plain value back to the form when it needs one
//    (a freshly minted key, a rendered preview). Never anything secret that
//    the person did not just ask for.
//

import { unstable_rethrow } from "next/navigation";

export interface FieldIssue {
  /** Dot path into the submitted value: "items.0.title". "" = the whole value. */
  path: string;
  message: string;
}

export interface ActionState {
  ok: boolean;
  message: string;
  issues?: FieldIssue[];
  /** Milliseconds since epoch when the result was produced; 0 for the initial state. */
  at: number;
  data?: Record<string, string | number | boolean | null | string[]>;
}

export const IDLE: ActionState = { ok: false, message: "", at: 0 };

export function success(message: string, data?: ActionState["data"]): ActionState {
  return { ok: true, message, at: Date.now(), ...(data ? { data } : {}) };
}

export function failure(message: string, issues?: FieldIssue[]): ActionState {
  return { ok: false, message, issues, at: Date.now() };
}

interface ServiceErrorLike {
  name: string;
  code: string;
  message: string;
  details?: unknown;
}

export function isServiceError(error: unknown): error is ServiceErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ServiceError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

const PLAIN: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Too small: expected string to have >=?(\d+) characters?$/, (m) => (m[1] === "1" ? "This can’t be empty." : `Use at least ${m[1]} characters.`)],
  [/^Too big: expected string to have <=?(\d+) characters?$/, (m) => `Use ${m[1]} characters or fewer.`],
  [/^Too small: expected number to be >=?(-?[\d.]+)$/, (m) => `Use ${m[1]} or more.`],
  [/^Too big: expected number to be <=?(-?[\d.]+)$/, (m) => `Use ${m[1]} or less.`],
  [/^Too small: expected array to have >=?(\d+) items?$/, (m) => `Add at least ${m[1]}.`],
  [/^Too big: expected array to have <=?(\d+) items?$/, (m) => `${m[1]} at most. Remove some.`],
  [/^Invalid input: expected (string|number|boolean|object|array), received (undefined|null)$/, () => "This is required."],
  [/^Invalid input: expected int, received number$/, () => "Use a whole number."],
  [/^Invalid input: expected number, received NaN$/, () => "Enter a number."],
  [/^Invalid (email|email address)$/i, () => "Enter a valid email address."],
  [/^Invalid ISO datetime$/, () => "Enter a date and time."],
  [/^Invalid option: expected one of (.+)$/, (m) => `Choose one of ${m[1].replace(/\|/g, ", ")}.`],
  [/^Invalid string: must match pattern/, () => "That format isn’t allowed here."],
];

/** zod's default messages ("Too small: expected string to have >=3 characters") in plain words. Custom messages pass through. */
export function plainIssue(message: string): string {
  for (const [re, say] of PLAIN) {
    const m = message.match(re);
    if (m) return say(m);
  }
  return message;
}

function issuesFrom(details: unknown): FieldIssue[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const out = details
    .filter((d): d is { path: unknown; message: unknown } => typeof d === "object" && d !== null && "message" in d)
    .map((d) => ({ path: typeof d.path === "string" ? d.path : "", message: plainIssue(String(d.message)) }));
  return out.length ? out : undefined;
}

/**
 * Turn whatever a service threw into a result the form can show. `context`
 * labels the server log line ("admin.content.update").
 */
export function failureFrom(error: unknown, context: string): ActionState {
  if (isServiceError(error)) {
    const issues = issuesFrom(error.details);
    if (!issues) return failure(error.message);
    // The fields say what is wrong; the summary says where to look.
    if (issues.length === 1 && issues[0].path === "") return failure(issues[0].message, issues);
    return failure(issues.length === 1 ? "Check the highlighted field." : `Check the ${issues.length} highlighted fields.`, issues);
  }
  console.error(`[action] ${context} failed`, error);
  return failure("Something went wrong on our side, and nothing was saved. Try again in a minute.");
}

/**
 * The body of most server actions: run `fn`, return its sentence (and any
 * `data` for the form) as a success,
 * or turn what it threw into a failure. Next's own control-flow throws
 * (redirect, notFound) pass straight through.
 */
export async function attempt(
  context: string,
  fn: () => Promise<string | { message: string; data?: ActionState["data"] }>,
): Promise<ActionState> {
  try {
    const out = await fn();
    return typeof out === "string" ? success(out) : success(out.message, out.data);
  } catch (error) {
    unstable_rethrow(error);
    return failureFrom(error, context);
  }
}

/** The issue messages for one field path (exact match). */
export function issuesAt(issues: FieldIssue[] | undefined, path: string): string[] {
  return (issues ?? []).filter((i) => i.path === path).map((i) => i.message);
}
