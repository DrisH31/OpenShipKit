import "server-only";

//
// /api/api-keys — a signed-in person's API keys (the session, not a key).
//   GET            → { keys }                    newest first, never the key itself
//   POST { name }  → { key, apiKey }  201       the key, shown this once
//
// Mount:
//   // src/app/api/api-keys/route.ts
//   export { GET, POST } from "../../../../examples/usage-api/routes/keys";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser, readJsonObject } from "../../../modules/shared/api";
import { listApiKeys, mintApiKey } from "../service";

export async function GET(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  return json(200, { keys: await listApiKeys(user) });
}

export async function POST(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  const body = await readJsonObject(request, 4 * 1024);
  if (body instanceof Response) return body;
  try {
    return json(201, await mintApiKey(user, body), { "cache-control": "no-store" });
  } catch (error) {
    return apiError(error, "api-keys");
  }
}
