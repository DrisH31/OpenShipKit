//
// isLocalUrl: the one "is the site URL still local?" rule (src/lib/site-url.ts).
//

import { describe, expect, it } from "vitest";
import { isLocalHost, isLocalUrl } from "./site-url";

describe("isLocalUrl", () => {
  it("counts every loopback and development host as local", () => {
    for (const url of [
      "http://localhost:3000",
      "http://LOCALHOST",
      "https://app.localhost:3000/",
      "http://127.0.0.1:3000",
      "http://127.1.2.3",
      "http://0.0.0.0:3000",
      "http://[::1]:3000",
      "http://[::]",
      "not a url",
    ]) {
      expect(isLocalUrl(url), url).toBe(true);
    }
  });
  it("counts a public origin as deployed", () => {
    for (const url of ["https://example.com", "https://localhost.example.com", "http://10.0.0.5:3000", "https://128.0.0.1"]) {
      expect(isLocalUrl(url), url).toBe(false);
    }
  });
  it("takes a bare host too", () => {
    expect(isLocalHost("[::1]")).toBe(true);
    expect(isLocalHost("::1")).toBe(true);
    expect(isLocalHost("example.com")).toBe(false);
  });
});
