//
// The showcase's "Support the project" link (src/shared/support.ts): only an
// absolute https URL turns the button on; anything else leaves the header's
// own action in place.
//

import { describe, expect, it } from "vitest";
import { resolveSupportUrl } from "@/shared/support";

describe("resolveSupportUrl", () => {
  it("is off when unset or blank", () => {
    expect(resolveSupportUrl(undefined)).toBeNull();
    expect(resolveSupportUrl("")).toBeNull();
    expect(resolveSupportUrl("   ")).toBeNull();
  });

  it("takes an https checkout link, trimmed", () => {
    expect(resolveSupportUrl(" https://buy.polar.sh/polar_cl_example ")).toBe("https://buy.polar.sh/polar_cl_example");
  });

  it("refuses anything that isn't an absolute https URL", () => {
    expect(resolveSupportUrl("http://buy.polar.sh/polar_cl_example")).toBeNull();
    expect(resolveSupportUrl("javascript:alert(1)")).toBeNull();
    expect(resolveSupportUrl("/support")).toBeNull();
    expect(resolveSupportUrl("buy.polar.sh/polar_cl_example")).toBeNull();
  });
});
