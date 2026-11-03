//
// ServiceError — the errors a service throws ON PURPOSE, with a code a caller
// can map: admin forms show `message`, the MCP server returns it to the agent,
// route handlers map `status`. Anything else that escapes a service is a bug or
// an outage and is logged, never shown.
//

import { z } from "zod";
import { DataError } from "@/core/data";

export type ServiceErrorCode = "invalid" | "not_found" | "conflict" | "forbidden" | "unavailable" | "rate_limited";

const STATUS: Record<ServiceErrorCode, number> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
};

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
  get status(): number {
    return STATUS[this.code];
  }
}

/** Parse with a zod schema, turning failures into ServiceError("invalid") with readable issues. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const summary = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
    throw new ServiceError("invalid", summary || "Invalid input", issues);
  }
  return result.data;
}

/** Map an adapter's DataError to a ServiceError; rethrow anything else. */
export function fromDataError(error: unknown): never {
  if (error instanceof DataError) {
    throw new ServiceError(error.code === "invalid" ? "invalid" : error.code, error.message);
  }
  throw error;
}

/** A ServiceError as a plain object for JSON replies (never includes a stack). */
export function serializeError(error: ServiceError) {
  return { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
}
