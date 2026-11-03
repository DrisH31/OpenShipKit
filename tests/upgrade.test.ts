//
// npm run upgrade (scripts/upgrade.mts), run for real against two throwaway
// git repositories: a "template" with releases, and a "site" cloned from it.
// The report, the upgrade notes, new migrations, the warning when the site's
// own migrations would make Drizzle skip the template's, and --merge: a new
// branch, the merge staged, nothing committed, a dirty tree refused.
//

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../scripts/upgrade.mts");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_GLOBAL: "/dev/null" };
let root: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" }).trim();
const write = (dir: string, file: string, text: string) => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const journal = (entries: [string, number][]) => JSON.stringify({ entries: entries.map(([tag, when]) => ({ tag, when })) });
const upgrade = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: ENV, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
};

/** A template at v1.0.0, a site cloned from it, then the template's v1.1.0. */
function setup(name: string, siteMigration?: number): { template: string; site: string } {
  const template = join(root, `${name}-template`);
  const site = join(root, `${name}-site`);
  mkdirSync(template);
  git(template, "init", "-q", "-b", "main");
  write(template, "package.json", JSON.stringify({ name: "kit", version: "1.0.0" }));
  write(template, "CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n\nFirst.\n");
  write(template, "drizzle/meta/_journal.json", journal([["0000_init", 1000]]));
  write(template, "src/app.ts", "export const a = 1;\n");
  git(template, "add", "-A");
  git(template, "commit", "-qm", "1.0.0");
  git(template, "tag", "v1.0.0");
  git(root, "clone", "-q", template, site);
  git(site, "remote", "rename", "origin", "openshipkit");
  if (siteMigration) {
    write(site, "drizzle/meta/_journal.json", journal([["0000_init", 1000], ["0001_mine", siteMigration]]));
    git(site, "commit", "-qam", "my migration");
  }
  write(template, "package.json", JSON.stringify({ name: "kit", version: "1.1.0" }));
  write(
    template,
    "CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n## [1.1.0]\n\n### Upgrade notes\n\nRun the new migration; set NEW_VAR.\n\n### Added\n\n- A thing.\n\n## [1.0.0]\n\nFirst.\n",
  );
  write(template, "drizzle/meta/_journal.json", journal([["0000_init", 1000], ["0001_usage", 2000]]));
  write(template, "src/app.ts", "export const a = 2;\n");
  git(template, "commit", "-qam", "1.1.0");
  git(template, "tag", "v1.1.0");
  return { template, site };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "osk-upgrade-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("npm run upgrade", () => {
  it("reports the target, its upgrade notes and new migrations, and changes nothing", () => {
    const { site } = setup("report");
    const before = git(site, "rev-parse", "HEAD");
    const r = upgrade(site);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Your site: 1\.0\.0\. Target: v1\.1\.0 \(1\.1\.0\)/);
    expect(r.out).toMatch(/Upgrade notes:\nRun the new migration; set NEW_VAR\./);
    expect(r.out).toMatch(/New migrations from the template: 0001_usage/);
    expect(r.out).not.toMatch(/warning:/);
    expect(r.out).toMatch(/Nothing was changed/);
    expect(git(site, "rev-parse", "HEAD")).toBe(before);
    expect(git(site, "branch", "--show-current")).toBe("main");
  });

  it("warns when the site's own migrations would make Drizzle skip the template's", () => {
    const { site } = setup("skip", 3000);
    expect(upgrade(site).out).toMatch(/warning: Your own migrations are newer than the template's 0001_usage/);
  });

  it("--merge: a new branch with the merge staged, nothing committed; a dirty tree is refused", () => {
    const { site } = setup("merge");
    write(site, "notes.txt", "wip");
    expect(upgrade(site, "--merge").out).toMatch(/commit or stash your changes first/);
    rmSync(join(site, "notes.txt"));
    const before = git(site, "rev-parse", "HEAD");
    const r = upgrade(site, "--merge");
    expect(r.status).toBe(0);
    expect(git(site, "branch", "--show-current")).toBe("upgrade/v1.1.0");
    expect(git(site, "rev-parse", "HEAD")).toBe(before); // not committed
    expect(git(site, "rev-parse", "MERGE_HEAD")).toBe(git(site, "rev-parse", "v1.1.0"));
    expect(r.out).toMatch(/1\. npm install[\s\S]*db:migrate[\s\S]*git commit/);
  });

  it("names the remote to add when there is none, and says when there's nothing to do", () => {
    const { site } = setup("noremote");
    git(site, "remote", "rename", "openshipkit", "upstream");
    expect(upgrade(site).out).toMatch(/no git remote "openshipkit"[\s\S]*git remote add openshipkit/);
    expect(upgrade(site, "--remote", "upstream", "--to", "v1.0.0").out).toMatch(/already have everything/);
  });
});
