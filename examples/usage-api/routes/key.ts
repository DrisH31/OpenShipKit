import "server-only";

//
// DELETE /api/api-keys/[id] → 204: revoke one of your keys. Audited. Someone
// else's key, or one already revoked, is 404.
//
// Mount:
//   // src/app/api/api-keys/[id]/route.ts
//   export { DELETE } from "../../../../../examples/usage-api/routes/key";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { apiError, apiUser } from "../../../modules/shared/api";
import { revokeApiKey } from "../service";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  try {
    await revokeApiKey(user, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error, "api-keys");
  }
}
