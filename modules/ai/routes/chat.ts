import "server-only";

//
// POST /api/ai/chat — { messages: [{ role: "user" | "assistant", content }] } → { text, remainingToday }
//
// Signed in, same-origin, a capped JSON body; the service owns the model
// list, the limits, the quota and the provider key. Don't send `model` from
// the browser: the server's default is used, and a client that names one
// breaks the day the allowlist changes.
//
// Every refusal is `{ error, message }`; 429 and 503 carry Retry-After.
//
// Mount (modules/ai/README.md, "Enable"):
//   // src/app/api/ai/chat/route.ts
//   export { POST } from "../../../../../modules/ai/routes/chat";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser, readJsonObject } from "../../shared/api";
import { generateChat } from "../service";

/** 32 messages of a few KB each, with room for JSON escaping. */
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  try {
    return json(200, await generateChat(user, body, { signal: request.signal }));
  } catch (error) {
    return apiError(error, "ai");
  }
}
