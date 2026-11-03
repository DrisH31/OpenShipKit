//
// cn() runs on tables compiled at build time (src/lib/cn-tables.ts) from the
// house extension (src/lib/cn-config.ts). These tests keep the two in step: the
// compiled cn must merge exactly like the runtime config would, and must keep
// a custom size beside a colour.
//

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "cn/build";
import { createCn as createRuntimeCn } from "cn/config";
import config from "./cn-config";
import { cn } from "./utils";

const runtime = createRuntimeCn(config);

const CASES: string[][] = [
  ["text-h1", "text-ink"],
  ["text-small text-ink-3", "text-caption"],
  ["text-display font-bold", "text-body"],
  ["px-4 py-2", "p-3"],
  ["h-8 pointer-coarse:h-11", "h-10"],
  ["bg-tonal hover:bg-tonal-hover", "bg-surface"],
  ["border border-transparent", "border-field"],
  ["rounded-full", "rounded-md"],
  ["grid gap-3 sm:grid-cols-2", "xl:grid-cols-3"],
  ["text-[13px]", "text-small"],
  ["outline-none", "focus-visible:outline-2"],
  ["[mask-image:linear-gradient(to_right,#000_85%,transparent)]", "mask-none"],
];

describe("cn (compiled tables)", () => {
  it("keeps a house size beside a colour", () => {
    expect(cn("text-h1", "text-ink")).toBe("text-h1 text-ink");
    expect(cn("text-caption text-ink-3", "text-small")).toBe("text-ink-3 text-small");
  });
  it("merges exactly like the runtime config (rebuild cn-tables.ts after editing cn-config.ts)", () => {
    for (const input of CASES) expect(cn(...input), input.join(" | ")).toBe(runtime(...input));
  });
});

describe("cn-tables.ts", () => {
  it("is up to date with cn-config.ts", async () => {
    const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "cn-tables-"));
    try {
      const { source } = await build({ full: true, css: false, tokens: "/dev/null", config: here("./cn-config.ts"), out: join(dir, "cn-tables.ts") });
      expect(source, "run the build command in src/lib/cn-config.ts").toBe(readFileSync(here("./cn-tables.ts"), "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
