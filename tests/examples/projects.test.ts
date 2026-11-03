//
// The projects example (examples/projects): the store contract on memory and
// on Postgres (PGlite, with the app's migrations and the example's SQL), and
// the service through the real orgs, limits and audit on the memory store.
//

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import { createPostgresStore } from "@/adapters/data/postgres";
import { drizzleOverPglite } from "@/adapters/data/postgres/db";
import { migrateEmbedded } from "@/adapters/data/postgres/embedded";
import type { DataStore } from "@/core/data";
import type { PlanInput, User } from "@/core/types";
import { createMemoryProjectStore, type ProjectStore } from "../../examples/projects/store";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
vi.mock("@/server/email", () => ({ sendEmail: async () => ({ id: "em" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const { createPostgresProjectStore } = await import("../../examples/projects/store-postgres");

// ---------------------------------------------------------------- the store contract

function describeContract(name: string, make: () => Promise<{ store: ProjectStore; orgs: [string, string]; userId: string }>) {
  describe(`projects store: ${name}`, () => {
    it("creates, lists newest first, counts and deletes, one organisation at a time", async () => {
      const { store: s, orgs: [a, b], userId } = await make();
      const one = await s.create({ orgId: a, name: "One", createdBy: userId });
      const two = await s.create({ orgId: a, name: "Two", createdBy: userId });
      await s.create({ orgId: b, name: "Theirs", createdBy: userId });
      expect((await s.list(a)).map((p) => p.name)).toEqual(["Two", "One"]);
      expect(await s.count(a)).toBe(2);
      expect(await s.get(a, one.id)).toMatchObject({ id: one.id, orgId: a, name: "One", createdBy: userId });
      // Another organisation's project is not found, and can't be deleted.
      expect(await s.get(b, one.id)).toBeNull();
      expect(await s.delete(b, two.id)).toBe(false);
      expect(await s.delete(a, two.id)).toBe(true);
      expect(await s.delete(a, two.id)).toBe(false);
      expect(await s.get(a, "not-a-uuid")).toBeNull();
      expect(await s.count(a)).toBe(1);
    });
  });
}

describeContract("memory", async () => ({ store: createMemoryProjectStore(), orgs: [crypto.randomUUID(), crypto.randomUUID()], userId: crypto.randomUUID() }));

describe("projects store on postgres (PGlite)", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzleOverPglite>;
  beforeAll(async () => {
    client = new PGlite();
    await migrateEmbedded(client);
    const sqlFile = fileURLToPath(new URL("../../examples/projects/migration.sql", import.meta.url));
    const statements = readFileSync(sqlFile, "utf8").split("--> statement-breakpoint");
    for (let i = 0; i < 2; i++) for (const s of statements) await client.exec(s); // twice: idempotent
    db = drizzleOverPglite(client);
  }, 60_000);
  afterAll(async () => {
    await client?.close();
  });

  describeContract("postgres", async () => {
    const data = createPostgresStore({ db });
    const u = await data.users.upsertFromIdentity(
      { provider: "better-auth", providerUserId: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, name: null, image: null, emailVerified: true },
      { makeAdmin: false },
    );
    const a = await data.orgs.create({ name: "A", slug: `a-${crypto.randomUUID().slice(0, 8)}`, ownerId: u.id });
    const b = await data.orgs.create({ name: "B", slug: `b-${crypto.randomUUID().slice(0, 8)}`, ownerId: u.id });
    return { store: createPostgresProjectStore({ db }), orgs: [a.id, b.id], userId: u.id };
  });

  it("an organisation's projects go with it", async () => {
    const data = createPostgresStore({ db });
    const u = await data.users.upsertFromIdentity(
      { provider: "better-auth", providerUserId: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, name: null, image: null, emailVerified: true },
      { makeAdmin: false },
    );
    const org = await data.orgs.create({ name: "Gone", slug: `g-${crypto.randomUUID().slice(0, 8)}`, ownerId: u.id });
    const s = createPostgresProjectStore({ db });
    await s.create({ orgId: org.id, name: "X", createdBy: u.id });
    await data.orgs.delete(org.id);
    expect(await s.count(org.id)).toBe(0);
  }, 30_000);
});

// ---------------------------------------------------------------- the service

describe("projects service", () => {
  const svc = () => import("../../examples/projects/service");
  const orgs = () => import("@/server/services/orgs");
  let owner: User;
  let member: User;

  const plan = (key: string, over: Partial<PlanInput> = {}): PlanInput => ({
    key, name: key, description: "", features: [], prices: [], highlighted: false, contactSales: false, ctaLabel: "Go", trialDays: null, active: true, sortOrder: 1, ...over,
  });
  const person = (email: string) =>
    store.users.upsertFromIdentity({ provider: "better-auth", providerUserId: email, email, name: null, image: null, emailVerified: true }, { makeAdmin: false });

  beforeEach(async () => {
    vi.stubEnv("OPENSHIPKIT_TENANCY", "org");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
    vi.stubEnv("DATA_PROVIDER", "memory");
    store = createMemoryStore({ fresh: true });
    for (const p of await store.plans.list({})) await store.plans.delete(p.key);
    await store.plans.upsert(plan("free", { sortOrder: 0, limits: { projects: 2 } }));
    owner = await person(`owner-${crypto.randomUUID()}@example.com`);
    member = await person(`member-${crypto.randomUUID()}@example.com`);
  });

  async function teamWithMember() {
    const { createOrg, inviteMember, acceptInvitation } = await orgs();
    const org = await createOrg(owner, { name: "Acme" });
    const { url } = await inviteMember(owner, org.id, { email: member.email, role: "member" });
    await acceptInvitation(member, url.split("/invite/")[1]);
    return org;
  }

  it("members create and list; the free plan's projects limit holds; audited", async () => {
    const { createProject, listProjects } = await svc();
    const org = await teamWithMember();
    await createProject(member, org.id, { name: "Website" });
    await createProject(owner, org.id, { name: "App" });
    await expect(createProject(member, org.id, { name: "Third" })).rejects.toMatchObject({ code: "conflict", details: { reason: "limit_reached", limit: 2 } });
    expect((await listProjects(member, org.id)).map((p) => p.name)).toEqual(["App", "Website"]);
    const audit = await store.audit.list({ entity: "example_project", limit: 10 });
    expect(audit.items.map((e) => e.action)).toEqual(["example_project.create", "example_project.create"]);
  });

  it("only an admin or the owner deletes; someone outside the team sees nothing", async () => {
    const { createProject, deleteProject, listProjects } = await svc();
    const org = await teamWithMember();
    const p = await createProject(member, org.id, { name: "Website" });
    await expect(deleteProject(member, org.id, p.id)).rejects.toMatchObject({ code: "forbidden" });
    const outsider = await person(`out-${crypto.randomUUID()}@example.com`);
    await expect(listProjects(outsider, org.id)).rejects.toMatchObject({ code: "not_found" });
    await deleteProject(owner, org.id, p.id);
    await expect(deleteProject(owner, org.id, p.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a blank name", async () => {
    const { createProject } = await svc();
    const org = await teamWithMember();
    await expect(createProject(owner, org.id, { name: "  " })).rejects.toMatchObject({ code: "invalid" });
  });
});
