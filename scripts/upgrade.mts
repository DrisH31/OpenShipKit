//
// npm run upgrade — a guided merge of a new OpenShipKit release into your site.
//
//   npm run upgrade                        what upgrading to the newest release involves (changes nothing)
//   npm run upgrade -- --to v1.2.0         … to a given tag or branch
//   npm run upgrade -- --merge             do it: a new branch upgrade/<target>, the merge, not committed
//   npm run upgrade -- --remote upstream   the template's remote, if it isn't called "openshipkit"
//
// The report (always): your version and the target's, every CHANGELOG section
// in between with its "Upgrade notes" first, the template's new migrations,
// and whether the merge will work (an unrelated history, your own migrations
// that would make Drizzle skip the template's: docs/upgrading.md).
//
// --merge then, on a clean working tree only: creates `upgrade/<target>` from
// where you are, runs `git merge --no-ff --no-commit <target>`, and lists the
// conflicts and the next steps. It never commits, pushes or touches the
// database: you look at the merge, resolve, run the checks, and commit.
//
// Plain Node, no dependencies, so it runs before `npm install` has brought in
// anything new. Fetching the remote reads from it; nothing is ever sent.
//

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

interface Options {
  remote: string;
  to?: string;
  merge: boolean;
  fetch: boolean;
}

const HELP = `npm run upgrade — a guided merge of a new OpenShipKit release.

Usage: npm run upgrade -- [options]

  --to <tag|branch>    the release to upgrade to (default: the newest vX.Y.Z tag, else <remote>/main)
  --remote <name>      the template's git remote (default: openshipkit)
  --merge              merge it on a new branch upgrade/<target>, without committing
  --no-fetch           use what's already fetched (offline)
  -h, --help           this help

Without --merge it only reports: nothing is changed.`;

function fail(message: string): never {
  console.error(`upgrade: ${message}`);
  exit(1);
}

function parseArgs(args: string[]): Options {
  const o: Options = { remote: "openshipkit", merge: false, fetch: true };
  for (let i = 0; i < args.length; i++) {
    const [a, inline] = args[i].startsWith("--") && args[i].includes("=") ? [args[i].slice(0, args[i].indexOf("=")), args[i].slice(args[i].indexOf("=") + 1)] : [args[i], undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const v = args[++i];
      if (!v || v.startsWith("--")) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--to") o.to = value();
    else if (a === "--remote") o.remote = value();
    else if (a === "--merge") o.merge = true;
    else if (a === "--no-fetch") o.fetch = false;
    else if (a === "-h" || a === "--help") {
      console.log(HELP);
      exit(0);
    } else if (a !== "--") fail(`unknown option ${a} (try --help)`);
  }
  return o;
}

/** git, quietly; null when it fails (and `allowFail`). */
function git(args: string[], allowFail = false): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFail) return null;
    const e = error as { stderr?: string };
    fail(`git ${args.join(" ")} failed: ${e.stderr?.trim() || String(error)}`);
  }
}

/** "1.2.3" → [1, 2, 3]; anything else sorts first. */
const semver = (v: string): number[] => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number) ?? [-1, -1, -1]);
const compare = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** The CHANGELOG's "## [x.y.z]" sections, newest first, each with its body. */
export function changelogSections(text: string): { version: string; body: string }[] {
  const out: { version: string; body: string }[] = [];
  const parts = text.split(/^## \[/m).slice(1);
  for (const part of parts) {
    const version = part.slice(0, part.indexOf("]"));
    out.push({ version, body: part.slice(part.indexOf("\n") + 1).trim() });
  }
  return out;
}

/** The "### Upgrade notes" subsection of a CHANGELOG section, if it has one. */
export function upgradeNotes(body: string): string | null {
  const m = /^### Upgrade notes\s*\n([\s\S]*?)(?=^### |\s*$(?![\s\S]))/m.exec(body);
  return m ? m[1].trim() : null;
}

/** Each migration's `when` in a drizzle journal. */
function journal(text: string | null): { tag: string; when: number }[] {
  if (!text) return [];
  try {
    return (JSON.parse(text) as { entries: { tag: string; when: number }[] }).entries.map((e) => ({ tag: e.tag, when: e.when }));
  } catch {
    return [];
  }
}

function main(): void {
  const o = parseArgs(argv.slice(2));
  if (git(["rev-parse", "--is-inside-work-tree"], true) !== "true") fail("run it in your site's git repository");
  if (!git(["remote"])?.split("\n").includes(o.remote)) {
    fail(
      `no git remote "${o.remote}". Add the template once:\n  git remote add ${o.remote} https://github.com/DrisH31/openshipkit.git\n(or pass --remote <name> if you called it something else)`,
    );
  }
  // The template's tags go into their own namespace (refs/<remote>/tags/…), never yours: a tag of your
  // own (your site's v2.0.0) can't shadow a release or clash with one, and `git push --tags` won't
  // publish the template's.
  const TAGS = `refs/${o.remote}/tags`;
  if (o.fetch) {
    console.log(`Fetching ${o.remote} …`);
    git(["fetch", "--no-tags", o.remote, `+refs/tags/v*:${TAGS}/v*`, `+refs/heads/*:refs/remotes/${o.remote}/*`]);
  }

  // The target: --to (a release name or any ref), else the template's newest release, else its main.
  const tags = (git(["for-each-ref", "--format=%(refname:strip=3)", TAGS]) ?? "").split("\n").filter((t) => semver(t)[0] >= 0).sort(compare);
  const target = o.to ?? tags.at(-1) ?? `${o.remote}/main`;
  const isRelease = tags.includes(target);
  const ref = git(["rev-parse", "--verify", "--quiet", `${isRelease ? `${TAGS}/${target}` : target}^{commit}`], true);
  if (!ref) fail(`"${target}" isn't one of ${o.remote}'s releases or a ref here. Releases: ${tags.length ? tags.join(", ") : "none fetched"}`);

  const versionAt = (rev: string | null) => {
    const pkg = rev ? git(["show", `${rev}:package.json`], true) : null;
    try {
      return pkg ? ((JSON.parse(pkg) as { version?: string }).version ?? "?") : "?";
    } catch {
      return "?";
    }
  };
  const base = git(["merge-base", "HEAD", ref], true);
  // "Your version" is the template's, where your history last met it, never your own package.json
  // (yours is your product's version, and says nothing about which template release you have).
  const mine = versionAt(base);
  const theirs = versionAt(ref);
  console.log("");
  console.log(`You have the template at ${mine}${base ? "" : " (no shared history)"}. Target: ${target} (${theirs}).`);
  if (base === ref) {
    console.log("You already have everything in it. Nothing to upgrade.");
    return;
  }

  // What changed, per version, from the target's own changelog.
  // Upgrading to a branch (main) crosses its unreleased work too.
  const sections = changelogSections(git(["show", `${ref}:CHANGELOG.md`], true) ?? "").filter((s) => {
    if (s.version === "Unreleased") return !isRelease && s.body.length > 0;
    if (semver(s.version)[0] < 0) return false;
    return (mine === "?" || compare(s.version, mine) > 0) && compare(s.version, theirs) <= 0;
  });
  console.log("");
  if (!sections.length) console.log("CHANGELOG: no release sections between your version and the target (read the diff).");
  for (const s of sections) {
    console.log(`── ${s.version} ${"─".repeat(Math.max(0, 60 - s.version.length))}`);
    const notes = upgradeNotes(s.body);
    if (notes) console.log(`Upgrade notes:\n${notes}\n`);
    // The rest of the section, without the notes just shown.
    const rest = (notes ? s.body.replace(/^### Upgrade notes\s*\n[\s\S]*?(?=^### |(?![\s\S]))/m, "") : s.body).trim().split("\n");
    console.log(rest.slice(0, 25).join("\n") + (rest.length > 25 ? "\n  … (the rest in CHANGELOG.md)" : ""));
    console.log("");
  }

  // Migrations: the template's new ones, and whether yours would make Drizzle skip them.
  const theirsJournal = journal(git(["show", `${ref}:drizzle/meta/_journal.json`], true));
  const mineJournal = journal(existsSync("drizzle/meta/_journal.json") ? readFileSync("drizzle/meta/_journal.json", "utf8") : null);
  const known = new Set(mineJournal.map((e) => e.tag));
  const incoming = theirsJournal.filter((e) => !known.has(e.tag));
  const yours = base ? mineJournal.filter((e) => !journal(git(["show", `${base}:drizzle/meta/_journal.json`], true)).some((b) => b.tag === e.tag)) : [];
  const newestYours = Math.max(0, ...yours.map((e) => e.when));
  const skipped = incoming.filter((e) => e.when <= newestYours);
  const warnings: string[] = [];
  if (incoming.length) console.log(`New migrations from the template: ${incoming.map((e) => e.tag).join(", ")}. After merging: stop \`npm run dev\`, then \`npm run db:migrate\`.`);
  if (skipped.length) {
    warnings.push(
      `Your own migrations are newer than the template's ${skipped.map((e) => e.tag).join(", ")}: Drizzle would skip them without a word. Regenerate them instead (docs/upgrading.md, "If you have your own migrations").`,
    );
  }
  if (!base) warnings.push("Your history isn't the template's (a \"Use this template\" copy, or a fresh git init): the first merge needs --allow-unrelated-histories and conflicts in every file you changed (docs/upgrading.md).");
  for (const w of warnings) console.log(`\n  warning: ${w}`);

  if (!o.merge) {
    console.log("\nNothing was changed. To merge it on a new branch: npm run upgrade -- --merge" + (o.to ? ` --to ${o.to}` : ""));
    return;
  }

  // The merge: a clean tree, a new branch, no commit.
  // In this order, so the message is the true one (a merge in progress also leaves the tree dirty).
  if (git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], true)) fail("a merge is already in progress: finish it, or git merge --abort to start over");
  if (git(["status", "--porcelain"])) fail("commit or stash your changes first: the merge needs a clean working tree");
  const branch = `upgrade/${target.replace(/^.*\//, "").replace(/[^A-Za-z0-9._-]+/g, "-")}`;
  if (git(["rev-parse", "--verify", "--quiet", branch], true)) fail(`branch ${branch} already exists: delete it or finish it first`);
  git(["switch", "--quiet", "-c", branch]);
  const mergeArgs = ["merge", "--no-ff", "--no-commit", ...(base ? [] : ["--allow-unrelated-histories"]), ref];
  const merged = git(mergeArgs, true);
  const conflicts = (git(["diff", "--name-only", "--diff-filter=U"], true) ?? "").split("\n").filter(Boolean);
  console.log("");
  console.log(`On branch ${branch}: merged ${target}, not committed.${merged === null && !conflicts.length ? " (git reported a problem: see git status)" : ""}`);
  if (conflicts.length) {
    console.log(`Conflicts in ${conflicts.length} file(s) (usually the ones you customised most; keep yours where it's your copy):`);
    for (const c of conflicts) console.log(`  ${c}`);
  }
  console.log("\nNext:");
  const steps = [
    ...(conflicts.length ? ["Resolve the conflicts, then git add them."] : []),
    "npm install",
    "npm run check && npm run build",
    ...(incoming.length ? ["Stop `npm run dev`, then npm run db:migrate"] : []),
    'git commit   (or git merge --abort to drop it all and go back)',
  ];
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}

main();
