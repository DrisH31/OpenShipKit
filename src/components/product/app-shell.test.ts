//
// Toasts need a mounted <Toaster>: without one, sonner drops every call
// silently, and forms whose only success feedback is a toast (ConfirmAction,
// the sessions list, Unsubscribe) say nothing. The signed-in shell mounts it;
// this keeps it there for as long as anything in the product toasts.
//

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const src = join(here, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("toasts", () => {
  it("the signed-in shell mounts the Toaster that product forms toast into", () => {
    const toasting = sources(join(src, "components")).filter((f) => /import\s*\{[^}]*\btoast\b[^}]*\}\s*from\s*["']sonner["']/.test(readFileSync(f, "utf8")));
    expect(toasting.length).toBeGreaterThan(0);
    const shell = readFileSync(join(here, "app-shell.tsx"), "utf8");
    expect(shell).toMatch(/import\s*\{\s*Toaster\s*\}\s*from\s*["']@\/components\/ui\/sonner["']/);
    expect(shell).toMatch(/<Toaster\b/);
  });
});
