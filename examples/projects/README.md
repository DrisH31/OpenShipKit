# Example: projects (a small B2B tool)

A team's projects, built on the kit the way the kit builds its own features.
Copy it as the shape of your first real feature: everything a production
feature needs is here, and nothing else.

- **Teams.** A project belongs to an organisation (`OPENSHIPKIT_TENANCY=org`).
  Every call checks membership; any member lists and creates; deleting needs
  an admin or the owner. Someone outside the organisation gets 404, not 403.
- **Plan limits.** The plan's `limits.projects` caps how many an organisation
  may have (`/admin/plans/<key>` → Limits, e.g. `projects: 3` on the free plan).
  The 409 says so: `details.reason === "limit_reached"`.
- **The write path.** The demo guard, zod, the store, then the audit log with
  before and after (`example_project.create`, `example_project.delete`).
- **Two stores, one contract.** Memory (tests, `DATA_PROVIDER=memory`) and
  Postgres over `migration.sql`, both run by `tests/examples/projects.test.ts`.

The app imports none of it until you enable it, and `npm run check`
typechecks and tests it all the same, so it doesn't rot.

## Files

| File | What |
|---|---|
| `service.ts` | `listProjects`, `createProject`, `deleteProject`: what routes, pages and actions call |
| `store.ts` | the contract and the memory store |
| `store-postgres.ts` | the Postgres store (raw SQL, so drizzle-kit never drops the table) |
| `migration.sql` | the `example_projects` table |
| `routes/projects.ts`, `routes/project.ts` | `GET`/`POST /api/orgs/:orgId/projects`, `DELETE …/projects/:id` |

## Enable

1. Turn teams on: `OPENSHIPKIT_TENANCY=org` (docs/teams.md).
2. Apply the table, with `npm run dev` stopped. Make it a Drizzle custom
   migration so every environment applies it like the others:

   ```bash
   npm run db:generate -- --custom --name example_projects
   # paste migration.sql into the new drizzle/NNNN_example_projects.sql, then
   npm run db:migrate
   ```

3. Mount the routes (each comment at the top of a route file has its three
   lines), for example `src/app/api/orgs/[orgId]/projects/route.ts`:

   ```ts
   export { GET, POST } from "../../../../../../examples/projects/routes/projects";
   export const runtime = "nodejs";
   export const dynamic = "force-dynamic";
   ```

4. Add both routes to `ROUTES` in `tests/authz.test.ts` (guard: `apiUser`) and
   to `ENDPOINTS` in `src/server/api-reference.ts`, then `npm run docs:api`.
5. Set a `projects` limit on your plans in `/admin/plans`.
6. Build the page: a server component that calls `listProjects(user, orgId)`
   for the current organisation (`currentOrg` in `src/server/orgs.ts`), and a
   server action that calls `createProject`. The dashboard's Team page is the
   pattern to follow.

## Remove

Delete `examples/projects/`, its mounted routes and their entries, and drop
the table in a new migration (`drop table example_projects`).
