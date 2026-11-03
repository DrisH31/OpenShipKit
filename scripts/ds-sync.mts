//
// npm run ds:sync — bring the design system's shared files into OpenShipKit.
//
//   npm run ds:sync -- --from <design-system>            dry run: what would change, nothing written
//   npm run ds:sync -- --from <design-system> --apply    write it, and record the source commit
//   DESIGN_SYSTEM_DIR=<path to the design system> npm run ds:sync    the same, with the path from the environment
//   npm run ds:sync -- --from … --only src/components/ui/button.tsx --apply   one file
//
// What it syncs (a design-system repository with the same layout):
//   src/styles/{tokens,theme,base,motion,overlays}.css and src/components/ui/**
// What it never touches:
//   - src/styles/brand.css (the product's accent) and every other file outside
//     that set (prose.css, contrast.test.ts, components outside ui/ …);
//   - files only OpenShipKit has inside ui/ — reported as "local", never deleted;
//   - paths in .ds-sync-keep (committed: one path per line, # comments) or
//     given with --keep;
//   - local blocks: lines between `ds-sync:keep start <name>` and
//     `ds-sync:keep end` comments in an OpenShipKit file survive a sync — they
//     are carried over to the end of the new file (CSS: later rules win, so
//     an override block keeps working). Put OpenShipKit-only rules in one, or
//     better, upstream them.
//
// Before writing, it prints a summary per file (+added −removed lines; the −
// lines are what OpenShipKit would LOSE), warns about imports the incoming
// files need that OpenShipKit lacks (a package not in package.json, an @/ path
// that doesn't exist), and checks the incoming text against .ds-sync-deny:
// a git-ignored list of words (your own brand, client or product names, one
// per line) that must never land in this repository. A denied word refuses
// --apply — the design system is often private, this repository may be public.
//
// --apply writes the files and src/styles/DESIGN_SYSTEM_VERSION: the source's
// package name and version, its commit, `git describe` and the date. Never the
// source's path or remote URL (personal, and meaningless to anyone else).
// Review with `git diff`, run `npm run check`; undo with `git checkout -- <files>`.
//
// Plain Node, no dependencies and no `@/` imports, so it runs as
// `node scripts/ds-sync.mts` (Node 24, or 22.18+, strips the types).
//

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { argv, cwd, env, exit } from "node:process";

/** The style sheets the design system owns, by name. brand.css is deliberately not one. */
const STYLE_FILES = ["tokens", "theme", "base", "motion", "overlays"].map((n) => `src/styles/${n}.css`);
/** The component folder the design system owns. */
const UI_DIR = "src/components/ui";
/** Never written, whatever the source holds or the flags say. */
const NEVER = new Set(["src/styles/brand.css", "src/styles/prose.css"]);
/** Where the sync is recorded. */
const VERSION_FILE = "src/styles/DESIGN_SYSTEM_VERSION";
const KEEP_FILE = ".ds-sync-keep";
const DENY_FILE = ".ds-sync-deny";
/** Text files worth comparing in ui/ (anything else there is ignored). */
const UI_EXT = /\.(?:tsx?|css)$/;

interface Options {
  from: string;
  to: string;
  apply: boolean;
  only: string[];
  keep: Set<string>;
  deny: string[];
}

type Status = "new" | "changed" | "same" | "local" | "kept";

interface Entry {
  path: string;
  status: Status;
  added: number;
  removed: number;
  /** Local blocks carried over from the OpenShipKit file. */
  blocks: number;
  /** Local blocks the design system now has itself (dropped, not duplicated). */
  upstreamed?: number;
  /** What --apply writes (new and changed only). */
  next?: string;
}

const HELP = `npm run ds:sync — copy the design system's tokens, theme and ui components into OpenShipKit.

Usage: npm run ds:sync -- --from <design-system checkout> [options]

  --from <path>    the design-system repository (default $DESIGN_SYSTEM_DIR)
  --apply          write the changes (default: a dry run that writes nothing)
  --only <path>    sync only this file (repeatable), e.g. src/components/ui/button.tsx
  --keep <path>    never overwrite this file (repeatable; also read from ${KEEP_FILE})
  --deny <word>    refuse to apply if any incoming file contains it (repeatable;
                   also read from ${DENY_FILE}, which git ignores)
  -h, --help       this help

Synced: ${STYLE_FILES.join(", ")} and ${UI_DIR}/**.
Never: src/styles/brand.css, anything outside that set, files only OpenShipKit has.`;

function fail(message: string): never {
  console.error(`ds:sync: ${message}`);
  exit(1);
}

/** Non-empty, non-comment lines of a list file; [] when it doesn't exist. */
function listFile(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/** A repository-relative path with forward slashes and no leading "./". */
const norm = (p: string): string => p.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");

function parseArgs(args: string[]): Options {
  let from = env.DESIGN_SYSTEM_DIR ?? "";
  let apply = false;
  const only: string[] = [];
  const keep = new Set<string>();
  const deny: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const take = (): string => {
      if (eq > 0) return arg.slice(eq + 1);
      const v = args[i + 1];
      if (!v || v.startsWith("--")) fail(`${flag} needs a value`);
      i++;
      return v;
    };
    switch (flag) {
      case "--":
        break;
      case "--from":
        from = take();
        break;
      case "--apply":
        apply = true;
        break;
      case "--only":
        only.push(norm(take()));
        break;
      case "--keep":
        keep.add(norm(take()));
        break;
      case "--deny":
        deny.push(take());
        break;
      case "-h":
      case "--help":
        console.log(HELP);
        exit(0);
        break;
      default:
        fail(`unknown option ${arg} (try --help)`);
    }
  }
  if (!from) fail("where is the design system? Pass --from <path> or set DESIGN_SYSTEM_DIR (try --help)");
  const to = cwd();
  const source = resolve(from);
  if (!existsSync(join(to, "src/styles")) || !existsSync(join(to, "package.json"))) fail("run it from the OpenShipKit project root (npm run ds:sync does)");
  if (!existsSync(join(source, "src/styles/tokens.css"))) fail(`${from} doesn't look like a design system: no src/styles/tokens.css there`);
  if (source === to) fail("--from is this project: point it at the design-system checkout");
  for (const k of listFile(join(to, KEEP_FILE))) keep.add(norm(k));
  deny.push(...listFile(join(to, DENY_FILE)));
  for (const o of only) {
    if (!STYLE_FILES.includes(o) && !o.startsWith(`${UI_DIR}/`)) fail(`--only ${o} isn't a synced file (${STYLE_FILES.join(", ")} or ${UI_DIR}/…)`);
  }
  return { from: source, to, apply, only, keep, deny: deny.filter(Boolean) };
}

/** Every file under `dir` (relative to `root`), recursively; [] when it doesn't exist. */
function walk(root: string, dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}

/** Lines added and removed between two texts (an LCS over lines). */
function lineDiff(before: string, after: string): { added: number; removed: number } {
  const a = before.split("\n");
  const b = after.split("\n");
  // Trim the common head and tail first: most syncs change a few lines in long files.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  let prev = new Uint32Array(y.length + 1);
  let row = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) row[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    [prev, row] = [row, prev];
  }
  const common = prev[y.length];
  return { added: y.length - common, removed: x.length - common };
}

const KEEP_START = /ds-sync:keep\s+start\b\s*([\w.-]*)/;
const KEEP_END = /ds-sync:keep\s+end\b/;

/** The ds-sync:keep blocks of a file, in order, each with its marker lines. */
function keepBlocks(text: string): { name: string; text: string }[] {
  const blocks: { name: string; text: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = KEEP_START.exec(lines[i]);
    if (!start) continue;
    const end = lines.findIndex((l, j) => j > i && KEEP_END.test(l));
    if (end < 0) fail(`a ds-sync:keep block opened on line ${i + 1} is never closed (ds-sync:keep end)`);
    blocks.push({ name: start[1] || `block-${blocks.length + 1}`, text: lines.slice(i, end + 1).join("\n") });
    i = end;
  }
  return blocks;
}

/** A block's lines between its markers, trimmed. */
const innerOf = (block: string): string => block.split("\n").slice(1, -1).join("\n").trim();

/**
 * The incoming text with OpenShipKit's keep blocks carried over: same-named
 * source blocks removed, ours appended. A block whose content the design
 * system already has, word for word, has been upstreamed: it isn't appended
 * again (that would ship the rules twice).
 */
function withLocalBlocks(incoming: string, local: string): { text: string; blocks: number; upstreamed: number } {
  const ours = keepBlocks(local);
  if (ours.length === 0) return { text: incoming, blocks: 0, upstreamed: 0 };
  let text = incoming;
  for (const theirs of keepBlocks(incoming)) if (ours.some((b) => b.name === theirs.name)) text = text.replace(theirs.text, "");
  const carried = ours.filter((b) => !innerOf(b.text) || !text.includes(innerOf(b.text)));
  if (carried.length) text = `${text.replace(/\s+$/, "")}\n\n${carried.map((b) => b.text).join("\n\n")}\n`;
  return { text, blocks: carried.length, upstreamed: ours.length - carried.length };
}

/** Bare package names and @/ paths an incoming file imports. */
function importsOf(text: string): { packages: string[]; aliases: string[] } {
  const specs = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"'`;]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
  const packages = new Set<string>();
  const aliases = new Set<string>();
  for (const s of specs) {
    if (!s || s.startsWith(".") || s.startsWith("node:")) continue;
    if (s.startsWith("@/")) aliases.add(s);
    else packages.add(s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]);
  }
  return { packages: [...packages], aliases: [...aliases] };
}

/** Does an @/ import resolve in the target (or among the files this sync adds)? */
function aliasResolves(to: string, spec: string, adding: Set<string>): boolean {
  const base = `src/${spec.slice(2)}`;
  const candidates = [base, ...["ts", "tsx", "css", "mts"].map((e) => `${base}.${e}`), ...["ts", "tsx"].map((e) => `${base}/index.${e}`)];
  return candidates.some((c) => adding.has(c) || existsSync(join(to, c)));
}

function git(dir: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

interface Source {
  name: string;
  version: string;
  commit: string;
  describe: string;
  dirty: boolean;
}

function describeSource(from: string): Source {
  let name = "";
  let version = "";
  try {
    const pkg = JSON.parse(readFileSync(join(from, "package.json"), "utf8")) as { name?: string; version?: string };
    name = pkg.name ?? "";
    version = pkg.version ?? "";
  } catch {
    // No package.json: the commit alone identifies it.
  }
  const commit = git(from, ["rev-parse", "HEAD"]);
  return {
    name,
    version,
    commit,
    describe: git(from, ["describe", "--tags", "--always", "--dirty"]),
    dirty: git(from, ["status", "--porcelain", "--", "src/styles", UI_DIR]) !== "",
  };
}

function main(): void {
  const options = parseArgs(argv.slice(2));
  const { from, to } = options;
  const source = describeSource(from);

  // The managed set, as it exists on either side.
  const fromUi = walk(from, UI_DIR).filter((p) => UI_EXT.test(p));
  const toUi = walk(to, UI_DIR).filter((p) => UI_EXT.test(p));
  // NEVER is listed too, so the summary shows brand.css staying put.
  let paths = [...new Set([...STYLE_FILES, ...NEVER, ...fromUi, ...toUi])].sort();
  if (options.only.length) paths = paths.filter((p) => options.only.includes(p));

  const entries: Entry[] = [];
  for (const path of paths) {
    const there = join(from, path);
    const here = join(to, path);
    const inSource = existsSync(there);
    const inTarget = existsSync(here);
    if (NEVER.has(path) || options.keep.has(path)) {
      entries.push({ path, status: "kept", added: 0, removed: 0, blocks: 0 });
      continue;
    }
    if (!inSource) {
      if (inTarget) entries.push({ path, status: "local", added: 0, removed: 0, blocks: 0 });
      continue;
    }
    const incoming = readFileSync(there, "utf8");
    if (!inTarget) {
      entries.push({ path, status: "new", added: incoming.split("\n").length, removed: 0, blocks: 0, next: incoming });
      continue;
    }
    const current = readFileSync(here, "utf8");
    const { text, blocks, upstreamed } = withLocalBlocks(incoming, current);
    if (text === current) {
      entries.push({ path, status: "same", added: 0, removed: 0, blocks });
      continue;
    }
    entries.push({ path, status: "changed", ...lineDiff(current, text), blocks, upstreamed, next: text });
  }

  // Report.
  const label = [source.name || "design system", source.version, source.describe || source.commit.slice(0, 12) || "(not a git checkout)"].filter(Boolean).join(" ");
  console.log(`From: ${label}${source.dirty ? " — WITH UNCOMMITTED CHANGES in its styles or ui/" : ""}`);
  console.log(`Into: ${relative(dirname(to), to) || to}${options.apply ? "" : "  (dry run — nothing is written; add --apply)"}\n`);
  const width = Math.max(...entries.map((e) => e.path.length), 10);
  const order: Status[] = ["changed", "new", "local", "kept", "same"];
  for (const status of order) {
    for (const e of entries.filter((x) => x.status === status)) {
      if (status === "same" && entries.length > 12) continue; // listed as a count below
      const detail =
        status === "changed"
          ? `+${e.added} −${e.removed}${e.blocks ? ` (keeps ${e.blocks} local block${e.blocks === 1 ? "" : "s"})` : ""}${e.upstreamed ? ` (${e.upstreamed} local block${e.upstreamed === 1 ? " is" : "s are"} upstream now)` : ""}`
          : status === "new"
            ? `${e.added} lines`
            : status === "local"
              ? "only in OpenShipKit — left alone"
              : status === "kept"
                ? "never synced (brand.css, prose.css, --keep or .ds-sync-keep)"
                : "";
      console.log(`  ${status.padEnd(7)}  ${e.path.padEnd(width)}  ${detail}`);
    }
  }
  const count = (s: Status) => entries.filter((e) => e.status === s).length;
  console.log(`\n${count("changed")} changed, ${count("new")} new, ${count("same")} unchanged, ${count("local")} OpenShipKit-only, ${count("kept")} kept.`);

  // Warnings: what the incoming files need, and what must never land here.
  const writes = entries.filter((e) => e.next !== undefined);
  const adding = new Set(writes.map((e) => e.path));
  const pkg = JSON.parse(readFileSync(join(to, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const installed = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const warnings: string[] = [];
  const denied: string[] = [];
  for (const e of writes) {
    const text = e.next ?? "";
    if (/\.(?:tsx?|mts)$/.test(e.path)) {
      const { packages, aliases } = importsOf(text);
      for (const p of packages) if (!installed.has(p) && p !== "react" && p !== "react-dom") warnings.push(`${e.path} imports "${p}", which package.json doesn't have (npm install ${p})`);
      for (const a of aliases) if (!aliasResolves(to, a, adding)) warnings.push(`${e.path} imports "${a}", which doesn't exist here`);
    }
    const lines = text.split("\n");
    for (const word of options.deny) {
      const needle = word.toLowerCase();
      const at = lines.findIndex((l) => l.toLowerCase().includes(needle));
      if (at >= 0) denied.push(`${e.path}:${at + 1} contains a denied word (${DENY_FILE} / --deny)`);
    }
  }
  const lost = writes.reduce((n, e) => n + e.removed, 0);
  if (lost > 0) warnings.push(`${lost} line${lost === 1 ? "" : "s"} OpenShipKit has would be replaced (the − counts). If any are OpenShipKit's own, wrap them in a ds-sync:keep block or upstream them first.`);
  if (source.dirty) warnings.push("the design system has uncommitted changes: the recorded commit won't match what was copied. Commit there first.");
  if (warnings.length || denied.length) {
    console.log("\nCheck before applying:");
    for (const w of [...denied, ...warnings]) console.log(`  - ${w}`);
  }

  if (!options.apply) {
    if (writes.length) console.log(`\nDry run. Apply with: npm run ds:sync -- --from <path> --apply${options.only.map((o) => ` --only ${o}`).join("")}`);
    return;
  }
  if (denied.length) fail(`refusing to apply: ${denied.length} incoming file${denied.length === 1 ? "" : "s"} contain${denied.length === 1 ? "s" : ""} a denied word. Fix it in the design system (or remove the word from ${DENY_FILE}).`);
  if (writes.length === 0) {
    console.log("\nNothing to write: already in step.");
    return;
  }
  for (const e of writes) {
    const target = join(to, e.path);
    // Defence in depth: never write outside the two managed places.
    const rel = relative(to, target).split(sep).join("/");
    if (!(STYLE_FILES.includes(rel) || rel.startsWith(`${UI_DIR}/`)) || NEVER.has(rel)) fail(`internal: refusing to write ${rel}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.next ?? "");
  }
  const record = [
    "# Written by `npm run ds:sync` (scripts/ds-sync.mts): the design system that",
    `# ${STYLE_FILES.map((p) => p.replace("src/styles/", "")).join(", ")} and ${UI_DIR}/ were last synced from.`,
    "# Edit nothing here by hand; a sync rewrites it.",
    `name=${source.name}`,
    `version=${source.version}`,
    `commit=${source.commit}`,
    `describe=${source.describe}`,
    `dirty=${source.dirty}`,
    `synced=${new Date().toISOString()}`,
    `files=${writes.map((e) => e.path).join(",")}`,
    "",
  ].join("\n");
  writeFileSync(join(to, VERSION_FILE), record);
  console.log(`\nWrote ${writes.length} file${writes.length === 1 ? "" : "s"} and ${VERSION_FILE}.`);
  console.log("Next: git diff (review), npm run check (contrast and import tests included), then commit.");
  console.log("Undo: git checkout -- src/styles src/components/ui");
}

main();
