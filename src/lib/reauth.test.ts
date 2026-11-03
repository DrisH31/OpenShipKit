//
// Deleting an account needs a sign-in from the last FRESH_SIGN_IN_MINUTES.
//

import { describe, expect, it } from "vitest";
import { FRESH_SIGN_IN_MINUTES, signedInRecently } from "./reauth";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("signedInRecently", () => {
  it("accepts a sign-in inside the window", () => {
    expect(signedInRecently(ago(1), NOW)).toBe(true);
    expect(signedInRecently(ago(FRESH_SIGN_IN_MINUTES), NOW)).toBe(true);
  });

  it("refuses an older sign-in, a missing one and nonsense", () => {
    expect(signedInRecently(ago(FRESH_SIGN_IN_MINUTES + 1), NOW)).toBe(false);
    expect(signedInRecently(ago(60 * 24 * 6), NOW)).toBe(false);
    expect(signedInRecently(null, NOW)).toBe(false);
    expect(signedInRecently("not a date", NOW)).toBe(false);
  });

  it("refuses a sign-in time from the future (beyond a minute of clock skew)", () => {
    expect(signedInRecently(ago(-5), NOW)).toBe(false);
  });
});
