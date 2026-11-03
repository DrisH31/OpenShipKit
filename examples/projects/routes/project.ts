import "server-only";

//
// DELETE /api/orgs/[orgId]/projects/[id] → 204. An admin or owner. Audited.
// Another organisation's project, or a malformed id, is 404.
//
// Mount:
//   // src/app/api/orgs/[orgId]/projects/[id]/route.ts
//   export { DELETE } from "../../../../../../../examples/projects/routes/project";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { apiError, apiUser } from "../../../modules/shared/api";
import { deleteProject } from "../service";

export async function DELETE(request: Request, { params }: { params: Promise<{ orgId: string; id: string }> }): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  try {
    const { orgId, id } = await params;
    await deleteProject(user, orgId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error, "projects");
  }
}
