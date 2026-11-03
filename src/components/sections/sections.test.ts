//
// Unit tests for the marketing sections' pure logic: the plan cards' price and
// feature rules, the viewer's-plan state, and how a step's code becomes panel
// lines. The cards are rendered to static HTML (no DOM) to check what a visitor
// actually gets: forms that post without JavaScript, and the right action for
// a signed-in viewer's own plan.
//

import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Plan, PriceInterval, Purchase, Subscription } from "@/core/types";
import { checkoutRefusal } from "@/server/services/billing";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { SEED_PLANS } from "@/content/seed";
import { ADMIN_NAV } from "@/lib/app-nav";
import { PANEL_BG, TEXT_MIN, contrast, readableOn } from "@/shared/code-contrast";
import { STARTER_PROMPT } from "./ai-setup";
import { DEPLOY_TARGETS } from "./deploy";
import { groupLogos } from "./logos";
import { isDocsHref, withoutDocsLinks } from "@/components/site/docs-links";
import { toolMark } from "./tool-marks";
import { Faq } from "./faq";
import { HeroPreview, previewCopy } from "./hero-preview";
import {
  AGENT_KEY,
  AGENT_TITLE,
  EARLIER_TITLE,
  LOG_CAP,
  SAMPLE_POST,
  TABS,
  TAB_HREF,
  TITLE_MAX,
  agentCanPlay,
  demoReducer,
  initialDemo,
  restorable,
  type DemoEvent,
  type DemoState,
} from "./hero-preview/demo-state";
import { codeLines, envCopyText } from "./steps";
import { planCovers } from "@/core/plans";
import { PricingPlans, isCurrentPlan } from "./pricing-plans";
import { basePlans, comparisonRows, hasIntervalChoice, priceFor, quantityOf, resolveFeatures, yearlySaving } from "./plan-rules";

const plans: Plan[] = SEED_PLANS.map((p, i) => ({
  id: `plan_${i}`,
  key: p.key,
  name: p.name,
  description: p.description ?? "",
  features: p.features ?? [],
  prices: (p.prices ?? []).map((x) => ({ ...x, currency: x.currency ?? "usd", polarProductId: x.polarProductId ?? null })),
  highlighted: p.highlighted ?? false,
  contactSales: p.contactSales ?? false,
  ctaLabel: p.ctaLabel ?? "Get started",
  trialDays: p.trialDays ?? null,
  active: true,
  sortOrder: i, limits: {},
  updatedAt: "2026-10-06T00:00:00.000Z",
}));
const byKey = (k: string) => plans.find((p) => p.key === k)!;

describe("plan rules", () => {
  it("expands “Everything in <Plan>” into that plan’s features", () => {
    const lifetime = resolveFeatures(byKey("lifetime"), plans);
    expect(lifetime).toEqual(expect.arrayContaining(byKey("pro").features));
    expect(lifetime).not.toContain("Everything in Pro");
  });

  it("picks the price for the interval, else the only one", () => {
    expect(priceFor(byKey("pro"), "year")?.interval).toBe("year");
    expect(priceFor(byKey("lifetime"), "month")?.interval).toBe("one_time");
    expect(priceFor(byKey("free"), "month")).toBeNull();
  });

  it("computes the yearly saving from the plans, never typed", () => {
    expect(hasIntervalChoice(plans)).toBe(true);
    // $19 a month vs $190 a year: 1 − 190 / 228 = 16.7 % → 16
    expect(yearlySaving(plans)).toBe(16);
    expect(hasIntervalChoice([byKey("free"), byKey("lifetime")])).toBe(false);
  });

  it("knows the viewer’s plan from the entitlement only", () => {
    expect(isCurrentPlan(byKey("free"), null)).toBe(false);
    expect(isCurrentPlan(byKey("free"), { planKey: null, source: "free" })).toBe(true);
    expect(isCurrentPlan(byKey("enterprise"), { planKey: null, source: "free" })).toBe(false);
    expect(isCurrentPlan(byKey("pro"), { planKey: "pro", source: "subscription" })).toBe(true);
    expect(isCurrentPlan(byKey("free"), { planKey: "pro", source: "subscription" })).toBe(false);
  });
});

describe("plan cards", () => {
  it("render checkout as plain forms, with the monthly view shown first", () => {
    const html = renderToStaticMarkup(createElement(PricingPlans, { plans, id: "t" }));
    expect(html).toContain('action="/api/billing/checkout"');
    expect(html).toContain('name="planKey" value="pro"');
    expect(html).toContain('href="/contact?topic=sales"');
    expect(html).toContain('href="/sign-up"');
    expect(html).toMatch(/id="t-month"[^>]*checked/);
    expect(html).not.toContain("Your plan");
  });

  it("give a subscriber Manage billing on their own plan instead of a second checkout", () => {
    const html = renderToStaticMarkup(
      createElement(PricingPlans, { plans, id: "t", current: { planKey: "pro", source: "subscription" } }),
    );
    expect(html).toContain("Your plan");
    expect(html).toContain('action="/api/billing/portal"');
    expect(html).not.toContain('name="planKey" value="pro"');
    expect(html).toContain('name="planKey" value="lifetime"'); // other plans still check out
  });

  it("show the refusal's label instead of a checkout that would be refused", () => {
    const now = new Date("2026-10-07T00:00:00.000Z");
    const guard =
      (rows: { subscriptions?: Subscription[]; purchases?: Purchase[] }) =>
      (planKey: string, interval: PriceInterval) =>
        checkoutRefusal({ planKey, interval, subscriptions: rows.subscriptions ?? [], purchases: rows.purchases ?? [], plans, now });
    const lifetime: Purchase = {
      id: "pu1", userId: "u1", provider: "polar", providerOrderId: "o1", planKey: "lifetime",
      amountCents: 29900, currency: "usd", refunded: false, createdAt: "2026-10-01T00:00:00.000Z",
    };
    // A Lifetime owner: Pro is already theirs, so no Pro checkout.
    const owner = renderToStaticMarkup(
      createElement(PricingPlans, { plans, id: "t", current: { planKey: "lifetime", source: "purchase", refuse: guard({ purchases: [lifetime] }) } }),
    );
    expect(owner).not.toContain('name="planKey" value="pro"');
    expect(owner).toContain("Included in your Lifetime plan");

    // A renewing Pro subscriber: Lifetime would leave the subscription renewing.
    const pro: Subscription = {
      id: "s1", userId: "u1", provider: "polar", providerSubscriptionId: "ps1", providerCustomerId: null, planKey: "pro",
      interval: "month", status: "active", currentPeriodEnd: "2026-11-01T00:00:00.000Z", cancelAtPeriodEnd: false, orgId: null, seats: null,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const subscriber = renderToStaticMarkup(
      createElement(PricingPlans, { plans, id: "t", current: { planKey: "pro", source: "subscription", refuse: guard({ subscriptions: [pro] }) } }),
    );
    expect(subscriber).not.toContain('name="planKey" value="lifetime"');
    expect(subscriber).toContain("Cancel your subscription first");
    expect(subscriber).toContain('href="/dashboard/billing"');
  });

  it("show a free viewer the dashboard on the free plan", () => {
    const html = renderToStaticMarkup(createElement(PricingPlans, { plans, id: "t", current: { planKey: null, source: "free" } }));
    expect(html).toContain("Go to your dashboard");
    expect(html).not.toContain('action="/api/billing/portal"');
  });
});

describe("plan comparison", () => {
  it("lets a plan's own amount replace the one it inherits", () => {
    expect(quantityOf("1 project")?.key).toBe(quantityOf("Unlimited projects")?.key);
    expect(quantityOf("Community support")).toBeNull();
    const pro = { ...byKey("pro"), features: ["Everything in Free", "Unlimited projects", "Custom domain"] };
    const list = [byKey("free"), pro];
    expect(resolveFeatures(pro, list)).toEqual(["Unlimited projects", "Community support", "All core features", "Custom domain"]);
  });

  it("puts amounts of the same thing on one row", () => {
    const projects = comparisonRows(plans).find((r) => r.label === "Projects");
    expect(projects?.cells).toEqual(["1", "Unlimited", "Unlimited", "Unlimited"]);
    expect(comparisonRows(plans).some((r) => r.label === "1 project" || r.label === "Unlimited projects")).toBe(false);
  });

  it("expands exactly the plans the entitlement layer says a plan covers", () => {
    // The cards and requirePlan read one rule (src/core/plans.ts); a card listing a plan's
    // features must mean billing grants that plan.
    for (const plan of plans) {
      const shown = basePlans(plan, plans).map((p) => p.key);
      for (const other of plans) {
        if (other.key === plan.key) continue;
        expect(shown.includes(other.key), `${plan.name} → ${other.name}`).toBe(planCovers(plan.key, other.key, plans));
      }
    }
  });

  it("never shows a plan without a feature of a plan it builds on", () => {
    const withBase = plans.map((p) => (p.key === "pro" ? { ...p, features: ["Everything in Free", ...p.features] } : p));
    for (const set of [plans, withBase]) {
      const rows = comparisonRows(set);
      set.forEach((plan, col) => {
        for (const base of basePlans(plan, set)) {
          const b = set.indexOf(base);
          for (const row of rows) if (row.cells[b]) expect(row.cells[col], `${plan.name} / ${row.label}`).toBeTruthy();
        }
      });
    }
  });
});

describe("plan card outline and payments", () => {
  const headings = (html: string, tag: string) => html.match(new RegExp(`<${tag}[ >]`, "g"))?.length ?? 0;

  it("render each plan once, at the heading level asked for", () => {
    expect(headings(renderToStaticMarkup(createElement(PricingPlans, { plans, id: "t" })), "h3")).toBe(plans.length);
    const asH2 = renderToStaticMarkup(createElement(PricingPlans, { plans, id: "t", headingLevel: 2 }));
    expect(headings(asH2, "h2")).toBe(plans.length);
    expect(headings(asH2, "h3")).toBe(0);
  });

  it("say “Not on sale yet” instead of a checkout while payments are off", () => {
    const html = renderToStaticMarkup(createElement(PricingPlans, { plans, id: "t", billingOn: false }));
    expect(html).not.toContain('action="/api/billing/checkout"');
    expect(html).toContain("Not on sale yet");
    expect(html).toMatch(/aria-describedby="t-pro-off"/);
    expect(html).toContain('id="t-pro-off"');
    expect(html).toContain('href="/sign-up"'); // free still works
    expect(html).toContain('href="/contact?topic=sales"');
  });
});

describe("step code", () => {
  it("separates commands, notes and env lines", () => {
    expect(codeLines("# optional\nPOLAR_ACCESS_TOKEN=…\n\n  npm run dev  ")).toEqual([
      { kind: "note", text: "# optional" },
      { kind: "out", text: "POLAR_ACCESS_TOKEN=…" },
      { kind: "cmd", text: "npm run dev" },
    ]);
  });

  it("copies an env file with its placeholders left empty, never a literal …", () => {
    const copied = envCopyText(codeLines(DEFAULT_CONTENT.steps.items.find((s) => s.code.includes("RESEND_API_KEY"))!.code));
    expect(copied).toBe("POLAR_ACCESS_TOKEN=\nPOLAR_WEBHOOK_SECRET=\nRESEND_API_KEY=");
    expect(copied).not.toContain("…");
    expect(envCopyText(codeLines("APP_URL=https://example.com"))).toBe("APP_URL=https://example.com");
  });
});

describe("hero preview", () => {
  const props = { siteName: "OpenShipKit", url: "localhost:3000/admin", title: DEFAULT_CONTENT.hero.title, eyebrow: DEFAULT_CONTENT.hero.eyebrow };
  const html = renderToStaticMarkup(createElement(HeroPreview, props));
  const navLabels = [...html.matchAll(/data-preview-nav="true"[^>]*>.*?<span class="truncate">([^<]+)<\/span>/g)].map((m) => m[1]);
  const copy = previewCopy();
  const initialSentences = initialDemo("t").log.map((e) => `${copy.words[e.action].verb}</span> ${copy.words[e.action].target}`);

  it("shows the admin nav's screens it opens, in the nav's order, and no dead items", () => {
    expect(navLabels).toEqual(ADMIN_NAV.filter((n) => TABS.some((t) => TAB_HREF[t] === n.href)).map((n) => n.label));
    expect(navLabels).toHaveLength(TABS.length);
  });

  it("has the overview in the first byte: its words, its figures and its changes, as the admin writes them", () => {
    for (const text of ["Overview", "Database healthy", "Paying now", "1,284", "Recent changes", "Running on", "Sample data"]) expect(html).toContain(text);
    for (const sentence of initialSentences.slice(0, 4)) expect(html).toContain(sentence);
    expect(html).not.toMatch(/content\.update|post\.publish/);
    // the overview panel is the one shown; the others wait, hidden, in the same cell
    expect(html).toMatch(/role="tabpanel"[^>]*data-screen="overview"/);
    expect(html.match(/data-off=""/g)).toHaveLength(TABS.length - 1);
    expect(html).not.toMatch(/role="tabpanel"[^>]*data-off=""[^>]*data-screen="overview"/);
  });

  it("writes the demo's sentences with describeAudit and actorWords", () => {
    expect(copy.words["content.update"]).toEqual({ verb: "Edited", target: "“Hero”" });
    expect(copy.words["content.restore"].verb).toBe("Restored");
    expect(copy.words["post.publish"]).toEqual({ verb: "Published", target: `the post “${SAMPLE_POST}”` });
    expect(copy.words["agent_key.create"].target).toBe(`the agent key “${AGENT_KEY}”`);
    expect(copy.actors).toEqual({ you: "you@example.com", agent: `Agent · ${AGENT_KEY}`, cursor: "Agent · cursor" });
  });

  it("is a labelled region with real tabs, not one image", () => {
    expect(html).not.toContain('role="img"');
    expect(html).toContain('role="region" aria-label="Interactive preview of the OpenShipKit admin, with sample data"');
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(TABS.length);
    expect(tabs.filter((t) => t.includes('aria-selected="true"'))).toHaveLength(1);
    expect(tabs.filter((t) => t.includes('tabindex="0"'))).toHaveLength(1);
    for (const t of tabs) expect(t).toMatch(/aria-controls="[^"]+"/);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(TABS.length);
  });

  it("never plays on load: the agent's control is a button, its edit not yet in the page", () => {
    expect(html).toContain("Watch an agent edit");
    expect(html).not.toContain(AGENT_TITLE);
  });

  it("says what the agent section's transcript says, and the mint form's words", () => {
    expect(readFileSync("src/components/sections/agent.tsx", "utf8")).toContain(`const AFTER = "${AGENT_TITLE}"`);
    const mint = readFileSync("src/components/admin/mint-key-form.tsx", "utf8");
    const preview = readFileSync("src/components/sections/hero-preview.tsx", "utf8");
    const bodies = [...preview.matchAll(/body: "([^"]+)"/g)].map((m) => m[1]);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) expect(mint).toContain(body);
    // Write is chosen first, as in the admin
    expect(html).toContain(bodies[1]);
  });
});

describe("hero preview demo", () => {
  const TITLE = DEFAULT_CONTENT.hero.title;
  const run = (events: DemoEvent[], s = initialDemo(TITLE)) => events.reduce(demoReducer, s);
  const top = (s: DemoState) => s.log[0];

  it("opens on the overview with the site's own title and nothing fresh", () => {
    const s = initialDemo(TITLE);
    expect(s).toMatchObject({ tab: "overview", title: TITLE, draft: TITLE, post: "published", agent: "ready", fresh: null, message: "" });
    expect(s.log.every((e) => !e.undone && e.minutesAgo > 0)).toBe(true);
  });

  it("switches tabs and nothing else", () => {
    const s = run([{ type: "tab", tab: "posts" }]);
    expect(s.tab).toBe("posts");
    expect(s.log).toEqual(initialDemo(TITLE).log);
    const same = initialDemo(TITLE);
    expect(demoReducer(same, { type: "tab", tab: "overview" })).toBe(same);
  });

  it("follows typing in the draft only, and saves it as a logged change", () => {
    const typed = run([{ type: "edit", value: "Own every layer" }]);
    expect(typed).toMatchObject({ draft: "Own every layer", title: TITLE, log: initialDemo(TITLE).log });
    expect(run([{ type: "edit", value: "x".repeat(200) }]).draft).toHaveLength(TITLE_MAX);
    const saved = demoReducer(typed, { type: "save" });
    expect(saved.title).toBe("Own every layer");
    expect(top(saved)).toMatchObject({ action: "content.update", actor: "you", before: TITLE, after: "Own every layer", minutesAgo: 0 });
    expect(saved.fresh).toBe(top(saved).id);
    // nothing to save: unchanged or empty
    expect(demoReducer(saved, { type: "save" })).toBe(saved);
    expect(run([{ type: "edit", value: "   " }, { type: "save" }]).title).toBe(TITLE);
  });

  it("plays the agent's edit once, on demand: calling, then applied, logged, with Undo", () => {
    const calling = run([{ type: "agent" }]);
    expect(calling).toMatchObject({ agent: "calling", tab: "content", title: TITLE });
    expect(calling.log).toHaveLength(initialDemo(TITLE).log.length);
    // a second press while it runs does nothing; nor does applying twice
    expect(demoReducer(calling, { type: "agent" })).toBe(calling);
    const done = demoReducer(calling, { type: "agent-apply" });
    expect(demoReducer(done, { type: "agent-apply" })).toBe(done);
    expect(done).toMatchObject({ agent: "done", title: AGENT_TITLE, draft: AGENT_TITLE, agentUsed: true });
    expect(top(done)).toMatchObject({ action: "content.update", actor: "agent", before: TITLE, after: AGENT_TITLE, undone: false });
    expect(done.agentEntry).toBe(top(done).id);
    expect(done.fresh).toBe(top(done).id);
    expect(restorable(top(done))).toBe(true);
    // and it doesn't play again while its edit stands
    expect(agentCanPlay(done)).toBe(false);
    expect(demoReducer(done, { type: "agent" })).toBe(done);
    // nothing applies without a press
    expect(demoReducer(initialDemo(TITLE), { type: "agent-apply" })).toEqual(initialDemo(TITLE));
  });

  it("undo restores the title as a new change by you, and then the agent may be watched again", () => {
    const done = run([{ type: "agent" }, { type: "agent-apply" }]);
    const undone = demoReducer(done, { type: "undo", id: done.agentEntry! });
    expect(undone).toMatchObject({ title: TITLE, draft: TITLE });
    expect(top(undone)).toMatchObject({ action: "content.restore", actor: "you", before: AGENT_TITLE, after: TITLE });
    expect(undone.log.find((e) => e.id === done.agentEntry)?.undone).toBe(true);
    expect(undone.message).toContain("Restored");
    // the same entry can't be undone twice
    expect(demoReducer(undone, { type: "undo", id: done.agentEntry! })).toBe(undone);
    expect(agentCanPlay(undone)).toBe(true);
    const again = run([{ type: "agent" }, { type: "agent-apply" }], undone);
    expect(again.title).toBe(AGENT_TITLE);
    // the restore is itself undoable, as in the product
    expect(demoReducer(undone, { type: "undo", id: top(undone).id }).title).toBe(AGENT_TITLE);
  });

  it("undo of the two-day-old edit brings back the earlier title", () => {
    const s = initialDemo(TITLE);
    const old = s.log.find((e) => e.thing === "hero")!;
    expect(demoReducer(s, { type: "undo", id: old.id }).title).toBe(EARLIER_TITLE);
  });

  it("undo of the cursor key's publish makes the post a draft again; plans, feedback and keys can't be undone here", () => {
    const s = initialDemo(TITLE);
    const publish = s.log.find((e) => e.action === "post.publish")!;
    const r = demoReducer(s, { type: "undo", id: publish.id });
    expect(r.post).toBe("draft");
    expect(top(r)).toMatchObject({ action: "post.restore", before: "published", after: "draft" });
    for (const e of s.log.filter((x) => x.thing === null)) {
      expect(restorable(e)).toBe(false);
      expect(demoReducer(s, { type: "undo", id: e.id })).toBe(s);
    }
    expect(demoReducer(s, { type: "undo", id: "nope" })).toBe(s);
  });

  it("keeps the log bounded and its ids unique", () => {
    let s = initialDemo(TITLE);
    for (let i = 0; i < 12; i++) s = run([{ type: "edit", value: `Title ${i}` }, { type: "save" }], s);
    expect(s.log).toHaveLength(LOG_CAP);
    expect(new Set(s.log.map((e) => e.id)).size).toBe(LOG_CAP);
  });
});

describe("FAQ band", () => {
  const items = [{ question: "Is there a free trial of Pro?", answer: "Yes. Pro starts with a 14-day free trial." }];

  it("emits FAQPage JSON-LD for the questions shown", async () => {
    const html = renderToStaticMarkup(await Faq({ items, title: "Pricing questions" }));
    expect(html).toContain("application/ld+json");
    expect(html).toContain('"FAQPage"');
  });

  // The showcase's /pricing answers about SAMPLE plans: the page turns the markup off.
  it("renders without FAQPage when the page turns it off", async () => {
    const html = renderToStaticMarkup(await Faq({ items, title: "Pricing questions", emitJsonLd: false }));
    expect(html).toContain("14-day free trial");
    expect(html).not.toContain("application/ld+json");
  });
});

describe("deploy commands", () => {
  // The landing page's deploy recipes are copied and run: every script and file they name must exist.
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  // A command written over several lines (a trailing " \\") is one command: join it back as the shell does.
  const commands = DEPLOY_TARGETS.flatMap((t) =>
    t.panels.flatMap((p) => p.lines.filter((l) => l.kind === "cmd").map((l) => l.text.replace(/\s*\\\n\s*/g, " "))),
  );

  it("run only package.json scripts that exist", () => {
    for (const cmd of commands) {
      for (const [, name] of cmd.matchAll(/npm run ([\w:-]+)/g)) expect(pkg.scripts[name], cmd).toBeDefined();
      if (/\bnpm start\b/.test(cmd)) expect(pkg.scripts.start).toBeDefined();
    }
  });

  it("name only files that are in the repository", () => {
    for (const cmd of commands) for (const [file] of cmd.matchAll(/scripts\/[\w-]+\.mts/g)) expect(existsSync(file), cmd).toBe(true);
  });

  it("never copy public/, which the repository doesn't have (npm start copies it only when it exists)", () => {
    for (const cmd of commands) expect(cmd).not.toMatch(/cp -r public/);
  });

  it("set up a compose server without Node.js and with the domain compose requires", () => {
    const setup = commands.find((c) => c.includes("setup.mts"));
    expect(setup).toMatch(/^docker run .* node scripts\/setup\.mts --compose --domain /);
  });

  it("update a compose server in three steps, never one up -d --build after the first deploy", () => {
    const vps = DEPLOY_TARGETS.find((t) => t.id === "vps")!;
    const update = vps.panels.find((p) => p.title.includes("update"))!.lines.map((l) => l.text);
    expect(update).toEqual([
      "git pull",
      "docker compose --profile https build",
      "docker compose run --rm migrate",
      "docker compose --profile https up -d",
    ]);
  });

  it("quote only compose services and profiles that docker-compose.yml defines", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    for (const cmd of commands) {
      for (const [, profile] of cmd.matchAll(/--profile (\w+)/g)) expect(compose, cmd).toContain(`profiles: ["${profile}"]`);
      for (const [, service] of cmd.matchAll(/compose run --rm (\w+)/g)) expect(compose, cmd).toMatch(new RegExp(`^  ${service}:`, "m"));
    }
  });
});

describe("code colours", () => {
  it("measure the panel on the card token of each scheme", () => {
    // code-contrast.ts measures against these; if tokens.css moves --card, the guarantee would be on the wrong colour.
    const tokens = readFileSync("src/styles/tokens.css", "utf8");
    const cards = [...tokens.matchAll(/--card:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase());
    expect(cards).toContain(PANEL_BG.light);
    expect(cards).toContain(PANEL_BG.dark);
  });

  it("raise a colour that falls short to the text floor, and leave a passing one alone", () => {
    // github-light's orange is 3.5:1 on white.
    const fixed = readableOn("#E36209", PANEL_BG.light);
    expect(contrast("#E36209", PANEL_BG.light)).toBeLessThan(TEXT_MIN);
    expect(contrast(fixed, PANEL_BG.light)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(readableOn("#6F42C1", PANEL_BG.light)).toBe("#6F42C1");
    // and on the dark card, upwards
    expect(contrast(readableOn("#444C56", PANEL_BG.dark), PANEL_BG.dark)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(readableOn("inherit", PANEL_BG.dark)).toBe("inherit");
  });
});

describe("built-on strip", () => {
  it("groups items in first-appearance order, and keeps ungrouped content as one row", () => {
    const groups = groupLogos(DEFAULT_CONTENT.logos.items);
    expect(groups.map((g) => g.name)).toEqual(["Built on", "Deploys to servers you control"]);
    expect(groupLogos([{ name: "Acme", href: "", group: "" }])).toEqual([{ name: "", items: [{ name: "Acme", href: "", group: "" }] }]);
  });

  it("shows each host's own mark: Dokploy's from its repository (not in Simple Icons), on its own square viewBox", () => {
    // Dokploy's logo comes from apps/dokploy/public/logo.svg in its repository, cropped square (tool-marks.ts).
    expect(toolMark("Dokploy")?.title).toBe("Dokploy");
    expect(toolMark("Dokploy")?.viewBox).toBe("91.57 99.1 450.35 450.35");
    for (const name of ["Docker", "Coolify", "Caddy", "Traefik", "Next.js", "Postgres"]) expect(toolMark(name), name).not.toBeNull();
  });
});

describe("starter prompt", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  it("names only scripts and files the repository has", () => {
    for (const [, name] of STARTER_PROMPT.matchAll(/npm run ([\w:-]+)/g)) expect(pkg.scripts[name], name).toBeDefined();
    for (const [file] of STARTER_PROMPT.matchAll(/\b[\w/-]+\.(?:md|ts)\b/g)) expect(existsSync(file), file).toBe(true);
  });

  it("stops before deploying", () => {
    expect(STARTER_PROMPT).toMatch(/Stop before deploying/);
  });

  it("runs setup before the dev server and never asks for content in defaults.ts", () => {
    // docs/ai-setup.md: setup writes .env.local first; content goes through MCP ("stored content overrides it").
    expect(STARTER_PROMPT.indexOf("npm run setup")).toBeLessThan(STARTER_PROMPT.indexOf("npm run dev"));
    expect(STARTER_PROMPT).toMatch(/Don't edit src\/content\/defaults\.ts/);
  });
});

describe("docs links", () => {
  it("are recognised and dropped only when the docs are off", () => {
    const links = [{ href: "/docs" }, { href: "/docs/ai-setup" }, { href: "/docsy" }, { href: "/blog" }];
    expect(withoutDocsLinks(links, true)).toEqual(links);
    expect(withoutDocsLinks(links, false).map((l) => l.href)).toEqual(["/docsy", "/blog"]);
    expect(isDocsHref("/docs#mcp")).toBe(true);
  });
});
