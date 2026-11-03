import "server-only";

//
// GET /api/ai/usage → { chat, image, unmetered, freePerDay, usedToday, remainingToday, resetsInSeconds }
//
// So the UI can show the allowance before someone hits it, not only when
// they're refused. Reads only; a server component can call getAiUsage(user)
// from modules/ai/service.ts directly instead.
//
// Mount:
//   // src/app/api/ai/usage/route.ts
//   export { GET } from "../../../../../modules/ai/routes/usage";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser } from "../../shared/api";
import { getAiUsage } from "../service";

export async function GET(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  try {
    return json(200, await getAiUsage(user));
  } catch (error) {
    return apiError(error, "ai");
  }
}
