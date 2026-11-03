import "server-only";

//
// The projects store on Postgres: the table from ./migration.sql, through the
// app's shared Drizzle client. Raw SQL with Drizzle's `sql` tag: the table
// isn't in schema.ts, so drizzle-kit never generates a migration that drops it.
//

import { sql } from "drizzle-orm";
import { getDrizzle, type Db } from "@/adapters/data/postgres/db";
import { isUuid, type Project, type ProjectStore } from "./store";

type Row = { id: string; org_id: string; name: string; created_by: string | null; created_at: Date | string };

const toProject = (r: Row): Project => ({ id: r.id, orgId: r.org_id, name: r.name, createdBy: r.created_by, createdAt: new Date(r.created_at).toISOString() });

export function createPostgresProjectStore(opts: { db?: Db } = {}): ProjectStore {
  const db = () => opts.db ?? getDrizzle();
  return {
    async create({ orgId, name, createdBy, limit = null }) {
      return db().transaction(async (tx) => {
        // One organisation at a time: concurrent creates queue here, so two can't both pass a count at
        // limit - 1. Released at commit or rollback.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`example_projects:${orgId}`}, 0))`);
        const counted = await tx.execute<{ n: number | string }>(sql`select count(*)::int as n from example_projects where org_id = ${orgId}`);
        const count = Number(counted.rows[0]?.n ?? 0);
        if (limit !== null && count >= limit) return { project: null, count };
        const r = await tx.execute<Row>(sql`insert into example_projects (org_id, name, created_by) values (${orgId}, ${name}, ${createdBy}) returning *`);
        return { project: toProject(r.rows[0]), count: count + 1 };
      });
    },
    async list(orgId) {
      if (!isUuid(orgId)) return [];
      const r = await db().execute<Row>(sql`select * from example_projects where org_id = ${orgId} order by created_at desc, id desc`);
      return r.rows.map(toProject);
    },
    async get(orgId, id) {
      if (!isUuid(orgId) || !isUuid(id)) return null;
      const r = await db().execute<Row>(sql`select * from example_projects where org_id = ${orgId} and id = ${id}`);
      return r.rows[0] ? toProject(r.rows[0]) : null;
    },
    async delete(orgId, id) {
      if (!isUuid(orgId) || !isUuid(id)) return false;
      const r = await db().execute<{ id: string }>(sql`delete from example_projects where org_id = ${orgId} and id = ${id} returning id`);
      return r.rows.length > 0;
    },
    async count(orgId) {
      if (!isUuid(orgId)) return 0;
      const r = await db().execute<{ n: number | string }>(sql`select count(*)::int as n from example_projects where org_id = ${orgId}`);
      return Number(r.rows[0]?.n ?? 0);
    },
  };
}
