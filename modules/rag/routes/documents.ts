import "server-only";

//
// /api/rag/documents
//   GET                              → { documents }       the caller's own, newest first
//   POST { title, content, source? } → { document }  201   chunk, embed, store (audited)
//
// Mount:
//   // src/app/api/rag/documents/route.ts
//   export { GET, POST } from "../../../../../modules/rag/routes/documents";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser, readJsonObject } from "../../shared/api";
import { ragConfig } from "../config";
import { addDocument, listDocuments } from "../service";

export async function GET(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  try {
    return json(200, { documents: await listDocuments(user) });
  } catch (error) {
    return apiError(error, "rag");
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  try {
    // Up to 3 bytes per character (non-Latin scripts) plus the JSON around it,
    // so the documented RAG_MAX_DOCUMENT_CHARS is reachable through this route.
    const body = await readJsonObject(request, ragConfig().maxDocumentChars * 3 + 16 * 1024);
    if (body instanceof Response) return body;
    return json(201, { document: await addDocument(user, body, request.signal) });
  } catch (error) {
    return apiError(error, "rag");
  }
}
