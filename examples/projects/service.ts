import "server-only";

//
// The projects example: a B2B feature built on the kit the way the kit builds
// its own (AGENTS.md, "Add a service"). Read it as the template for your own
// first feature: everything a real one needs is here, and nothing else.
//
//   - Teams: a project belongs to an organisation (OPENSHIPKIT_TENANCY=org).
//     Membership is checked on every call (orgAccess), and roles decide what
//     each member may do: any member lists and creates; deleting needs an
//     admin, the same rank as inviting people (can(role, "members.invite")).
//   - Plan limits: a plan's `limits.projects` caps how many an organisation
//     may have, held exactly: the store counts and inserts atomically (a
//     count-then-insert in the service lets concurrent creates overshoot).
//     Whose plan: usageSubject, the same rule as everywhere else.
//   - The write path: assertNotDemo first, zod (parseInput), the store, then
//     recordAudit with before and after.
//

import { z } from "zod";
import { can } from "@/core/orgs";
import type { User } from "@/core/types";
import { assertNotDemo } from "@/server/demo";
import { dataProvider } from "@/server/env";
import { recordAudit } from "@/server/services/audit";
import { ServiceError, parseInput } from "@/server/services/errors";
import { orgAccess } from "@/server/services/orgs";
import { limitContext, limitOf, limitReached, usageSubject } from "@/server/services/usage";
import { createMemoryProjectStore, type Project, type ProjectStore } from "./store";

export const projectInputSchema = z.strictObject({ name: z.string().trim().min(1, "Give the project a name.").max(80) });

let memory: ProjectStore | null = null;

/** The store for this deployment: memory with DATA_PROVIDER=memory (and in tests), else Postgres. */
export async function getProjectStore(): Promise<ProjectStore> {
  if (dataProvider() === "memory") return (memory ??= createMemoryProjectStore());
  const { createPostgresProjectStore } = await import("./store-postgres");
  return createPostgresProjectStore();
}

const actor = (user: User) => ({ type: "user" as const, id: user.id, label: user.email });

/** The organisation's projects, newest first. Any member. */
export async function listProjects(user: User, orgId: string): Promise<Project[]> {
  await orgAccess(user, orgId); // not_found for an organisation you're not in
  return (await getProjectStore()).list(orgId);
}

/** Create a project in the organisation, within its plan's `projects` limit. Any member. Audited. */
export async function createProject(user: User, orgId: string, input: unknown): Promise<Project> {
  assertNotDemo(user);
  const { name } = parseInput(projectInputSchema, input);
  await orgAccess(user, orgId);
  const store = await getProjectStore();
  // The plan's limit, then the count and the insert in one atomic step (the store), so concurrent
  // creates can't overshoot it.
  const limit = limitOf(await limitContext(await usageSubject(user, { orgId })), "projects");
  const { project, count } = await store.create({ orgId, name, createdBy: user.id, limit });
  if (!project) throw limitReached("projects", limit, count, false);
  await recordAudit(actor(user), "example_project.create", "example_project", project.id, null, project);
  return project;
}

/** Delete a project. An admin or owner of the organisation. Audited. */
export async function deleteProject(user: User, orgId: string, projectId: string): Promise<void> {
  assertNotDemo(user);
  const { role } = await orgAccess(user, orgId);
  if (!can(role, "members.invite")) throw new ServiceError("forbidden", "Only an admin or the owner can delete a project.");
  const store = await getProjectStore();
  const before = await store.get(orgId, projectId);
  if (!before || !(await store.delete(orgId, projectId))) throw new ServiceError("not_found", "No such project.");
  await recordAudit(actor(user), "example_project.delete", "example_project", projectId, before, null);
}
