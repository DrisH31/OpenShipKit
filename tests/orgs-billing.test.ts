//
// Billing per organisation, per seat (ROADMAP 2.4), through the real services
// and the real webhook sink with a fake provider: who may buy, what the
// checkout carries, what the verified webhook binds, who is entitled to what,
// where seats stop invitations, and what can't be deleted while it renews.
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import { billingWebhookSink } from "@/adapters/billing/webhook-sink";
import type { BillingProvider, CheckoutInput } from "@/core/billing";
import type { DataStore } from "@/core/data";
import type { Org } from "@/core/orgs";
import type { PlanInput, User } from "@/core/types";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
vi.mock("@/server/email", () => ({ sendEmail: async () => ({ id: "em" }) }));
vi.mock("@/server/auth", () => ({ getAuth: async () => ({ id: "better-auth", deleteIdentity: async () => {}, revokeSessions: async () => {} }) }));

const h = vi.hoisted(() => ({
  checkouts: [] as CheckoutInput[],
  portals: [] as string[],
  cookie: undefined as string | undefined,
}));
const fakeBilling: BillingProvider = {
  id: "polar",
  label: "Polar",
  createCheckout: async (input) => {
    h.checkouts.push(input);
    return { url: "https://polar.example.com/checkout/1" };
  },
  createPortal: async ({ customerId }) => {
    h.portals.push(customerId);
    return { url: "https://polar.example.com/portal" };
  },
  handleWebhook: async () => new Response(null),
};
vi.mock("@/server/billing", () => ({ getBilling: async () => fakeBilling }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "osk_org" && h.cookie ? { value: h.cookie } : undefined), set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect:${to}`), { to });
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const orgs = await import("@/server/services/orgs");
const billing = await import("@/server/services/billing");
const { deleteUser } = await import("@/server/services/users");
const self = (u: User) => ({ type: "user" as const, id: u.id, label: u.email });

const TEAM_PLAN: PlanInput = {
  key: "team",
  name: "Team",
  description: "For teams",
  features: ["Everything"],
  prices: [
    { interval: "month", amountCents: 1000, currency: "usd", polarProductId: "prod_team_month", perSeat: true },
    { interval: "year", amountCents: 9000, currency: "usd", polarProductId: "prod_team_flat_year" },
  ],
  highlighted: false,
  contactSales: false,
  ctaLabel: "Buy",
  trialDays: null,
  active: true,
  sortOrder: 2,
};

let seq = 0;
async function person(label: string): Promise<User> {
  seq += 1;
  return store.users.upsertFromIdentity(
    { provider: "better-auth", providerUserId: `${label}-${seq}`, email: `${label}-${seq}@example.com`, name: label, image: null, emailVerified: true },
    { makeAdmin: false },
  );
}

/** One instant for every webhook in a test: a redelivery must be identical, to the millisecond. */
const PERIOD_END = new Date(Date.now() + 20 * 86_400_000).toISOString();

/** What a verified Polar webhook for the organisation's subscription hands the sink. */
async function webhookFor(buyer: User, org: Org | null, over: { seats?: number | null; status?: "active" | "canceled" | "unpaid"; id?: string; cancelAtPeriodEnd?: boolean } = {}) {
  return billingWebhookSink.applySubscription({
    provider: "polar",
    providerSubscriptionId: over.id ?? "psub_org_1",
    providerCustomerId: "pcus_buyer",
    userIdHints: [buyer.id],
    productId: "prod_team_month",
    planKeyHint: "team",
    checkoutProductId: "prod_team_month",
    orgIdHint: org?.id ?? null,
    seats: over.seats === undefined ? 3 : over.seats,
    interval: "month",
    status: over.status ?? "active",
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false,
  });
}

beforeEach(async () => {
  store = createMemoryStore({ fresh: true });
  await store.plans.upsert(TEAM_PLAN);
  h.checkouts.length = 0;
  h.portals.length = 0;
  h.cookie = undefined;
  vi.stubEnv("OPENSHIPKIT_TENANCY", "org");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function teamWith(memberCount: number) {
  const owner = await person("owner");
  const org = await orgs.createOrg(owner, { name: "Acme" });
  const members: User[] = [];
  for (let i = 0; i < memberCount; i++) {
    const m = await person(`m${i}`);
    await store.orgs.addMember(org.id, m.id, "member");
    members.push(m);
  }
  h.cookie = org.id;
  return { owner, org, members };
}

describe("checkout for an organisation", () => {
  it("is the owner's: an admin or a member is refused", async () => {
    const { org } = await teamWith(0);
    const admin = await person("admin");
    const member = await person("member");
    await store.orgs.addMember(org.id, admin.id, "admin");
    await store.orgs.addMember(org.id, member.id, "member");
    for (const who of [admin, member]) await expect(billing.startOrgCheckout(who, org.id, "team", "month")).rejects.toMatchObject({ code: "forbidden" });
    expect(h.checkouts).toEqual([]);
  });

  it("names the organisation in the checkout, and buys a seat per member and open invitation on a per-seat price", async () => {
    const { owner, org } = await teamWith(2);
    await orgs.inviteMember(owner, org.id, { email: "pending@example.com", role: "member" });
    const url = await billing.startCheckout(owner, "team", "month"); // the dashboard's route: current organisation
    expect(url).toBe("https://polar.example.com/checkout/1");
    expect(h.checkouts[0]).toMatchObject({ orgId: org.id, seats: 4, user: { id: owner.id }, price: { interval: "month", perSeat: true } });
  });

  it("sends no seat count for a flat price, refuses one-time prices and a second live subscription", async () => {
    const { owner, org } = await teamWith(1);
    await billing.startOrgCheckout(owner, org.id, "team", "year");
    expect(h.checkouts[0].seats).toBeUndefined();
    await expect(billing.startOrgCheckout(owner, org.id, "team", "one_time")).rejects.toMatchObject({ code: "invalid" });
    await webhookFor(owner, org);
    await expect(billing.startOrgCheckout(owner, org.id, "team", "month")).rejects.toMatchObject({ code: "conflict", details: { reason: "already_subscribed" } });
  });

  it("asks someone in no organisation to create one first", async () => {
    const loner = await person("loner");
    await expect(billing.startCheckout(loner, "team", "month")).rejects.toMatchObject({ code: "conflict", details: { reason: "no_org" } });
  });
});

describe("what the verified webhook grants", () => {
  it("the organisation's plan to the organisation, and nothing to its buyer personally", async () => {
    const { owner, org, members } = await teamWith(1);
    expect(await webhookFor(owner, org)).toBe("applied");
    const [row] = (await store.billing.listSubscriptions({ orgId: org.id })).items;
    expect(row).toMatchObject({ orgId: org.id, seats: 3, userId: owner.id, planKey: "team" });

    expect(await billing.hasOrgPlan(org.id, ["team"])).toBe(true);
    expect(await billing.hasPlan(owner.id)).toBe(false); // not the buyer's own plan
    expect((await billing.getEntitlement(owner.id)).planKey ?? null).toBeNull();

    // requirePlan follows the organisation you're working in: a member passes, someone with no organisation goes to Team.
    await expect(billing.requirePlan(members[0], ["team"])).resolves.toBeUndefined();
    const outsider = await person("outsider");
    h.cookie = undefined;
    await expect(billing.requirePlan(outsider, ["team"])).rejects.toMatchObject({ to: "/dashboard/team" });
  });

  it("keeps a deleted organisation's subscription bound to it, never turned into the buyer's plan", async () => {
    const { owner, org } = await teamWith(0);
    await webhookFor(owner, org, { cancelAtPeriodEnd: true });
    await orgs.deleteOrg(owner, org.id); // allowed: it won't renew
    await webhookFor(owner, org, { cancelAtPeriodEnd: true }); // Polar's next event for it
    expect(await billing.hasPlan(owner.id)).toBe(false);
    expect((await store.billing.listSubscriptions({ userId: owner.id, orgId: null })).items).toEqual([]);
  });

  it("records a change in seats", async () => {
    const { owner, org } = await teamWith(0);
    await webhookFor(owner, org, { seats: 3 });
    expect(await webhookFor(owner, org, { seats: 5 })).toBe("applied");
    expect(await webhookFor(owner, org, { seats: 5 })).toBe("unchanged");
    expect((await orgs.orgSeats(org.id)).limit).toBe(5);
  });
});

describe("seats", () => {
  it("stop invitations at the number bought, count open invitations, and let a resend through", async () => {
    const { owner, org } = await teamWith(1); // owner + 1 member = 2 used
    await webhookFor(owner, org, { seats: 3 });
    await orgs.inviteMember(owner, org.id, { email: "third@example.com", role: "member" }); // 3 of 3
    expect(await orgs.orgSeats(org.id)).toEqual({ limit: 3, used: 3 });
    await expect(orgs.inviteMember(owner, org.id, { email: "fourth@example.com", role: "member" })).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "no_seats" },
    });
    await expect(orgs.inviteMember(owner, org.id, { email: "third@example.com", role: "member" })).resolves.toBeTruthy(); // a resend
  });

  it("refuse joining when seats were reduced after the invitation went out", async () => {
    const { owner, org } = await teamWith(0);
    await webhookFor(owner, org, { seats: 2 });
    const { url } = await orgs.inviteMember(owner, org.id, { email: "late@example.com", role: "member" });
    await webhookFor(owner, org, { seats: 1 });
    const late = await store.users.upsertFromIdentity(
      { provider: "better-auth", providerUserId: "late", email: "late@example.com", name: null, image: null, emailVerified: true },
      { makeAdmin: false },
    );
    await expect(orgs.acceptInvitation(late, url.split("/invite/")[1])).rejects.toMatchObject({ details: { reason: "no_seats" } });
  });

  it("aren't limited on a free or flat-priced organisation", async () => {
    const { owner, org } = await teamWith(0);
    expect(await orgs.orgSeats(org.id)).toEqual({ limit: null, used: 1 });
    await webhookFor(owner, org, { seats: null });
    for (let i = 0; i < 5; i++) await orgs.inviteMember(owner, org.id, { email: `p${i}@example.com`, role: "member" });
  });
});

describe("the portal and deleting", () => {
  it("opens for the owner who pays, and tells another owner who manages payment", async () => {
    const { owner, org, members } = await teamWith(1);
    await webhookFor(owner, org);
    await expect(billing.openOrgPortal(owner, org.id)).resolves.toBe("https://polar.example.com/portal");
    expect(h.portals).toEqual(["pcus_buyer"]);
    await orgs.transferOwnership(owner, org.id, members[0].id);
    await expect(billing.openOrgPortal(members[0], org.id)).rejects.toMatchObject({ code: "conflict", details: { reason: "managed_by_other" }, message: expect.stringContaining(owner.email) });
  });

  it("an organisation can't be deleted while its subscription renews", async () => {
    const { owner, org } = await teamWith(0);
    await webhookFor(owner, org);
    await expect(orgs.deleteOrg(owner, org.id)).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/keep renewing/) });
  });
});

describe("whoever pays (review: every way out says what happens to the money)", () => {
  it("can't leave or be removed while the subscription renews, and can once it's set to end", async () => {
    const { owner, org, members } = await teamWith(1);
    await webhookFor(members[0], org); // a member pays (they bought it, then ownership moved)
    await expect(orgs.leaveOrg(members[0], org.id)).rejects.toMatchObject({ details: { reason: "payer" } });
    await expect(orgs.removeMember(owner, org.id, members[0].id)).rejects.toMatchObject({ details: { reason: "payer" } });
    await webhookFor(members[0], org, { cancelAtPeriodEnd: true });
    await orgs.removeMember(owner, org.id, members[0].id);
  });

  it("can still open the portal to cancel after handing over ownership", async () => {
    const { owner, org, members } = await teamWith(1);
    await webhookFor(owner, org);
    await orgs.transferOwnership(owner, org.id, members[0].id); // owner is an admin now, and still pays
    await expect(billing.openOrgPortal(owner, org.id)).resolves.toBe("https://polar.example.com/portal");
    await expect(billing.openOrgPortal(members[0], org.id)).rejects.toMatchObject({ details: { reason: "managed_by_other" } });
    const plain = await person("plain");
    await store.orgs.addMember(org.id, plain.id, "member");
    await expect(billing.openOrgPortal(plain, org.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("deleting an account never takes a renewing team with it, nor cuts a team's paid time short", async () => {
    // C bought for the team and handed it to A; the team is A's alone, and C is out (subscription set to end later).
    const c = await person("c");
    const org = await orgs.createOrg(c, { name: "Handed Over" });
    const a = await person("a");
    await store.orgs.addMember(org.id, a.id, "member");
    await webhookFor(c, org);
    await orgs.transferOwnership(c, org.id, a.id);
    await expect(deleteUser(a.id, self(a))).rejects.toMatchObject({ code: "conflict" }); // A isn't alone yet: C is still in it
    await webhookFor(c, org, { cancelAtPeriodEnd: true });
    await orgs.leaveOrg(c, org.id);
    // Now A owns it alone, and the subscription still runs: A can delete the account only once it's set to end... it is.
    await webhookFor(c, org, { cancelAtPeriodEnd: false }); // C changed their mind in Polar: it renews again
    await expect(deleteUser(a.id, self(a))).rejects.toMatchObject({ message: expect.stringMatching(/keep renewing/) });
    expect(await store.orgs.get(org.id)).not.toBeNull();

    // The buyer of a team's plan that is still running out its paid period can't delete the account yet.
    await webhookFor(c, org, { cancelAtPeriodEnd: true });
    await expect(deleteUser(c.id, self(c))).rejects.toMatchObject({ message: expect.stringMatching(/still running/) });
    expect(await billing.hasOrgPlan(org.id)).toBe(true);
  });
});

describe("turning teams on", () => {
  it("keeps a personal plan bought before: requirePlan still lets its holder through", async () => {
    const early = await person("early");
    await billingWebhookSink.applySubscription({
      provider: "polar",
      providerSubscriptionId: "psub_personal",
      providerCustomerId: "pcus_early",
      userIdHints: [early.id],
      productId: "prod_team_month",
      planKeyHint: null,
      checkoutProductId: null,
      orgIdHint: null,
      seats: null,
      interval: "month",
      status: "active",
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: false,
    });
    await expect(billing.requirePlan(early, ["team"])).resolves.toBeUndefined(); // no organisation needed
  });
});

describe("invitations can't be used to send mail at will", () => {
  it("are limited per person per hour", async () => {
    const { owner, org } = await teamWith(0);
    let refused = 0;
    for (let i = 0; i < 35; i++) {
      await orgs.inviteMember(owner, org.id, { email: `spam${i}@example.com`, role: "member" }).catch((e: { code?: string }) => {
        if (e.code === "rate_limited") refused += 1;
      });
    }
    expect(refused).toBe(5);
  });
});

describe("seats under concurrency", () => {
  it("simultaneous invitations can't overshoot the seats bought", async () => {
    const { owner, org } = await teamWith(1); // 2 used
    await webhookFor(owner, org, { seats: 3 });
    const results = await Promise.allSettled([0, 1, 2].map((i) => orgs.inviteMember(owner, org.id, { email: `race${i}@example.com`, role: "member" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await orgs.orgSeats(org.id)).used).toBe(3);
  });
});

describe("the portal answers to whoever pays (review round 2)", () => {
  it("a payer removed after setting it to end, who then resumes it in Polar, can still reach their portal to stop it", async () => {
    const { owner, org, members } = await teamWith(1);
    const a = members[0];
    await webhookFor(a, org, { cancelAtPeriodEnd: true }); // A pays, set to end
    await orgs.removeMember(owner, org.id, a.id); // allowed: it won't renew
    await webhookFor(a, org, { cancelAtPeriodEnd: false }); // A resumes it in Polar
    h.cookie = undefined;
    await expect(billing.openPortal(a)).resolves.toBe("https://polar.example.com/portal"); // A is in no team, and pays
    h.cookie = org.id;
    await expect(billing.openOrgPortal(owner, org.id)).rejects.toMatchObject({ details: { reason: "managed_by_other" }, message: expect.stringContaining(a.email) });
  });

  it("a team can't buy while a subscription is still running out its period, so a resume can't double-charge it", async () => {
    const { owner, org, members } = await teamWith(1);
    await webhookFor(members[0], org, { cancelAtPeriodEnd: true });
    await expect(billing.startOrgCheckout(owner, org.id, "team", "month")).rejects.toMatchObject({ details: { reason: "already_subscribed" }, message: expect.stringMatching(/runs until/) });
  });

  it("uses one meaning of renewing: an unpaid subscription still blocks removing its payer and deleting the team", async () => {
    const { owner, org, members } = await teamWith(1);
    await webhookFor(members[0], org, { status: "unpaid" });
    await expect(orgs.removeMember(owner, org.id, members[0].id)).rejects.toMatchObject({ details: { reason: "payer" }, message: expect.stringContaining("Ask them") });
    await expect(orgs.deleteOrg(owner, org.id)).rejects.toMatchObject({ message: expect.stringMatching(/keep renewing/) });
  });

  it("deleting an account isn't held up by a team that no longer exists", async () => {
    const { owner, org } = await teamWith(0);
    await webhookFor(owner, org, { cancelAtPeriodEnd: true });
    await orgs.deleteOrg(owner, org.id);
    await expect(deleteUser(owner.id, self(owner))).resolves.toBeUndefined();
  });

  it("limits resends to one address", async () => {
    const { owner, org } = await teamWith(0);
    for (let i = 0; i < 3; i++) await orgs.inviteMember(owner, org.id, { email: "same@example.com", role: "member" });
    await expect(orgs.inviteMember(owner, org.id, { email: "same@example.com", role: "member" })).rejects.toMatchObject({ code: "rate_limited" });
  });
});
