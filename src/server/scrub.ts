import "server-only";

//
// Error text made safe to leave the process, in a log line or a tracker
// event. drizzle-orm wraps every failed query, a dropped connection included,
// in an error whose message ends with the query's parameters:
//
//   Failed query: select … where "token" = $1
//   params: 3f9c…the session token…
//
// Those values are session tokens, reset identifiers, emails and IP
// addresses. The SQL stays (placeholders only, and it says what failed); the
// values never leave. ./log.ts and ./error-reporting.ts pass everything
// through here.
//

const PARAMS = "\nparams:";
const REDACTED = "\nparams: [redacted]";

/** A message without a failed query's parameter values. */
export function scrubText(text: string): string {
  const i = text.indexOf(PARAMS);
  return i === -1 ? text : text.slice(0, i) + REDACTED;
}

/** A stack without them: the params line(s) up to the first frame go. */
export function scrubStack(stack: string): string {
  const i = stack.indexOf(PARAMS);
  if (i === -1) return stack;
  const frame = stack.indexOf("\n    at ", i);
  return stack.slice(0, i) + REDACTED + (frame === -1 ? "" : stack.slice(frame));
}

/**
 * A copy of an error that is safe to print: the same name, code and digest,
 * with the message, stack and cause chain scrubbed. Anything else on the error
 * (drizzle's `params`, pg's `detail` with a row's values) is left behind.
 */
export function scrubError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return typeof error === "string" ? scrubText(error) : error;
  const copy = new Error(scrubText(error.message));
  copy.name = error.name;
  copy.stack = error.stack ? scrubStack(error.stack) : undefined;
  for (const key of ["code", "digest"] as const) {
    const value = (error as unknown as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "number") (copy as unknown as Record<string, unknown>)[key] = value;
  }
  if (error.cause !== undefined && depth < 3) copy.cause = scrubError(error.cause, depth + 1);
  return copy;
}
