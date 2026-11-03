//
// The shared request helpers: bodies are read with a byte cap that holds even
// when no Content-Length is sent (a chunked upload), and form, multipart and
// JSON bodies all come back as capped string fields.
//

import { describe, expect, it } from "vitest";
import { FIELD_VALUE_CHARS, readCapped, readFields, refererPath, safeReturnPath, withParam } from "./http";

/** A request whose body streams in chunks with no Content-Length, like `Transfer-Encoding: chunked`. */
function chunked(chunks: number, size: number, type = "application/x-www-form-urlencoded"): { request: Request; pulled: () => number } {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) return controller.close();
      sent++;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
  const request = new Request("http://localhost/api/forms/newsletter", {
    method: "POST",
    body,
    headers: { "content-type": type },
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => sent };
}

describe("readCapped", () => {
  it("stops reading a chunked body as soon as it passes the cap", async () => {
    const { request, pulled } = chunked(1000, 16 * 1024); // 16 MB on offer
    expect(await readCapped(request, 64 * 1024)).toBeNull();
    expect(pulled()).toBeLessThan(10);
  });

  it("refuses a declared Content-Length over the cap without reading", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: "a=1", headers: { "content-length": "999999" } });
    expect(await readCapped(request, 1024)).toBeNull();
  });

  it("returns the bytes under the cap", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: "hello" });
    expect(new TextDecoder().decode((await readCapped(request, 1024))!)).toBe("hello");
  });
});

describe("readFields", () => {
  it("reads urlencoded, multipart and JSON bodies", async () => {
    const urlencoded = new Request("http://localhost/x", {
      method: "POST",
      body: new URLSearchParams({ email: "a@b.co", company: "" }),
    });
    expect(await readFields(urlencoded)).toEqual({ email: "a@b.co", company: "" });

    const form = new FormData();
    form.set("email", "a@b.co");
    const multipart = new Request("http://localhost/x", { method: "POST", body: form });
    expect(await readFields(multipart)).toEqual({ email: "a@b.co" });

    const json = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.co", n: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(await readFields(json)).toEqual({ email: "a@b.co" });
  });

  it("caps each value and refuses an oversized body", async () => {
    const long = new Request("http://localhost/x", { method: "POST", body: new URLSearchParams({ message: "x".repeat(20_000) }) });
    expect((await readFields(long))?.message).toHaveLength(FIELD_VALUE_CHARS);
    expect(await readFields(chunked(100, 16 * 1024).request)).toBeNull();
  });

  it("treats an unsupported or malformed body as empty", async () => {
    expect(await readFields(new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-type": "text/plain" } }))).toEqual({});
    expect(
      await readFields(new Request("http://localhost/x", { method: "POST", body: "{", headers: { "content-type": "application/json" } })),
    ).toEqual({});
  });
});

describe("return paths", () => {
  it("only ever return a same-site path", () => {
    expect(safeReturnPath("/pricing#x", "/")).toBe("/pricing");
    expect(safeReturnPath("//evil.example", "/")).toBe("/");
    expect(safeReturnPath("https://evil.example", "/")).toBe("/");
    // Dot segments resolve before the check: these would otherwise answer `Location: //evil.example`.
    expect(safeReturnPath("/..//evil.example", "/")).toBe("/");
    expect(safeReturnPath("/./\t/evil", "/")).toBe("/");
    expect(safeReturnPath("/\\evil.example", "/")).toBe("/");
    expect(safeReturnPath("/blog/../pricing?x=1", "/")).toBe("/pricing?x=1");
  });

  it("never turn a path into a protocol-relative URL when adding a parameter", () => {
    expect(withParam("/pricing", "newsletter", "ok", "newsletter")).toBe("/pricing?newsletter=ok#newsletter");
    expect(withParam("/..//evil.example", "newsletter", "invalid")).toBe("/evil.example?newsletter=invalid");
    expect(withParam("//evil.example/x", "a", "b").startsWith("//")).toBe(false);
  });

  it("use the Referer only when it matches the Origin", () => {
    const req = (referer: string) =>
      new Request("http://localhost/x", { method: "POST", headers: { origin: "http://localhost:3000", referer } });
    expect(refererPath(req("http://localhost:3000/blog?x=1"), "/")).toBe("/blog?x=1");
    expect(refererPath(req("https://evil.example/blog"), "/")).toBe("/");
  });
});
