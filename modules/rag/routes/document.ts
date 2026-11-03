import "server-only";

//
// DELETE /api/rag/documents/[id] → 204. Chunks go with it (ON DELETE CASCADE). Audited.
// Someone else's document, or a malformed id, is 404 — a 403 would confirm it exists.
//
// Mount:
//   // src/app/api/rag/documents/[id]/route.ts
//   export { DELETE } from "../../../../../../modules/rag/routes/document";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//
// `params` is a Promise in the App Router (Next 15+); reading `.id` off it
// without awaiting is `undefined`, and every delete would be a 404.
//

import { apiError, apiUser } from "../../shared/api";
import { deleteDocument } from "../service";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  try {
    const { id } = await context.params;
    await deleteDocument(user, id);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error, "rag");
  }
}
