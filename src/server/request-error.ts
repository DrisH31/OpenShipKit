import "server-only";

//
// What src/instrumentation.ts's onRequestError does with an error Next.js
// caught: one log line with the route, then a report to ERROR_TRACKING_DSN if
// it is set. Awaited (Next's guidance), and reporting already gives up on its
// own after a few seconds.
//
// The path is logged without its query string: reset and verification tokens
// travel there.
//

import { reportError } from "./error-reporting";
import { write } from "./log";

type RequestInfo = { path: string; method: string };
type ContextInfo = { routePath: string; routeType: string };

export async function logRequestError(error: unknown, request: RequestInfo, context: ContextInfo): Promise<void> {
  const path = request.path.split("?")[0];
  const where = { method: request.method, path, route: context.routePath, kind: context.routeType };
  // Not log.error: it would report too, without the route. One line here, one report with the route.
  write("error", "request", `${context.routeType} ${request.method} ${path} failed (${context.routePath})`, error);
  await reportError({ scope: "request", message: `${request.method} ${context.routePath}`, error, request: where });
}
