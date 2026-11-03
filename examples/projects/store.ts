//
// The projects example's store: its contract and the memory implementation.
//
//   memory     this file: the reference implementation, for DATA_PROVIDER=memory and the tests.
//   postgres   ./store-postgres.ts, over ./migration.sql.
//
// tests/examples/projects.test.ts runs one suite on both.
//
// The contract:
//  - Every read and write takes the organisation's id and filters inside the
//    query: no call can see or touch another organisation's project.
//  - A malformed id is "not found" (null / false), never a throw.
//
// Pure: no server-only, no I/O.
//

export interface Project {
  id: string;
  orgId: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ProjectStore {
  /**
   * Create, only if the organisation has fewer than `limit` (null: no limit), counted and inserted
   * atomically: concurrent creates for one organisation queue, so the limit holds exactly. Over the
   * limit: `project` is null, and `count` says how many there are.
   */
  create(input: { orgId: string; name: string; createdBy: string; limit?: number | null }): Promise<{ project: Project | null; count: number }>;
  /** Newest first. */
  list(orgId: string): Promise<Project[]>;
  get(orgId: string, id: string): Promise<Project | null>;
  /** True when it was there. */
  delete(orgId: string, id: string): Promise<boolean>;
  count(orgId: string): Promise<number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export function createMemoryProjectStore(): ProjectStore {
  const rows = new Map<string, Project>();
  let seq = 0;
  return {
    async create({ orgId, name, createdBy, limit = null }) {
      // One synchronous stretch (count, then insert): atomic on one event loop.
      const count = [...rows.values()].filter((p) => p.orgId === orgId).length;
      if (limit !== null && count >= limit) return { project: null, count };
      // A strictly increasing time, so "newest first" holds within one millisecond too.
      const project: Project = { id: crypto.randomUUID(), orgId, name, createdBy, createdAt: new Date(Date.now() + seq++).toISOString() };
      rows.set(project.id, project);
      return { project: { ...project }, count: count + 1 };
    },
    async list(orgId) {
      return [...rows.values()]
        .filter((p) => p.orgId === orgId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => ({ ...p }));
    },
    async get(orgId, id) {
      const p = isUuid(id) ? rows.get(id) : undefined;
      return p && p.orgId === orgId ? { ...p } : null;
    },
    async delete(orgId, id) {
      const p = isUuid(id) ? rows.get(id) : undefined;
      if (!p || p.orgId !== orgId) return false;
      rows.delete(id);
      return true;
    },
    async count(orgId) {
      return [...rows.values()].filter((p) => p.orgId === orgId).length;
    },
  };
}
