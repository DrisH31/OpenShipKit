//
// /api/health's schema check: a database that answers but whose migrations
// table can't be read is not healthy (it used to read as healthy, because the
// failure was swallowed as "nothing to report").
//

import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ applied: async (): Promise<number | null> => null }));
vi.mock("@/server/data", () => ({
  getData: async () => ({
    id: "postgres",
    health: async () => ({ ok: true }),
    appliedMigration: () => db.applied(),
    jobs: { counts: async () => ({ oldestDueAt: null }) },
  }),
}));

const { GET } = await import("@/app/api/health/route");

describe("/api/health schema", () => {
  it("is 503 with state unknown when the migrations table can't be read", async () => {
    db.applied = async () => {
      throw new Error("permission denied for schema drizzle");
    };
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).schema).toEqual({ ok: false, state: "unknown" });
  });

  it("is 200 and current when every migration is applied", async () => {
    const { EXPECTED_MIGRATION } = await import("@/server/schema-version");
    db.applied = async () => EXPECTED_MIGRATION;
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).schema).toEqual({ ok: true, state: "current" });
  });
});
