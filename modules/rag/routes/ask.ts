import "server-only";

//
// POST /api/rag/ask — { question } → { answer, sources, remainingToday }
//
// Retrieve, then answer from ONLY what was retrieved. Uses the daily AI quota
// (it generates); refunded unless an answer is delivered. The prompt tells the
// model to say it doesn't know rather than invent — that reduces invention, it
// doesn't prevent it. Show `sources` next to the answer.
//
// Mount:
//   // src/app/api/rag/ask/route.ts
//   export { POST } from "../../../../../modules/rag/routes/ask";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser, readJsonObject } from "../../shared/api";
import { askDocuments } from "../service";

export async function POST(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  const body = await readJsonObject(request, 64 * 1024);
  if (body instanceof Response) return body;
  try {
    return json(200, await askDocuments(user, body, request.signal));
  } catch (error) {
    return apiError(error, "rag");
  }
}
