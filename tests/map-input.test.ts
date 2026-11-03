//
// The admin's map editor (a plan's limits) renders any value it can be given
// from the JSON tab without looping: names with spaces, an empty name, an
// emptied value. It once compared its own normalised rows with the raw value,
// which never matched, and re-rendered until React gave up ("Too many re-renders").
//

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldEditor } from "@/components/admin/schema-fields";
import type { FieldNode } from "@/lib/schema-form";

const node: FieldNode = { kind: "map", keyPattern: "^[a-z_]+$", keyMaxLength: 40, value: { kind: "number", integer: true, minimum: 0 } };
const render = (value: unknown) => renderToStaticMarkup(createElement(FieldEditor, { node, path: ["limits"], value, onChange: () => {}, label: "Limits" }));

describe("map editor", () => {
  it.each([[{ api_calls: 5 }], [{ " api_calls": 5 }], [{ "": 3 }], [{ a: undefined }], [{ a: null }], [{}], [null]])("renders %j without looping", (value) => {
    expect(() => render(value)).not.toThrow();
  });

  it("shows one row per entry, name and value", () => {
    const html = render({ seats: 5, api_calls: 1000 });
    expect(html).toContain('value="seats"');
    expect(html).toContain('value="1000"');
    expect(html.match(/ id="[^"]*-row-\d+-name"/g)).toHaveLength(2);
  });
});
