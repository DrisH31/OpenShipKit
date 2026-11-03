//
// npm run setup (scripts/setup.mts), run for real in a temporary directory:
// the choice flags, the wizard answering from a pipe, what it says each choice
// still needs, and that its choices are the ones the app reads (env-rules).
//

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_NAMES, resolveBillingProvider, resolveEmailProvider, resolveTenancy, resolveWithout } from "@/server/env-rules";

const ROOT = resolve(__dirname, "..");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function run(args: string[], input?: string) {
  const dir = mkdtempSync(join(tmpdir(), "osk-setup-"));
  dirs.push(dir);
  const file = join(dir, ".env.test");
  const r = spawnSync(process.execPath, ["scripts/setup.mts", "--file", file, ...args], { cwd: ROOT, input: input ?? "", encoding: "utf8" });
  const env = r.status === 0 ? readFileSync(file, "utf8") : "";
  const value = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(env)?.[1] ?? null;
  return { status: r.status, out: r.stdout + r.stderr, value };
}

describe("npm run setup", () => {
  it("writes the providers chosen by flag, and says which keys each still needs", () => {
    const r = run(["--billing", "razorpay", "--email", "resend", "--tenancy", "org"]);
    expect(r.status).toBe(0);
    expect([r.value("BILLING_PROVIDER"), r.value("EMAIL_PROVIDER"), r.value("OPENSHIPKIT_TENANCY")]).toEqual(["razorpay", "resend", "org"]);
    expect(r.out).toMatch(/razorpay: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET/);
    expect(r.out).toMatch(/resend: set RESEND_API_KEY, EMAIL_FROM/);
    // Never a secret in the output: the generated ones go to the file only.
    expect(r.out).not.toContain(r.value("BETTER_AUTH_SECRET")!);
  });

  it("the wizard asks what the flags didn't answer, from a pipe, and writes the answers", () => {
    const r = run(["-i"], "saas\nstripe\norg\nsmtp\nyou@example.com\n");
    expect(r.status).toBe(0);
    expect([r.value("OPENSHIPKIT_PROFILE"), r.value("BILLING_PROVIDER"), r.value("OPENSHIPKIT_TENANCY"), r.value("EMAIL_PROVIDER"), r.value("ADMIN_EMAILS")]).toEqual([
      "saas",
      "stripe",
      "org",
      "smtp",
      "you@example.com",
    ]);
    expect(r.out).toMatch(/stripe: set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET/);
  });

  it("the wizard takes the defaults on Enter, asks again on a wrong answer, and skips billing for a content site", () => {
    const r = run(["-i"], "site\nbogus\n\n\n");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Please answer one of: console, resend, smtp/);
    expect(r.out).not.toMatch(/Billing provider/);
    expect([r.value("OPENSHIPKIT_PROFILE"), r.value("BILLING_PROVIDER"), r.value("EMAIL_PROVIDER")]).toEqual(["site", "none", "console"]);
  });

  it("refuses a value it doesn't know, and billing on a content site", () => {
    expect(run(["--billing", "paypal"]).out).toMatch(/--billing "paypal" must be one of: none, polar, stripe, razorpay/);
    expect(run(["--profile", "site", "--billing", "stripe"]).status).toBe(1);
  });

  it("--without switches features off, and refuses one it doesn't know", () => {
    const r = run(["--without", "mcp,blog"]);
    expect(r.value("OPENSHIPKIT_WITHOUT")).toBe("mcp,blog");
    expect(resolveWithout({ OPENSHIPKIT_WITHOUT: r.value("OPENSHIPKIT_WITHOUT")! })).toEqual(["mcp", "blog"]);
    expect(run(["--without", "admin"]).out).toMatch(/--without "admin" must be one of: blog, mcp/);
    // The script's list is the app's.
    expect(/must be one of: ([a-z, ]+)/.exec(run(["--without", "x"]).out)?.[1].split(", ").sort()).toEqual([...FEATURE_NAMES].sort());
  });

  it("offers exactly the values the app accepts", () => {
    for (const b of ["none", "polar", "stripe", "razorpay"]) expect(resolveBillingProvider({ BILLING_PROVIDER: b })).toBe(b);
    for (const e of ["console", "resend", "smtp"]) expect(resolveEmailProvider({ EMAIL_PROVIDER: e, RESEND_API_KEY: "x", SMTP_URL: "smtp://x" })).toBe(e);
    for (const t of ["personal", "org"]) expect(resolveTenancy({ OPENSHIPKIT_TENANCY: t })).toBe(t);
  });

  it("never prompts without a terminal unless -i says so", () => {
    // stdin is a pipe here: no options would mean "ask" only in a terminal. With options it never asks.
    const dir = mkdtempSync(join(tmpdir(), "osk-setup-"));
    dirs.push(dir);
    const out = execFileSync(process.execPath, ["scripts/setup.mts", "--dry-run", "--file", join(dir, "x.env")], { cwd: ROOT, input: "", encoding: "utf8" });
    expect(out).not.toMatch(/A few questions/);
  });
});
