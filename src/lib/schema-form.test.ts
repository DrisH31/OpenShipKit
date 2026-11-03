//
// The admin editors are generated from the real schemas, so these tests run
// every content section and the plan schema through z.toJSONSchema →
// toFieldNode and check that nothing degrades to a raw-JSON box, that a fresh
// value from the form model passes the schema, and that the path helpers the
// editor uses behave.
//

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CONTENT_KEYS, CONTENT_KEY_LIST } from "@/core/content";
import { planSchema } from "@/core/schemas";
import { DEFAULT_CONTENT } from "@/content/defaults";
import { compactFields, defaultFor, getAt, humanize, itemSummary, moveItem, pathPattern, setAt, toFieldNode, withDefaults, type FieldNode, type JsonSchema } from "./schema-form";

function nodeFor(schema: z.ZodType): FieldNode {
  return toFieldNode(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema);
}

function kinds(node: FieldNode, out: string[] = []): string[] {
  out.push(node.kind);
  if (node.kind === "object") node.fields.forEach((f) => kinds(f.node, out));
  if (node.kind === "array") kinds(node.item, out);
  if (node.kind === "nullable") kinds(node.inner, out);
  return out;
}

describe("schema → form model", () => {
  it.each(CONTENT_KEY_LIST)("content section %s has an editor for every field", (key) => {
    const node = nodeFor(CONTENT_KEYS[key].schema);
    expect(node.kind).toBe("object");
    expect(kinds(node)).not.toContain("json");
  });

  it.each(CONTENT_KEY_LIST)("content section %s: its default round-trips through the form model", (key) => {
    const node = nodeFor(CONTENT_KEYS[key].schema);
    const value = withDefaults(node, DEFAULT_CONTENT[key]);
    expect(CONTENT_KEYS[key].schema.safeParse(value).success).toBe(true);
  });

  it("maps the plan schema: prices are rows, polarProductId is nullable text, trialDays nullable number", () => {
    const node = nodeFor(planSchema);
    expect(kinds(node)).not.toContain("json");
    if (node.kind !== "object") throw new Error("expected object");
    const prices = node.fields.find((f) => f.key === "prices")?.node;
    expect(prices?.kind).toBe("array");
    if (prices?.kind !== "array" || prices.item.kind !== "object") throw new Error("expected array of objects");
    const interval = prices.item.fields.find((f) => f.key === "interval")?.node;
    expect(interval).toMatchObject({ kind: "enum", options: ["month", "year", "one_time"] });
    const product = prices.item.fields.find((f) => f.key === "polarProductId")?.node;
    expect(product).toMatchObject({ kind: "nullable", inner: { kind: "string" } });
    const trial = node.fields.find((f) => f.key === "trialDays")?.node;
    expect(trial).toMatchObject({ kind: "nullable", inner: { kind: "number", integer: true } });
  });

  it("maps a plan's limits to name → number rows, not a raw-JSON box", () => {
    const node = nodeFor(planSchema);
    if (node.kind !== "object") throw new Error("expected object");
    const limits = node.fields.find((f) => f.key === "limits")?.node;
    expect(limits).toMatchObject({ kind: "map", keyMaxLength: 40, value: { kind: "number", integer: true, minimum: 0 } });
    expect(limits?.kind === "map" && new RegExp(limits.keyPattern ?? "").test("api_calls")).toBe(true);
    expect(defaultFor(limits!)).toEqual({});
  });

  it("a fresh plan from defaults passes once it has a key and a name", () => {
    const node = nodeFor(planSchema);
    const fresh = setAt(setAt(defaultFor(node), ["key"], "team"), ["name"], "Team");
    expect(planSchema.safeParse(fresh).success).toBe(true);
  });

  it("treats an email-or-empty union as one string field", () => {
    const node = nodeFor(CONTENT_KEYS.site.schema);
    if (node.kind !== "object") throw new Error("expected object");
    expect(node.fields.find((f) => f.key === "contactEmail")?.node.kind).toBe("string");
  });

  it("keeps links, images and alt text on one line however long they may be", () => {
    const node = toFieldNode(
      z.toJSONSchema(
        z.object({ href: z.string().max(500), ogImage: z.string().max(500), imageAlt: z.string().max(500), body: z.string().max(500), site: z.url().max(500) }),
      ) as JsonSchema,
    );
    if (node.kind !== "object") throw new Error("expected object");
    const multiline = Object.fromEntries(node.fields.map((f) => [f.key, f.node.kind === "string" && f.node.multiline]));
    expect(multiline).toEqual({ href: false, ogImage: false, imageAlt: false, body: true, site: false });
  });
});

describe("path helpers", () => {
  it("sets deep values immutably", () => {
    const before = { items: [{ title: "a" }, { title: "b" }] };
    const after = setAt(before, ["items", 1, "title"], "B");
    expect(getAt(after, ["items", 1, "title"])).toBe("B");
    expect(before.items[1].title).toBe("b");
  });

  it("moves rows and ignores moves off the ends", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });

  it("names paths and rows for people", () => {
    expect(humanize("primaryCta")).toBe("Primary CTA");
    expect(humanize("ogImage")).toBe("OG image");
    expect([humanize("github"), humanize("linkedin"), humanize("youtube"), humanize("mcpUrl")]).toEqual(["GitHub", "LinkedIn", "YouTube", "MCP URL"]);
    expect(pathPattern(["prices", 2, "amountCents"])).toBe("prices.*.amountCents");
    expect(itemSummary({ question: "Is it free?" })).toBe("Is it free?");
    expect(itemSummary({ nothing: 1 })).toBeNull();
  });
});

describe("compactFields", () => {
  const nav = nodeFor(CONTENT_KEYS.navigation.schema);
  const arrayAt = (node: FieldNode, key: string) => (node.kind === "object" ? node.fields.find((f) => f.key === key)?.node : undefined);
  it("lays a link list out as one row per link", () => {
    const header = arrayAt(nav, "header");
    expect(header?.kind).toBe("array");
    if (header?.kind !== "array") return;
    expect(compactFields(header.item)?.map((f) => f.key)).toEqual(["label", "href"]);
  });
  it("keeps a card for anything with a list, long text or many fields inside", () => {
    const footer = arrayAt(nav, "footer");
    if (footer?.kind !== "array") throw new Error("footer is a list");
    expect(compactFields(footer.item)).toBeNull(); // title + a list of links
    const prices = arrayAt(nodeFor(planSchema), "prices");
    if (prices?.kind !== "array") throw new Error("prices is a list");
    expect(compactFields(prices.item)).toBeNull(); // four fields, one of them a select
    expect(compactFields({ kind: "string", multiline: false })).toBeNull();
  });
});
