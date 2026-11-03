import "server-only";

//
// POST /api/ai/image — { prompt } → { url, remainingToday }
//
// Same guard chain, deadline and refund rule as ./chat.ts. The URL is the
// provider's: a fal CDN link EXPIRES, an OpenAI-compatible endpoint may hand
// back a data: URI. Nothing is stored — if an image must last, fetch the
// bytes and keep them (an admin's: the media library, uploadMedia() in
// src/server/services/media.ts); a raw provider URL in a database column is
// a page of broken images a few weeks later.
//
// Mount:
//   // src/app/api/ai/image/route.ts
//   export { POST } from "../../../../../modules/ai/routes/image";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser, readJsonObject } from "../../shared/api";
import { generateImage } from "../service";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  try {
    return json(200, await generateImage(user, body, request.signal));
  } catch (error) {
    return apiError(error, "ai");
  }
}
