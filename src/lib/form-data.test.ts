//
// Reading the post editor's publish date back: an untouched field must not
// rewrite the stored date (the input shows minutes, the column keeps seconds),
// and an emptied field on a published post keeps its date.
//

import { describe, expect, it } from "vitest";
import { changedDateTimeLocal, dateTimeLocal } from "./form-data";
import { toDateTimeLocal } from "./format";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("changedDateTimeLocal", () => {
  const stored = "2026-10-06T09:41:37.512Z";
  const shown = toDateTimeLocal(stored);

  it("leaves the date alone when the field still shows what it was given", () => {
    expect(shown).toBe("2026-10-06T09:41");
    expect(changedDateTimeLocal(form({ publishedAt: shown, publishedAtWas: shown }), "publishedAt")).toBeUndefined();
  });
  it("sends a date the person changed, read as UTC", () => {
    expect(changedDateTimeLocal(form({ publishedAt: "2026-10-01T08:00", publishedAtWas: shown }), "publishedAt")).toBe("2026-10-01T08:00:00.000Z");
  });
  it("keeps a published post's date when the field is emptied, and clears a draft's", () => {
    expect(changedDateTimeLocal(form({ publishedAt: "", publishedAtWas: shown }), "publishedAt", { keepWhenEmpty: true })).toBeUndefined();
    expect(changedDateTimeLocal(form({ publishedAt: "", publishedAtWas: shown }), "publishedAt")).toBeNull();
  });
  it("reads the field as before when the form doesn't say what it showed", () => {
    expect(changedDateTimeLocal(form({ publishedAt: "2026-10-01T08:00" }), "publishedAt")).toBe(dateTimeLocal(form({ publishedAt: "2026-10-01T08:00" }), "publishedAt"));
  });
});
