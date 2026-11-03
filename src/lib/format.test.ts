//
// formatIpAddress: the "Where you're signed in" list shows an IP the way a
// person reads it — short IPv6, loopback as "This machine", nothing at all
// for an unspecified or missing address.
//

import { describe, expect, it } from "vitest";
import { formatIpAddress } from "./format";

describe("formatIpAddress", () => {
  it("hides an unspecified or missing address", () => {
    expect(formatIpAddress("0000:0000:0000:0000:0000:0000:0000:0000")).toBeNull();
    expect(formatIpAddress("::")).toBeNull();
    expect(formatIpAddress("0.0.0.0")).toBeNull();
    expect(formatIpAddress("")).toBeNull();
    expect(formatIpAddress("  ")).toBeNull();
    expect(formatIpAddress(null)).toBeNull();
    expect(formatIpAddress(undefined)).toBeNull();
  });
  it("names loopback as this machine", () => {
    expect(formatIpAddress("::1")).toBe("This machine");
    expect(formatIpAddress("0000:0000:0000:0000:0000:0000:0000:0001")).toBe("This machine");
    expect(formatIpAddress("127.0.0.1")).toBe("This machine");
    expect(formatIpAddress("::ffff:127.0.0.1")).toBe("This machine");
  });
  it("compresses IPv6 to its short form", () => {
    expect(formatIpAddress("2001:0DB8:0000:0000:0000:ff00:0042:8329")).toBe("2001:db8::ff00:42:8329");
    expect(formatIpAddress("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
    expect(formatIpAddress("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
    expect(formatIpAddress("fe80::1%en0")).toBe("fe80::1");
  });
  it("shows an IPv4-mapped address as plain IPv4", () => {
    expect(formatIpAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(formatIpAddress("0:0:0:0:0:ffff:cb00:7107")).toBe("203.0.113.7");
  });
  it("leaves plain IPv4 and anything unparseable as stored", () => {
    expect(formatIpAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(formatIpAddress(" not-an-ip ")).toBe("not-an-ip");
    expect(formatIpAddress("1:2:3")).toBe("1:2:3");
  });
});
