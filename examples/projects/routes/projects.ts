import "server-only";

//
// /api/orgs/[orgId]/projects
//   GET             → { projects }        the organisation's, newest first (any member)
//   POST { name }   → { project }  201    within the plan's `projects` limit (any member)
//
// A full plan is 409 { error: "conflict", details: { reason: "limit_reached", limit, used } }.
// Not a member: 404 (a 403 would confirm the organisation exists).
//
// Mount:
//   // src/app/api/orgs/[orgId]/projects/route.ts
//   export { GET, POST } from "../../../../../../examples/projects/routes/projects";
//   export const runtime = "nodejs";
//   export const dynamic = "force-dynamic";
//

import { json } from "@/server/http";
import { apiError, apiUser, readJsonObject } from "../../../modules/shared/api";
import { createProject, listProjects } from "../service";

type Ctx = { params: Promise<{ orgId: string }> };

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  try {
    return json(200, { projects: await listProjects(user, (await params).orgId) });
  } catch (error) {
    return apiError(error, "projects");
  }
}

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  const body = await readJsonObject(request, 16 * 1024);
  if (body instanceof Response) return body;
  try {
    return json(201, { project: await createProject(user, (await params).orgId, body) });
  } catch (error) {
    return apiError(error, "projects");
  }
}
