//
// The footer's social links: every natural way of typing a profile becomes a
// working absolute link, and what can't be one is dropped rather than rendered
// as a broken or relative link.
//

import { describe, expect, it } from "vitest";
import { socialHref } from "./social-links";

describe("socialHref", () => {
  it("keeps a full address as typed", () => {
    expect(socialHref("linkedin", "https://www.linkedin.com/company/acme")).toBe("https://www.linkedin.com/company/acme");
    expect(socialHref("x", "  https://x.com/acme ")).toBe("https://x.com/acme");
  });

  it("adds https:// to an address typed without it", () => {
    expect(socialHref("x", "x.com/acme")).toBe("https://x.com/acme");
    expect(socialHref("linkedin", "linkedin.com/company/acme")).toBe("https://linkedin.com/company/acme");
    expect(socialHref("discord", "discord.gg/abc123")).toBe("https://discord.gg/abc123");
  });

  it("turns a handle into the profile where the network has one address per handle", () => {
    expect(socialHref("x", "@acme")).toBe("https://x.com/acme");
    expect(socialHref("github", "acme-inc")).toBe("https://github.com/acme-inc");
    expect(socialHref("youtube", "@acme")).toBe("https://www.youtube.com/@acme");
  });

  it("drops what can't be made into a link, instead of rendering a relative one", () => {
    expect(socialHref("linkedin", "acme")).toBeNull();
    expect(socialHref("discord", "@acme")).toBeNull();
    expect(socialHref("x", "")).toBeNull();
    expect(socialHref("x", "javascript:alert(1)")).toBeNull();
    expect(socialHref("github", "/acme")).toBeNull();
    expect(socialHref("github", "my org")).toBeNull();
    expect(socialHref("x", "https://")).toBeNull();
  });
});
