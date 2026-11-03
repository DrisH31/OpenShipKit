import "server-only";

//
// POST /api/rag/search — { query, limit? } → { results }
//
// Retrieval only, no generation. Worth keeping on its own: it is the honest way
// to debug a wrong answer. Look at what was RETRIEVED before blaming the model —
// most "the AI made it up" reports are a retrieval miss.
//
// Mount:
//   // src/app/api/rag/search/route.ts
//   export { POST } from "../../../../../modules/rag/routes/search";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser, readJsonObject } from "../../shared/api";
import { searchDocuments } from "../service";

export async function POST(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  const body = await readJsonObject(request, 64 * 1024);
  if (body instanceof Response) return body;
  try {
    return json(200, { results: await searchDocuments(user, body, request.signal) });
  } catch (error) {
    return apiError(error, "rag");
  }
}
