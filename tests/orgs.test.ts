//
// Teams (ROADMAP 2.2, 2.3, 2.5): the permission matrix (every role against
// every action, through the real services), invitations end to end, the
// last-owner rule, ownership transfer, account deletion, and teams being off
// by default. Runs on the memory store; the storage rules are in tests/contract.
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import type { DataStore } from "@/core/data";
import type { EmailMessage } from "@/core/email";
import { ORG_ACTIONS, PERMISSIONS, can, canManage, orgSlug, type Org, type OrgAction, type OrgRole } from "@/core/orgs";
import type { Actor, User } from "@/core/types";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
const outbox = vi.hoisted(() => [] as EmailMessage[]);
vi.mock("@/server/email", () => ({
  sendEmail: async (m: EmailMessage) => {
    outbox.push(m);
    return { id: "em" };
  },
}));

const orgs = await import("@/server/services/orgs");
const { deleteUser } = await import("@/server/services/users");

let seq = 0;
async function person(label: string): Promise<User> {
  seq += 1;
  return store.users.upsertFromIdentity(
    { provider: "better-auth", providerUserId: `${label}-${seq}`, email: `${label}-${seq}@example.com`, name: label, image: null, emailVerified: true },
    { makeAdmin: false },
  );
}

/** An organisation with one person in each role, an extra member to act on, and someone outside it. */
async function team() {
  const owner = await person("owner");
  const org = await orgs.createOrg(owner, { name: "Acme" });
  const admin = await person("admin");
  const member = await person("member");
  const target = await person("target");
  const outsider = await person("outsider");
  await store.orgs.addMember(org.id, admin.id, "admin");
  await store.orgs.addMember(org.id, member.id, "member");
  await store.orgs.addMember(org.id, target.id, "member");
  return { org, owner, admin, member, target, outsider };
}

const linkOf = (m: EmailMessage) => /\/invite\/([A-Za-z0-9_-]+)/.exec(m.text)?.[1] ?? "";

beforeEach(() => {
  store = createMemoryStore({ fresh: true });
  outbox.length = 0;
  vi.stubEnv("OPENSHIPKIT_TENANCY", "org");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the permission map", () => {
  it("ranks roles: an owner can do all an admin can, an admin all a member can", () => {
    for (const action of ORG_ACTIONS) {
      if (can("member", action)) expect(can("admin", action), action).toBe(true);
      if (can("admin", action)) expect(can("owner", action), action).toBe(true);
    }
    expect(PERMISSIONS["org.delete"]).toBe("owner");
    expect(PERMISSIONS["billing.manage"]).toBe("owner");
  });

  it("lets admins manage members only, owners anyone below owner, and nobody hand out ownership by role change", () => {
    expect(canManage("admin", "member", "member")).toBe(true);
    expect(canManage("admin", "admin")).toBe(false);
    expect(canManage("admin", "member", "admin")).toBe(false);
    expect(canManage("admin", "owner")).toBe(false);
    expect(canManage("owner", "admin", "member")).toBe(true);
    expect(canManage("owner", "member", "owner")).toBe(false);
    expect(canManage("member", "member")).toBe(false);
  });

  it("makes slugs from names", () => {
    expect(orgSlug("Acme, Inc.")).toBe("acme-inc");
    expect(orgSlug("  Café Société  ")).toBe("cafe-societe");
    expect(orgSlug("!!!")).toBe("");
  });
});

describe("the permission matrix: every role against every action, through the services", () => {
  type Who = OrgRole | "outsider";
  /** One call per action, as the person `who`; each acts on fresh data. */
  const CASES: Record<OrgAction, (t: Awaited<ReturnType<typeof team>>, who: User) => Promise<unknown>> = {
    "org.view": (t, who) => orgs.orgAccess(who, t.org.id),
    "org.rename": (t, who) => orgs.updateOrg(who, t.org.id, { name: "Renamed" }),
    "org.delete": (t, who) => orgs.deleteOrg(who, t.org.id),
    "members.view": (t, who) => orgs.listMembers(who, t.org.id),
    "members.invite": (t, who) => orgs.inviteMember(who, t.org.id, { email: "new@example.com", role: "member" }),
    "members.remove": (t, who) => orgs.removeMember(who, t.org.id, t.target.id),
    "members.setRole": (t, who) => orgs.setMemberRole(who, t.org.id, t.target.id, "member"),
    "ownership.transfer": (t, who) => orgs.transferOwnership(who, t.org.id, t.target.id),
    // Billing's own services arrive with org billing (ROADMAP 2.4); until then the gate they will call.
    "billing.view": (t, who) => orgs.requireOrgPermission(who, t.org.id, "billing.view"),
    "billing.manage": (t, who) => orgs.requireOrgPermission(who, t.org.id, "billing.manage"),
    "org.leave": (t, who) => orgs.leaveOrg(who, t.org.id),
  };

  it("has a case for every action", () => {
    expect(Object.keys(CASES).sort()).toEqual([...ORG_ACTIONS].sort());
  });

  const WHO: Who[] = ["owner", "admin", "member", "outsider"];
  for (const action of ORG_ACTIONS) {
    for (const who of WHO) {
      const allowed = who !== "outsider" && can(who, action);
      it(`${who} ${allowed ? "may" : "may not"} ${action}`, async () => {
        const t = await team();
        const actor = who === "outsider" ? t.outsider : t[who];
        const outcome = await CASES[action](t, actor).then(
          () => "ok",
          (e: { code?: string }) => e.code ?? "threw",
        );
        if (who === "outsider") expect(outcome).toBe("not_found"); // an outsider can't even tell it exists
        else if (!allowed) expect(outcome).toBe("forbidden");
        // Allowed by role; the only refusal left is the last-owner rule, which is about the team, not the role.
        else expect(["ok", ...(action === "org.leave" && who === "owner" ? ["conflict"] : [])]).toContain(outcome);
      });
    }
  }
});

describe("organisations", () => {
  it("are off by default: every team call is 'not found'", async () => {
    vi.stubEnv("OPENSHIPKIT_TENANCY", "");
    const u = await person("solo");
    await expect(orgs.createOrg(u, { name: "Nope" })).rejects.toMatchObject({ code: "not_found" });
    await expect(orgs.listMyOrgs(u)).rejects.toMatchObject({ code: "not_found" });
  });

  it("get a free slug from their name, refuse a bad one, and are audited", async () => {
    const u = await person("founder");
    const a = await orgs.createOrg(u, { name: "Acme, Inc." });
    const b = await orgs.createOrg(u, { name: "Acme Inc" });
    expect([a.slug, b.slug]).toEqual(["acme-inc", "acme-inc-2"]);
    await expect(orgs.createOrg(u, { name: "X", slug: "Not A Slug" })).rejects.toMatchObject({ code: "invalid" });
    await expect(orgs.createOrg(u, { name: "Y", slug: "acme-inc" })).rejects.toMatchObject({ code: "conflict" });
    await expect(orgs.createOrg(u, { name: "   " })).rejects.toMatchObject({ code: "invalid" });
    const [entry] = (await store.audit.list({ entity: "org", entityId: a.id })).items;
    expect(entry).toMatchObject({ action: "org.create", actor: { id: u.id } });
  });

  it("refuse the read-only demo admin", async () => {
    vi.stubEnv("DEMO_ADMIN_EMAIL", "demo@example.com");
    vi.stubEnv("DEMO_ADMIN_PASSWORD", "a-long-demo-password-123");
    const demo = await store.users.upsertFromIdentity(
      { provider: "better-auth", providerUserId: "demo", email: "demo@example.com", name: "Demo", image: null, emailVerified: true },
      { makeAdmin: true },
    );
    await expect(orgs.createOrg(demo, { name: "Demo Co" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("members", () => {
  it("an admin can't remove or demote another admin or an owner, or make anyone an admin", async () => {
    const t = await team();
    await expect(orgs.removeMember(t.admin, t.org.id, t.owner.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(orgs.setMemberRole(t.admin, t.org.id, t.target.id, "admin")).rejects.toMatchObject({ code: "forbidden" });
    const other = await person("admin2");
    await store.orgs.addMember(t.org.id, other.id, "admin");
    await expect(orgs.removeMember(t.admin, t.org.id, other.id)).rejects.toMatchObject({ code: "forbidden" });
    await orgs.removeMember(t.admin, t.org.id, t.target.id);
    expect(await store.orgs.getMember(t.org.id, t.target.id)).toBeNull();
  });

  it("nobody makes someone an owner by changing their role, or changes their own role", async () => {
    const t = await team();
    await expect(orgs.setMemberRole(t.owner, t.org.id, t.admin.id, "owner")).rejects.toMatchObject({ code: "forbidden" });
    await expect(orgs.setMemberRole(t.owner, t.org.id, t.owner.id, "member")).rejects.toMatchObject({ code: "conflict" });
  });

  it("the only owner can't leave; after a transfer they can, and the new owner is in charge", async () => {
    const t = await team();
    await expect(orgs.leaveOrg(t.owner, t.org.id)).rejects.toMatchObject({ code: "conflict" });
    await orgs.transferOwnership(t.owner, t.org.id, t.member.id);
    expect((await store.orgs.getMember(t.org.id, t.member.id))?.role).toBe("owner");
    expect((await store.orgs.getMember(t.org.id, t.owner.id))?.role).toBe("admin");
    await orgs.leaveOrg(t.owner, t.org.id);
    expect(await store.orgs.getMember(t.org.id, t.owner.id)).toBeNull();
    await orgs.deleteOrg(t.member, t.org.id);
    expect(await store.orgs.get(t.org.id)).toBeNull();
  });

  it("removing yourself goes through leave", async () => {
    const t = await team();
    await expect(orgs.removeMember(t.admin, t.org.id, t.admin.id)).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("invitations", () => {
  it("emails a one-time link that only the invited address can accept, with the role it was sent with", async () => {
    const t = await team();
    const joiner = await person("joiner");
    const { invitation, url } = await orgs.inviteMember(t.admin, t.org.id, { email: joiner.email.toUpperCase(), role: "member" });
    expect(invitation.email).toBe(joiner.email);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(joiner.email);
    const token = linkOf(outbox[0]);
    expect(url).toBe(`https://example.com/invite/${token}`);
    expect(JSON.stringify(await store.orgs.getInvitation(invitation.id))).not.toContain(token); // only the hash is stored

    expect(await orgs.previewInvitation(token)).toMatchObject({ state: "pending", orgName: "Acme", role: "member", email: joiner.email });
    await expect(orgs.acceptInvitation(t.outsider, token)).rejects.toMatchObject({ code: "forbidden" });
    const org = await orgs.acceptInvitation(joiner, token);
    expect(org.id).toBe(t.org.id);
    expect((await store.orgs.getMember(t.org.id, joiner.id))?.role).toBe("member");
    await expect(orgs.acceptInvitation(joiner, token)).rejects.toMatchObject({ code: "conflict" });
    await expect(orgs.acceptInvitation(joiner, "made-up-token")).rejects.toMatchObject({ code: "not_found" });
    expect((await store.audit.list({ entity: "org", entityId: t.org.id })).items.map((e) => e.action)).toEqual(expect.arrayContaining(["org.invite", "org.join"]));
  });

  it("sending again replaces the open invitation, and works after one has expired", async () => {
    const t = await team();
    await orgs.inviteMember(t.owner, t.org.id, { email: "again@example.com", role: "member" });
    const first = linkOf(outbox[0]);
    await orgs.inviteMember(t.owner, t.org.id, { email: "again@example.com", role: "admin" });
    expect((await orgs.previewInvitation(first))?.state).toBe("revoked");
    expect(await orgs.listInvitations(t.owner, t.org.id)).toMatchObject([{ email: "again@example.com", role: "admin" }]);

    // An expired, never-closed one doesn't block a new invitation to the same address.
    await store.orgs.createInvitation({ orgId: t.org.id, email: "late@example.com", role: "member", tokenHash: "h-late", invitedBy: null, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(orgs.inviteMember(t.owner, t.org.id, { email: "late@example.com", role: "member" })).resolves.toBeTruthy();
  });

  it("refuses inviting a member, an admin inviting an admin, and a revoked or expired link", async () => {
    const t = await team();
    await expect(orgs.inviteMember(t.owner, t.org.id, { email: t.member.email, role: "member" })).rejects.toMatchObject({ code: "conflict" });
    await expect(orgs.inviteMember(t.admin, t.org.id, { email: "x@example.com", role: "admin" })).rejects.toMatchObject({ code: "forbidden" });
    const { invitation } = await orgs.inviteMember(t.owner, t.org.id, { email: "gone@example.com", role: "member" });
    const token = linkOf(outbox[outbox.length - 1]);
    await orgs.revokeInvitation(t.admin, t.org.id, invitation.id);
    const invited = await store.users.upsertFromIdentity(
      { provider: "better-auth", providerUserId: "gone-x", email: "gone@example.com", name: null, image: null, emailVerified: true },
      { makeAdmin: false },
    );
    await expect(orgs.acceptInvitation(invited, token)).rejects.toMatchObject({ code: "conflict" });
    await expect(orgs.revokeInvitation(t.admin, t.org.id, invitation.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps the invitation when its email can't be sent, and returns the link to share", async () => {
    const t = await team();
    const failing = vi.spyOn(await import("@/server/email"), "sendEmail").mockRejectedValueOnce(new Error("SMTP down"));
    const { invitation, url } = await orgs.inviteMember(t.owner, t.org.id, { email: "later@example.com", role: "member" });
    expect(failing).toHaveBeenCalled();
    expect(url).toMatch(/\/invite\//);
    expect((await store.orgs.listInvitations(t.org.id)).map((i) => i.id)).toContain(invitation.id);
  });
});

describe("deleting an account", () => {
  const self = (u: User): Actor => ({ type: "user", id: u.id, label: u.email });

  it("is refused while it is the only owner of a team with other members", async () => {
    const t = await team();
    await expect(deleteUser(t.owner.id, self(t.owner))).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/only owner of “Acme”/) });
    expect(await store.users.getById(t.owner.id)).not.toBeNull();
  });

  it("takes the teams it owns alone with it, and leaves teams with another owner", async () => {
    const solo = await person("solo");
    const mine: Org = await orgs.createOrg(solo, { name: "Just Me" });
    const t = await team();
    await store.orgs.addMember(t.org.id, solo.id, "owner"); // a second owner of Acme
    await deleteUser(solo.id, self(solo));
    expect(await store.orgs.get(mine.id)).toBeNull();
    expect(await store.orgs.get(t.org.id)).not.toBeNull();
    expect((await store.audit.list({ entity: "org", entityId: mine.id })).items.map((e) => e.action)).toContain("org.delete");
  });
});
