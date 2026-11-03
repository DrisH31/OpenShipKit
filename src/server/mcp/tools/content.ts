import "server-only";

//
// The editable site: one JSON document per content key (src/core/content.ts).
// Reads show the built-in default when nothing is stored (stored: false).
// Writes go through updateContent/resetContent, which validate against the
// key's schema and record before/after in the audit log.
//
// site.contactEmail is the one field a write key can't change: every
// contact-form message, with the sender's name and email, is sent there, so
// moving it needs admin (guardContactEmail in shared.ts), on update and reset
// alike — the same line audit_restore holds.
//

import { z } from "zod";
import { CONTENT_KEYS, CONTENT_KEY_LIST, siteSchema, type ContentKey } from "@/core/content";
import { deepMerge, getAllContentStates, getContentState, resetContent, updateContent } from "@/server/services/content";
import { toJsonSchema } from "../json-schema";
import { DESTRUCTIVE, READ_ONLY, WRITE_IDEMPOTENT, defineTool } from "../types";
import { contactEmailOf, guardContactEmail } from "./shared";

const contentKey = z
  .enum(CONTENT_KEY_LIST as [ContentKey, ...ContentKey[]])
  .describe(`The section to read or change. One of: ${CONTENT_KEY_LIST.join(", ")}`);

export const contentList = defineTool({
  name: "content_list",
  title: "List content sections",
  description:
    "List every editable section of the site (site settings, navigation, hero, features, FAQ …) with its label, what it controls, whether it has been edited (stored: true) or still shows its built-in default (stored: false), and when it last changed. Values are not included: call content_get for one section's value and schema. Takes no arguments.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({}),
  async run() {
    const states = await getAllContentStates();
    return {
      items: states.map((s) => ({
        key: s.key,
        label: CONTENT_KEYS[s.key].label,
        description: CONTENT_KEYS[s.key].description,
        stored: s.stored,
        updatedAt: s.updatedAt,
      })),
    };
  },
});

export const contentGet = defineTool({
  name: "content_get",
  title: "Read a content section",
  description:
    "Read one section exactly as the site renders it right now, plus its JSON Schema. Returns {key, label, value, stored, updatedAt, schema}; stored: false means the value is the built-in default and nothing has been saved yet. Call this before content_update so you change only what you were asked to.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({ key: contentKey }),
  async run({ key }) {
    const state = await getContentState(key);
    return { ...state, label: CONTENT_KEYS[key].label, schema: toJsonSchema(CONTENT_KEYS[key].schema) };
  },
});

export const contentUpdate = defineTool({
  name: "content_update",
  title: "Change a content section",
  description:
    "Save a section of the site; the change is live as soon as this returns. mode \"merge\" (the default) deep-merges `value` over the current value: objects merge key by key, arrays and strings replace — so {key: \"hero\", value: {title: \"New headline\"}} changes only the headline, and editing one item of a list means sending the whole list. mode \"replace\" stores `value` as the complete section. The result must pass the section's schema (see content_get or guide); a refusal lists each failing field. Changing site.contactEmail (where contact-form messages are sent) needs an admin key. Returns the saved section. Recorded in the audit log; audit_restore undoes it.",
  scope: "write",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({
    key: contentKey,
    value: z.record(z.string(), z.unknown()).describe("The fields to change (merge) or the whole section (replace)"),
    mode: z.enum(["merge", "replace"]).optional().describe("Default merge"),
  }),
  async run({ key, value, mode }, ctx) {
    const merge = (mode ?? "merge") === "merge";
    if (key === "site") {
      const current = (await getContentState("site")).value;
      // A value that fails the schema is left for updateContent to refuse, field by field.
      const next = siteSchema.safeParse(merge ? deepMerge(current, value) : value);
      if (next.success) guardContactEmail(ctx, current.contactEmail, next.data.contactEmail, "This update");
    }
    const saved = await updateContent(key, value, ctx.actor, merge ? "merge" : "replace");
    return { ...saved, live: true };
  },
});

export const contentReset = defineTool({
  name: "content_reset",
  title: "Reset a content section",
  description:
    "Forget the saved value of one section so the site shows its built-in default again. Use only when asked to start a section over. Resetting site when its contactEmail differs from the default needs an admin key. Returns the default now shown. Recorded in the audit log; audit_restore brings the saved value back.",
  scope: "write",
  annotations: DESTRUCTIVE,
  input: z.strictObject({ key: contentKey }),
  async run({ key }, ctx) {
    if (key === "site") guardContactEmail(ctx, (await getContentState("site")).value.contactEmail, contactEmailOf(null), "Resetting site");
    return { ...(await resetContent(key, ctx.actor)), live: true };
  },
});

export const CONTENT_TOOLS = [contentList, contentGet, contentUpdate, contentReset];
