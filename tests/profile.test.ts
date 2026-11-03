//
// OPENSHIPKIT_PROFILE=site — a landing page + blog with no pricing, billing or
// plans (docs/site-profile.md) — against a fresh memory store: the env rule,
// the path list every surface filters with, the routes that 404, the billing
// registry, the MCP registry, and what crawlers read (sitemap, llms.txt,
// JSON-LD). Each check also runs under saas, so the default can't regress
// while the switch is tested.
//

import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/core/data";
import type { AgentScope, User } from "@/core/types";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { createMemoryStore } from "@/adapters/data/memory";
import { forProfile, isSaasOnlyPath, navigationForProfile } from "@/core/profile";
import { resolveBillingProvider, resolveProfile } from "@/server/env-rules";
import { ADMIN_NAV, DASHBOARD_ADMIN_LINK, DASHBOARD_NAV } from "@/lib/app-nav";
import { forTenancy } from "@/core/orgs";
import { articleJsonLd } from "@/shared/jsonld";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));
vi.mock("@/server/auth", () => ({
  getAuth: async () => ({ id: "better-auth", urls: { signIn: "/sign-in", signUp: "/sign-up", account: "/dashboard/settings" }, deleteIdentity: undefined, getIdentity: async () => null }),
}));
// React's cache() is a request-scoped memo; in tests run the function each time.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const SITE = { OPENSHIPKIT_PROFILE: "site" } as const;
/** What notFound() throws, as Next reads it. */
const NOT_FOUND = { digest: expect.stringContaining("404") };

function profile(value: "saas" | "site" | "") {
  vi.stubEnv("OPENSHIPKIT_PROFILE", value);
}

beforeEach(() => {
  store = createMemoryStore({ fresh: true });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  vi.stubEnv("BILLING_PROVIDER", "");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "");
  profile("");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the env rule", () => {
  it("is saas unless set to site, and refuses anything else", () => {
    expect(resolveProfile({})).toBe("saas");
    expect(resolveProfile({ OPENSHIPKIT_PROFILE: "  " })).toBe("saas");
    expect(resolveProfile({ OPENSHIPKIT_PROFILE: "saas" })).toBe("saas");
    expect(resolveProfile({ OPENSHIPKIT_PROFILE: " site " })).toBe("site");
    expect(() => resolveProfile({ OPENSHIPKIT_PROFILE: "blog" })).toThrow(/OPENSHIPKIT_PROFILE="blog" is not one of: saas, site/);
  });

  it("forces billing to none under site, whatever Polar keys are set", () => {
    expect(resolveBillingProvider({ POLAR_ACCESS_TOKEN: "polar_x" })).toBe("polar");
    expect(resolveBillingProvider({ ...SITE, POLAR_ACCESS_TOKEN: "polar_x" })).toBe("none");
    expect(resolveBillingProvider({ ...SITE, BILLING_PROVIDER: "polar", POLAR_ACCESS_TOKEN: "polar_x" })).toBe("none");
    // A typo is still a typo: it doesn't hide behind the profile.
    expect(() => resolveBillingProvider({ ...SITE, BILLING_PROVIDER: "stripe" })).toThrow(/BILLING_PROVIDER/);
  });

  it("is what the server reads, lazily", async () => {
    const { billingProvider, siteProfile } = await import("@/server/env");
    expect(siteProfile()).toBe("saas");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_x");
    expect(billingProvider()).toBe("polar");
    profile("site");
    expect(siteProfile()).toBe("site");
    expect(billingProvider()).toBe("none");
  });
});

describe("SaaS-only paths", () => {
  it("are the pricing page, billing and plans, with their sub-paths, queries and fragments", () => {
    for (const href of ["/pricing", "/pricing/", "/pricing#compare", "/pricing?error=x", "/api/billing/checkout", "/dashboard/billing", "/admin/plans/new"]) {
      expect(isSaasOnlyPath(href), href).toBe(true);
    }
    for (const href of ["/", "/pricing-guide", "/blog/pricing", "/#pricing", "https://example.com/pricing", "//example.com/pricing", "mailto:a@example.com", "/dashboard", "/admin/plansx"]) {
      expect(isSaasOnlyPath(href), href).toBe(false);
    }
  });

  it("leave the navigation as it renders, never as it is stored", () => {
    const nav = DEFAULT_CONTENT.navigation;
    expect(navigationForProfile("saas", nav)).toBe(nav);
    const site = navigationForProfile("site", nav);
    expect(JSON.stringify(site)).not.toContain('"/pricing"');
    expect(site.header.map((l) => l.label)).toEqual(nav.header.filter((l) => l.href !== "/pricing").map((l) => l.label));
    expect(site.footer.map((c) => c.title)).toEqual(nav.footer.map((c) => c.title));
    expect(JSON.stringify(nav)).toContain('"/pricing"'); // the input is untouched

    // A saved navigation too: a CTA to pricing goes, and a column with nothing left goes with it.
    const saved = { header: [{ label: "Plans", href: "/pricing#compare" }], headerCta: { label: "Buy", href: "/pricing" }, footer: [{ title: "Buy", links: [{ label: "Pricing", href: "/pricing" }] }] };
    expect(navigationForProfile("site", saved)).toEqual({ header: [], headerCta: null, footer: [] });
  });

  it("leave the dashboard and admin sidebars", () => {
    const hrefs = (items: { href: string }[]) => items.map((i) => i.href);
    expect(hrefs(forProfile("saas", DASHBOARD_NAV))).toContain("/dashboard/billing");
    // The shell also drops Team unless teams are on (forTenancy, OPENSHIPKIT_TENANCY), so the default sidebar is as before teams.
    expect(hrefs(forTenancy("personal", forProfile("site", [...DASHBOARD_NAV, DASHBOARD_ADMIN_LINK])))).toEqual(["/dashboard", "/dashboard/feedback", "/dashboard/settings", "/admin"]);
    expect(hrefs(forTenancy("org", forProfile("site", DASHBOARD_NAV)))).toContain("/dashboard/team");
    expect(hrefs(forProfile("saas", ADMIN_NAV))).toContain("/admin/plans");
    expect(hrefs(forProfile("site", ADMIN_NAV))).not.toContain("/admin/plans");
    expect(forProfile("site", ADMIN_NAV)).toHaveLength(ADMIN_NAV.length - 1);
  });
});

describe("routes under site", () => {
  it("/pricing is a 404, metadata and page alike", async () => {
    const pricing = await import("@/app/(marketing)/pricing/page");
    profile("site");
    await expect(pricing.generateMetadata()).rejects.toMatchObject(NOT_FOUND);
    await expect(pricing.default({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(NOT_FOUND);
    profile("saas");
    await expect(pricing.generateMetadata()).resolves.toMatchObject({ alternates: { canonical: "/pricing" } });
  });

  it("/dashboard/billing and /admin/plans/** are 404s, their actions too", async () => {
    const billing = await import("@/app/dashboard/billing/page");
    const plansLayout = (await import("@/app/admin/plans/layout")).default;
    const actions = await import("@/app/admin/plans/actions");
    profile("site");
    await expect(billing.default({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(NOT_FOUND);
    expect(() => plansLayout({ children: null })).toThrow(expect.objectContaining(NOT_FOUND));
    const idle = { ok: false, message: "" } as never;
    await expect(actions.savePlan("pro", idle, new FormData())).rejects.toMatchObject(NOT_FOUND);
    await expect(actions.createPlan(idle, new FormData())).rejects.toMatchObject(NOT_FOUND);
    await expect(actions.deletePlanAction("pro")).rejects.toMatchObject(NOT_FOUND);
    profile("saas");
    expect(plansLayout({ children: "plans" })).toBe("plans");
  });

  it("/api/billing/* answer 404 before anything else", async () => {
    const { POST: checkout } = await import("@/app/api/billing/checkout/route");
    const { POST: portal } = await import("@/app/api/billing/portal/route");
    const { POST: webhook } = await import("@/app/api/billing/webhook/route");
    const post = (path: string) => new Request(`https://example.com${path}`, { method: "POST", headers: { origin: "https://example.com", accept: "application/json" }, body: "{}" });
    profile("site");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_x"); // keys set anyway: still nothing
    for (const [handler, path] of [[checkout, "/api/billing/checkout"], [portal, "/api/billing/portal"], [webhook, "/api/billing/webhook"]] as const) {
      const res = await handler(post(path));
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found", message: "Not found" });
    }
    // saas with billing off keeps its own answers (billing_disabled), not the profile's.
    profile("saas");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    expect(await (await webhook(post("/api/billing/webhook"))).json()).toMatchObject({ error: "billing_disabled" });
    expect(await (await checkout(post("/api/billing/checkout"))).json()).toMatchObject({ error: "billing_disabled" });
  });

  it("a plan gate sends a visitor to the dashboard, not to the 404 /pricing", async () => {
    const { requirePlan } = await import("@/server/services/billing");
    const user = { id: "u-gate" } as User; // holds nothing: the gate reads only webhook-written rows by id
    await expect(requirePlan(user, ["pro"])).rejects.toMatchObject({ digest: expect.stringContaining(";/pricing;") });
    profile("site");
    await expect(requirePlan(user, ["pro"])).rejects.toMatchObject({ digest: expect.stringContaining(";/dashboard;") });
    await expect(requirePlan(user, ["pro"], "/contact")).rejects.toMatchObject({ digest: expect.stringContaining(";/contact;") });
  });

  it("the billing registry is off", async () => {
    const { getBilling } = await import("@/server/billing");
    const { isBillingEnabled } = await import("@/server/services/billing");
    profile("site");
    vi.stubEnv("BILLING_PROVIDER", "polar");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_x");
    expect(await getBilling()).toBeNull();
    expect(await isBillingEnabled()).toBe(false);
  });
});

describe("what crawlers read under site", () => {
  async function sitemapUrls(): Promise<string[]> {
    const sitemap = (await import("@/app/sitemap")).default;
    return (await sitemap()).map((e) => e.url);
  }

  it("the sitemap has no /pricing", async () => {
    expect(await sitemapUrls()).toContain("https://example.com/pricing");
    profile("site");
    const urls = await sitemapUrls();
    expect(urls.some((u) => u.includes("/pricing"))).toBe(false);
    expect(urls).toEqual(expect.arrayContaining(["https://example.com/", "https://example.com/contact", "https://example.com/blog", "https://example.com/changelog"]));
  });

  it("llms.txt and llms-full.txt name no pricing page and no plans", async () => {
    const { buildLlmsFullTxt, buildLlmsTxt } = await import("@/components/seo/llms");
    const plan = (await store.plans.list())[0];
    expect(plan).toBeDefined();
    expect(await buildLlmsTxt()).toContain("https://example.com/pricing");
    profile("site");
    for (const text of [await buildLlmsTxt(), await buildLlmsFullTxt()]) {
      expect(text).not.toContain("/pricing");
      expect(text).not.toContain(`${plan.name}:`);
    }
  });

  it("the home page has no pricing section and no Offer", async () => {
    const { Pricing } = await import("@/components/sections/pricing");
    const { SoftwareJsonLd } = await import("@/components/seo/site-json-ld");
    const HomePage = (await import("@/app/(marketing)/page")).default;
    /** The elements the page places directly (sections are async components, not rendered here). */
    const placed = async () => ((await HomePage()).props as { children: unknown[] }).children.filter(isValidElement) as ReactElement<Record<string, unknown>>[];
    const offers = async () => ((await SoftwareJsonLd({})).props as { data: Record<string, unknown> }).data.offers;

    expect((await placed()).some((el) => el.type === Pricing)).toBe(true);
    expect((await placed())[0].props).toMatchObject({ offers: true }); // the showcase's free Offer
    expect(await offers()).toBeDefined();

    profile("site");
    expect((await placed()).some((el) => el.type === Pricing)).toBe(false);
    expect((await placed())[0].props).toMatchObject({ offers: false });
    expect(await offers()).toBeUndefined();
  });
});

describe("MCP under site", () => {
  const SYSTEM = { type: "system" as const, id: null, label: "test" };

  async function keyCtx(scope: AgentScope) {
    const { mintAgentKey } = await import("@/server/services/agent-keys");
    const { authenticateMcp } = await import("@/server/mcp/auth");
    const { key } = await mintAgentKey(`${scope} ${randomUUID().slice(0, 8)}`, scope, SYSTEM);
    const ctx = await authenticateMcp(key);
    if (!ctx) throw new Error("minted key did not authenticate");
    return ctx;
  }

  async function rpc(scope: AgentScope, method: string, params?: Record<string, unknown>) {
    const { handleMcpMessage } = await import("@/server/mcp/protocol");
    const reply = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }, await keyCtx(scope));
    return reply as { result?: Record<string, unknown>; error?: { message: string } };
  }

  const listed = async () => ((await rpc("admin", "tools/list")).result?.tools as { name: string }[]).map((t) => t.name);

  it("the registry offers no plan tools", async () => {
    const { PLAN_TOOLS } = await import("@/server/mcp/tools/plans");
    const { TOOLS, toolsForProfile } = await import("@/server/mcp/tools");
    const planNames = PLAN_TOOLS.map((t) => t.name);
    expect(planNames).toEqual(["plans_list", "plan_get", "plan_upsert", "plan_update", "plan_delete"]);
    expect(toolsForProfile("saas")).toBe(TOOLS);
    expect(toolsForProfile("site").map((t) => t.name)).toEqual(TOOLS.map((t) => t.name).filter((n) => !planNames.includes(n)));
  });

  it("tools/list leaves them out and tools/call doesn't know them", async () => {
    expect(await listed()).toContain("plan_get");
    profile("site");
    const names = await listed();
    expect(names.filter((n) => n.startsWith("plan"))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(["site_overview", "guide", "content_get", "post_create", "audit_restore"]));

    const call = await rpc("admin", "tools/call", { name: "plan_get", arguments: { key: "pro" } });
    expect(call.error?.message).toMatch(/^Unknown tool: plan_get/);
  });

  it("the guide, the instructions and the overview say so", async () => {
    profile("site");
    const guide = (await rpc("read", "tools/call", { name: "guide", arguments: {} })).result?.structuredContent as Record<string, unknown>;
    expect(guide.plans).toBeUndefined();
    expect(String(guide.what)).toContain("OPENSHIPKIT_PROFILE=site");
    const plans = (await rpc("read", "tools/call", { name: "guide", arguments: { topic: "plans" } })).result?.structuredContent as { plans: { model: string } };
    expect(plans.plans.model).toMatch(/no plan tools/);
    expect(String((await rpc("read", "initialize")).result?.instructions)).toMatch(/no plan tools/);
    const overview = (await rpc("read", "tools/call", { name: "site_overview", arguments: {} })).result?.structuredContent as { stack: Record<string, unknown> };
    expect(overview.stack).toMatchObject({ profile: "site", billing: "none" });
  });
});

describe("the production boot check", () => {
  const GOOD = {
    DATABASE_URL: "postgres://u:p@db:5432/app",
    BETTER_AUTH_SECRET: "q8Vd0mJ2rX5tL9wB3nH7yK1cF4gP6sZaE0uT2iO8",
    NEXT_PUBLIC_SITE_URL: "https://example.com",
    RESEND_API_KEY: "re_x",
    EMAIL_PROVIDER: "",
    BETTER_AUTH_SECRETS: "",
  };

  async function boot(env: Record<string, string>) {
    for (const [k, v] of Object.entries({ ...GOOD, ...env })) vi.stubEnv(k, v);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const lines: string[] = [];
    for (const level of ["error", "warn", "info"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
    const { checkProductionEnv } = await import("@/server/boot-check");
    checkProductionEnv();
    return { exited: exit.mock.calls.length > 0, log: lines.join("\n") };
  }

  it("refuses an unknown profile", async () => {
    const { exited, log } = await boot({ OPENSHIPKIT_PROFILE: "blog" });
    expect(exited).toBe(true);
    expect(log).toContain('OPENSHIPKIT_PROFILE="blog" is not one of: saas, site');
  });

  it("says the site profile ignores Polar keys", async () => {
    const quiet = await boot({ OPENSHIPKIT_PROFILE: "site" });
    expect(quiet.exited).toBe(false);
    expect(quiet.log).toContain("OPENSHIPKIT_PROFILE=site: a landing page + blog");
    vi.restoreAllMocks();
    const keys = await boot({ OPENSHIPKIT_PROFILE: "site", POLAR_ACCESS_TOKEN: "polar_x" });
    expect(keys.exited).toBe(false);
    expect(keys.log).toMatch(/POLAR_ACCESS_TOKEN is ignored and \/api\/billing\/\* answer 404/);
  });

  it("says nothing about profiles under saas", async () => {
    const { exited, log } = await boot({ POLAR_ACCESS_TOKEN: "polar_x" });
    expect(exited).toBe(false);
    expect(log).not.toContain("OPENSHIPKIT_PROFILE");
  });
});

describe("article authors", () => {
  it("are one Person entity across articles, by a stable @id", () => {
    const article = (path: string, authorName: string | null) =>
      articleJsonLd({ base: "https://example.com", path, headline: "X", publisherName: "Acme", authorName }).author as Record<string, unknown>;
    const a = article("/blog/a", "Ada Lovelace");
    expect(a).toMatchObject({ "@type": "Person", "@id": "https://example.com/#person-ada-lovelace", name: "Ada Lovelace" });
    expect(article("/blog/b", "Ada Lovelace")["@id"]).toBe(a["@id"]);
    expect(article("/blog/c", "Grace Hopper")["@id"]).toBe("https://example.com/#person-grace-hopper");
    // Nothing to slug: no shared "#person-" id, the Person stands alone.
    expect(article("/blog/d", "李雷")).toEqual({ "@type": "Person", name: "李雷" });
    // No person: the Organization, as before.
    expect(article("/blog/e", null)).toMatchObject({ "@type": "Organization", "@id": "https://example.com/#organization" });
  });
});
