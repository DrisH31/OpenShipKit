import "server-only";

//
// attempt(): the body of most server actions, and failureFrom(), which turns
// what a service threw into the ActionState a form shows
// (src/lib/action-state.ts has the shape and its rules). Server-only because
// an unexpected failure is logged and reported (./log.ts); the client-safe
// half of the contract stays in src/lib/action-state.ts.
//

import { unstable_rethrow } from "next/navigation";
import { failure, isServiceError, plainIssue, success, type ActionState, type FieldIssue } from "@/lib/action-state";
import { log } from "./log";

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
  log.error("action", `${context} failed`, error);
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
