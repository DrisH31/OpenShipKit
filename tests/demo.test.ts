//
// The read-only demo admin (src/core/demo.ts, docs/auth.md): every write
// service refuses it before touching the DataStore; a new service that takes
// an Actor or a User without the guard fails here; the privacy mask; the
// environment rules and the boot check. Better Auth, the account ensure and
// POST /api/demo are in tests/demo-auth.test.ts (they need the auth engine).
//

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/core/data";
import type { Actor, AuditEntry, Feedback, User } from "@/core/types";
import { DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { createMemoryStore } from "@/adapters/data/memory";
import {
  HIDDEN_IN_DEMO,
  NO_MASK,
  maskAuditEntry,
  maskEmail,
  maskEmailMap,
  maskEmailsIn,
  maskFeedback,
  maskJson,
  maskName,
  redactFreeText,
  showEmail,
  showName,
  type PrivacyLens,
} from "@/shared/privacy-mask";
import { demoAdminProblems, resolveDemoAdmin } from "@/server/env-rules";

/** Every repository read or write the services make, by name ("content.set"). */
const touched: string[] = [];
let store: DataStore;

/** The store behind a Proxy that records each repository method called. */
function watched(inner: DataStore): DataStore {
  return new Proxy(inner, {
    get(target, repo, receiver) {
      const value = Reflect.get(target, repo, receiver) as unknown;
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          touched.push(String(repo));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (value && typeof value === "object") {
        return new Proxy(value as object, {
          get(t, method, r) {
            const fn = Reflect.get(t, method, r) as unknown;
            if (typeof fn !== "function") return fn;
            return (...args: unknown[]) => {
              touched.push(`${String(repo)}.${String(method)}`);
              return (fn as (...a: unknown[]) => unknown).apply(t, args);
            };
          },
        });
      }
      return value;
    },
  });
}

vi.mock("@/server/data", () => ({ getData: async () => watched(store) }));
vi.mock("@/server/auth", () => ({
  getAuth: async () => ({
    id: "better-auth",
    urls: { signIn: "/sign-in", signUp: "/sign-up", account: "/dashboard/settings" },
    getIdentity: async () => null,
    updateProfile: async () => {
      touched.push("auth.updateProfile");
    },
    deleteIdentity: async () => {
      touched.push("auth.deleteIdentity");
    },
  }),
}));
vi.mock("@/server/billing", () => ({
  getBilling: async () => {
    touched.push("billing.provider");
    return { id: "none", createCheckout: async () => "x", createPortal: async () => "x" };
  },
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const DEMO = "demo@example.com";
const DEMO_PASSWORD = "a-long-random-demo-password-0123";

const demoUser: User = {
  id: "demo-user",
  email: DEMO,
  name: "Demo admin",
  image: null,
  role: "admin",
  banned: false,
  authProvider: "better-auth",
  authProviderUserId: "demo-auth",
  createdAt: new Date().toISOString(),
  lastSeenAt: null,
};

beforeEach(() => {
  vi.stubEnv("DEMO_ADMIN_EMAIL", DEMO);
  vi.stubEnv("DEMO_ADMIN_PASSWORD", DEMO_PASSWORD);
  vi.stubEnv("DATA_PROVIDER", "memory");
  store = createMemoryStore({ fresh: true });
  touched.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------- the guard, checked statically

const SERVICES = join(__dirname, "..", "src", "server", "services");

/** Exported async functions whose parameters include an Actor or a User — the shape of a write. */
function actorTakingFunctions(): { file: string; name: string; body: string }[] {
  const out: { file: string; name: string; body: string }[] = [];
  for (const file of readdirSync(SERVICES).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const source = readFileSync(join(SERVICES, file), "utf8");
    const starts = [...source.matchAll(/export async function (\w+)\s*(?:<[^>]*>)?\(/g)];
    starts.forEach((m, i) => {
      // The parameter list: up to the matching ")".
      let at = (m.index ?? 0) + m[0].length;
      let depth = 1;
      while (depth > 0 && at < source.length) {
        if (source[at] === "(") depth++;
        else if (source[at] === ")") depth--;
        at++;
      }
      const params = source.slice((m.index ?? 0) + m[0].length, at - 1);
      if (!/:\s*(?:Actor|User)\b/.test(params)) return;
      const end = starts[i + 1]?.index ?? source.length;
      out.push({ file, name: m[1], body: source.slice(at, end) });
    });
  }
  return out;
}

/**
 * Take an Actor or a User but write nothing a demo visitor could start:
 * the audit sink (only ever called after a guarded write), and a read gate.
 */
const NOT_WRITES = new Set([
  "recordAudit",
  "requirePlan",
  // Team reads and the gates writes call: membership checks that write nothing (src/server/services/orgs.ts).
  "orgAccess",
  "requireOrgPermission",
  "listMyOrgs",
  "listMembers",
  "listInvitations",
  // The billing page's read of the organisation's plan and seats (src/server/services/billing.ts).
  "getOrgBillingView",
  "paysForAnything",
  "listCancellable",
]);

describe("every write service is guarded", () => {
  it("finds the write services (the scan works)", () => {
    const names = actorTakingFunctions().map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["updateContent", "createPost", "upsertPlan", "setUserRole", "mintAgentKey", "restoreAuditEntry", "uploadMedia"]));
  });

  it("calls assertNotDemo first in each exported service that takes an Actor or a User", () => {
    const missing = actorTakingFunctions()
      .filter((f) => !NOT_WRITES.has(f.name))
      .filter((f) => {
        // The guard must be the function's first statement: before it reads or writes anything.
        // The body opens with the "{" that ends the signature's line (a return type may hold braces too).
        const open = f.body.search(/\{\s*\n/);
        const first = f.body.slice(open + 1).trim();
        return !first.startsWith("assertNotDemo(");
      })
      .map((f) => `${f.file}: ${f.name}`);
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------- the guard, at run time

const demoActor: Actor = { type: "user", id: demoUser.id, label: DEMO, readOnly: true };
/** An actor built by hand from the email (no flag), as updateOwnProfile once did. */
const demoByLabel: Actor = { type: "user", id: demoUser.id, label: "Demo@Example.com" };

async function refusals(actor: Actor): Promise<[string, () => Promise<unknown>][]> {
  const content = await import("@/server/services/content");
  const posts = await import("@/server/services/posts");
  const plans = await import("@/server/services/plans");
  const users = await import("@/server/services/users");
  const keys = await import("@/server/services/agent-keys");
  const audit = await import("@/server/services/audit");
  const community = await import("@/server/services/community");
  const media = await import("@/server/services/media");
  const billing = await import("@/server/services/billing");
  const orgs = await import("@/server/services/orgs");
  const plan = { key: "pro", name: "Pro", prices: [], features: [], active: true, order: 0 } as never;
  return [
    ["updateContent", () => content.updateContent("hero", {}, actor)],
    ["resetContent", () => content.resetContent("hero", actor)],
    ["createPost", () => posts.createPost({ kind: "post", title: "x", body: "x" }, actor)],
    ["updatePost", () => posts.updatePost("p1", { title: "x" }, actor)],
    ["setPostStatus", () => posts.setPostStatus("p1", "published", actor)],
    ["deletePost", () => posts.deletePost("p1", actor)],
    ["upsertPlan", () => plans.upsertPlan(plan, actor)],
    ["patchPlan", () => plans.patchPlan("pro", { name: "P" }, actor)],
    ["deletePlan", () => plans.deletePlan("pro", actor)],
    ["carryPlanRename", () => plans.carryPlanRename(null, plan, actor)],
    ["setUserRole", () => users.setUserRole("u1", "admin", actor)],
    ["setUserBanned", () => users.setUserBanned("u1", true, actor)],
    ["deleteUser", () => users.deleteUser("u1", actor)],
    ["updateOwnProfile", () => users.updateOwnProfile(demoUser, { name: "x" })],
    ["deleteOwnAccount", () => users.deleteOwnAccount(demoUser)],
    ["mintAgentKey", () => keys.mintAgentKey("k", "admin", actor)],
    ["revokeAgentKey", () => keys.revokeAgentKey("k1", actor)],
    ["revokeKeysMintedBy", () => keys.revokeKeysMintedBy("u1", actor, "demoted")],
    ["restoreAuditEntry", () => audit.restoreAuditEntry("a1", actor)],
    ["submitFeedback", () => community.submitFeedback({ kind: "bug", message: "hello" }, demoUser)],
    ["updateFeedback", () => community.updateFeedback("f1", { status: "done" }, actor)],
    ["unsubscribe", () => community.unsubscribe("a@example.com", actor)],
    ["uploadMedia", () => media.uploadMedia({ bytes: new Uint8Array([1, 2, 3]) }, actor)],
    ["deleteMedia", () => media.deleteMedia("/uploads/2026/10/x.png", actor)],
    ["startCheckout", () => billing.startCheckout(demoUser, "pro", "month")],
    ["openPortal", () => billing.openPortal(demoUser)],
    ["startOrgCheckout", () => billing.startOrgCheckout(demoUser, "o1", "pro", "month")],
    ["cancelSubscription", () => billing.cancelSubscription(demoUser, "s1")],
    ["createOrg", () => orgs.createOrg(demoUser, { name: "Demo Co" })],
    ["updateOrg", () => orgs.updateOrg(demoUser, "o1", { name: "x" })],
    ["deleteOrg", () => orgs.deleteOrg(demoUser, "o1")],
    ["setMemberRole", () => orgs.setMemberRole(demoUser, "o1", "u1", "member")],
    ["removeMember", () => orgs.removeMember(demoUser, "o1", "u1")],
    ["leaveOrg", () => orgs.leaveOrg(demoUser, "o1")],
    ["transferOwnership", () => orgs.transferOwnership(demoUser, "o1", "u1")],
    ["inviteMember", () => orgs.inviteMember(demoUser, "o1", { email: "a@example.com", role: "member" })],
    ["revokeInvitation", () => orgs.revokeInvitation(demoUser, "o1", "i1")],
    ["acceptInvitation", () => orgs.acceptInvitation(demoUser, "token")],
  ];
}

describe("write services refuse the demo admin", () => {
  it.each([
    ["with actorFor()'s readOnly flag", demoActor],
    ["recognised by its email alone", demoByLabel],
  ])("%s: every one says so and reads or writes nothing", async (_label, actor) => {
    const calls = await refusals(actor);
    // Same list as the static scan, so a new write can't be missing from here either.
    const scanned = actorTakingFunctions()
      .map((f) => f.name)
      .filter((n) => !NOT_WRITES.has(n));
    expect(calls.map(([n]) => n).sort()).toEqual([...new Set(scanned)].sort());
    for (const [name, call] of calls) {
      touched.length = 0;
      await expect(call(), name).rejects.toMatchObject({ name: "ServiceError", code: "forbidden", message: DEMO_READ_ONLY_MESSAGE });
      expect(touched, name).toEqual([]);
    }
  });

  it("lets everyone else through, and refuses nobody once the demo is off", async () => {
    const { updateContent } = await import("@/server/services/content");
    const admin: Actor = { type: "user", id: "a", label: "owner@example.com" };
    await expect(updateContent("hero", { headline: "Hello" }, admin, "merge")).resolves.toMatchObject({ stored: true });
    vi.stubEnv("DEMO_ADMIN_EMAIL", "");
    vi.stubEnv("DEMO_ADMIN_PASSWORD", "");
    await expect(updateContent("hero", { headline: "Again" }, { type: "user", id: "d", label: DEMO }, "merge")).resolves.toMatchObject({ stored: true });
  });

  it("actorFor marks the demo admin, and only it", async () => {
    vi.doMock("@/server/services/audit", () => ({ recordAudit: async () => {} }));
    const { actorFor } = await import("@/server/session");
    expect(actorFor(demoUser)).toMatchObject({ readOnly: true, label: DEMO });
    expect(actorFor({ ...demoUser, email: "owner@example.com" })).not.toHaveProperty("readOnly");
    vi.doUnmock("@/server/services/audit");
  });

  it("the contact form files the demo admin as an anonymous visitor", async () => {
    vi.doMock("@/server/session", () => ({ getCurrentUser: async () => demoUser }));
    vi.doMock("@/server/rate-limit", () => ({ clientIp: async () => "203.0.113.1", rateLimit: () => ({ ok: true, retryAfterSeconds: 0 }) }));
    vi.resetModules();
    const { deliverContact } = await import("@/server/services/contact");
    expect(await deliverContact({ name: "Visitor", email: "visitor@example.com", topic: "general", message: "Hello there" })).toEqual({ ok: true });
    const stored = (await store.feedback.list({ limit: 5 })).items[0];
    expect(stored).toMatchObject({ userId: null, email: "visitor@example.com" });
    vi.doUnmock("@/server/session");
    vi.doUnmock("@/server/rate-limit");
    vi.resetModules();
  });
});

// ---------------------------------------------------------------- the privacy mask

const lens: PrivacyLens = { masking: true, selfEmail: DEMO };

describe("privacy mask", () => {
  it("masks an email to its first letters and top-level domain", () => {
    expect(maskEmail("alice@gmail.com")).toBe("a•••@g•••.com");
    expect(maskEmail("Bob.Smith@mail.example.co.uk")).toBe("B•••@m•••.uk");
    expect(maskEmail("x@localhost")).toBe("x•••@l•••");
    expect(maskEmail("not-an-email")).toBe("n•••");
    expect(maskEmail("@nobody.com")).toBe("@•••");
    expect(maskEmail("émile@exämple.fr")).toBe("é•••@e•••.fr");
  });

  it("masks every word of a name", () => {
    expect(maskName("Alice Smith")).toBe("A••• S•••");
    expect(maskName("  Ada   van  Lovelace ")).toBe("A••• v••• L•••");
  });

  it("masks addresses inside text, but not the viewer's own", () => {
    expect(maskEmailsIn("From alice@gmail.com and demo@example.com", DEMO)).toBe("From a•••@g•••.com and demo@example.com");
  });

  it("redacts free text: addresses and phone numbers, cut to 80", () => {
    expect(redactFreeText("Call +44 20 7946 0958 or mail bob@x.io")).toBe("Call [phone] or mail [email]");
    expect(redactFreeText("a".repeat(200)).length).toBe(80);
  });

  it("shows the viewer's own row and everything to a real admin", () => {
    expect(showEmail(lens, "Demo@Example.com")).toBe("Demo@Example.com");
    expect(showEmail(lens, "carol@example.org")).toBe("c•••@e•••.org");
    expect(showEmail(NO_MASK, "carol@example.org")).toBe("carol@example.org");
    expect(showName(lens, "Demo admin", DEMO)).toBe("Demo admin");
    expect(showName(lens, "Carol King", "carol@example.org")).toBe("C••• K•••");
  });

  it("masks feedback: sender, title redacted, message and note hidden", () => {
    const f: Feedback = {
      id: "f",
      userId: null,
      email: "carol@example.org",
      name: "Carol King",
      kind: "contact",
      title: "Call me at 555 010 9999",
      message: "I'm Carol from Acme",
      status: "new",
      adminNote: "VIP",
      createdAt: "",
      updatedAt: "",
    };
    expect(maskFeedback(lens, f)).toMatchObject({ email: "c•••@e•••.org", name: "C••• K•••", title: "Call me at [phone]", message: HIDDEN_IN_DEMO, adminNote: HIDDEN_IN_DEMO });
    expect(maskFeedback(NO_MASK, f)).toBe(f);
  });

  it("masks audit entries: the actor, the record id and personal JSON", () => {
    const entry: AuditEntry = {
      id: "a",
      actor: { type: "user", id: "u", label: "owner@example.com" },
      action: "user.role",
      entity: "user",
      entityId: "u2",
      before: { email: "carol@example.org", name: "Carol King", role: "user" },
      after: { role: "admin", nested: ["x carol@example.org"] },
      createdAt: "",
    };
    const masked = maskAuditEntry(lens, entry);
    expect(masked.actor.label).toBe("o•••@e•••.com");
    expect(masked.before).toEqual({ email: "c•••@e•••.org", name: "C••• K•••", role: "user" });
    expect(masked.after).toEqual({ role: "admin", nested: ["x c•••@e•••.org"] });
    expect(maskAuditEntry(NO_MASK, entry)).toBe(entry);
    // The site's own words stay: a plan's name is not a person's.
    expect(maskJson(lens, "plan", { name: "Pro" })).toEqual({ name: "Pro" });
    expect(maskJson(lens, "feedback", { message: "hi", status: "done" })).toEqual({ message: HIDDEN_IN_DEMO, status: "done" });
    expect(maskEmailMap(lens, { u: "carol@example.org", d: DEMO })).toEqual({ u: "c•••@e•••.org", d: DEMO });
  });

  it("privacyLens masks for the demo viewer only", async () => {
    const { privacyLens } = await import("@/server/demo");
    expect(privacyLens(demoUser)).toEqual({ masking: true, selfEmail: DEMO });
    expect(privacyLens({ email: "owner@example.com" })).toEqual(NO_MASK);
    expect(privacyLens(null)).toEqual(NO_MASK);
  });
});

// ---------------------------------------------------------------- environment

describe("demo admin environment", () => {
  const strong = "a-long-random-demo-password-0123";

  it("is on with both variables, off with neither", () => {
    expect(resolveDemoAdmin({ DEMO_ADMIN_EMAIL: "Demo@Example.com", DEMO_ADMIN_PASSWORD: strong })).toEqual({ email: "demo@example.com", password: strong });
    expect(resolveDemoAdmin({})).toBeNull();
    expect(demoAdminProblems({})).toEqual([]);
  });

  it("names a half-set, weak or clashing configuration", () => {
    expect(demoAdminProblems({ DEMO_ADMIN_EMAIL: DEMO })[0]).toMatch(/without DEMO_ADMIN_PASSWORD/);
    expect(demoAdminProblems({ DEMO_ADMIN_PASSWORD: strong })[0]).toMatch(/without DEMO_ADMIN_EMAIL/);
    expect(demoAdminProblems({ DEMO_ADMIN_EMAIL: DEMO, DEMO_ADMIN_PASSWORD: "short" })[0]).toMatch(/16–128/);
    expect(demoAdminProblems({ DEMO_ADMIN_EMAIL: "nope", DEMO_ADMIN_PASSWORD: strong })[0]).toMatch(/not an email/);
    expect(demoAdminProblems({ DEMO_ADMIN_EMAIL: DEMO, DEMO_ADMIN_PASSWORD: strong, ADMIN_EMAILS: `x@example.com, ${DEMO}` })[0]).toMatch(/ADMIN_EMAILS/);
    expect(resolveDemoAdmin({ DEMO_ADMIN_EMAIL: DEMO })).toBeNull();
  });

  it("production refuses to start with one variable but not the other", async () => {
    const env = {
      NODE_ENV: "production",
      DATA_PROVIDER: "",
      DATABASE_URL: "postgres://localhost/x",
      BETTER_AUTH_SECRET: "k3J9-x8Qp2Lm7Zr4Vt6Wb1Nc5Yd0Hf8Gs2Ue9Ai",
      NEXT_PUBLIC_SITE_URL: "https://example.com",
      RESEND_API_KEY: "re_x",
      DEMO_ADMIN_EMAIL: DEMO,
      DEMO_ADMIN_PASSWORD: "",
    };
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { checkProductionEnv } = await import("@/server/boot-check");
    expect(() => checkProductionEnv()).toThrow("exit 1");
    expect(errors.mock.calls.flat().join("\n")).toMatch(/DEMO_ADMIN_EMAIL is set without DEMO_ADMIN_PASSWORD/);

    // Both set and strong: it starts.
    vi.stubEnv("DEMO_ADMIN_PASSWORD", "a-long-random-demo-password-0123");
    errors.mockClear();
    expect(() => checkProductionEnv(), errors.mock.calls.flat().join("\n")).not.toThrow();
    exit.mockRestore();
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------- the password never reaches a page

describe("the demo password is a server secret", () => {
  it("is read only by the env rules, env.ts and the demo-account service", () => {
    const ROOT = join(__dirname, "..", "src");
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          // Code only: comments may name the variable.
          const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
          if (/DEMO_ADMIN_PASSWORD|demoAdminLogin\(\)[^;\n]*\.password|login\.password/.test(source)) readers.push(path.slice(ROOT.length + 1));
        }
      }
    };
    walk(ROOT);
    const allowed = new Set(["server/env-rules.ts", "server/env.ts", "server/services/demo-account.ts"]);
    expect(readers.filter((f) => !allowed.has(f))).toEqual([]);
    expect(readers).toContain("server/services/demo-account.ts");
  });
});
