//
// .env.example lists every variable the app and its npm scripts read
// (AGENTS.md, docs/README.md promise it). This test keeps that true: it finds
// every environment read in src/, scripts/ and the root config files and fails
// on any name .env.example doesn't have, so a new variable can't ship
// undocumented.
//
// Reads it recognises: process.env.NAME, process.env["NAME"], the env.ts
// helpers called with a literal name (read, env, optionalEnv, requireEnv,
// oneOf), and env.NAME / env["NAME"] in a file that takes `env` from
// node:process (`import { env } from "node:process"`, `const { env } = process`).
// A variable counts as documented by a `KEY=` line or a deliberately
// commented-out `# KEY=` line. Test files are skipped: they stub variables,
// they don't define them.
//

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SOURCE_DIRS = ["src", "scripts"];
const ROOT_FILES = ["next.config.ts", "drizzle.config.ts", "vitest.config.mts", "eslint.config.mjs", "postcss.config.mjs"];
const SOURCE_EXT = /\.(?:ts|tsx|mts|mjs|js|cjs)$/;

/** Set by Node or Next.js itself, never by the person deploying. */
const PLATFORM_SET = new Set(["NODE_ENV", "NEXT_PHASE", "NEXT_RUNTIME"]);

const READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /\b(?:read|env|optionalEnv|requireEnv|oneOf)\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g,
];

/** A file that binds `env` to process.env: `import { env } from "node:process"` or `const { env } = process`. */
const BINDS_PROCESS_ENV = /import\s*\{[^}]*\benv\b[^}]*\}\s*from\s*["'](?:node:)?process["']|\{[^}]*\benv\b[^}]*\}\s*=\s*process\b/;

/** Reads through that binding: env.NAME and env["NAME"] (not process.env, which the patterns above cover). */
const BOUND_ENV_PATTERNS = [
  /(?<![.\w])env\.([A-Z][A-Z0-9_]*)/g,
  /(?<![.\w])env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE_EXT.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Every variable name read in the code, with the first file that reads it. */
function envReads(): Map<string, string> {
  const files = [
    ...SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))),
    ...ROOT_FILES.map((f) => join(ROOT, f)).filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    }),
  ];
  const reads = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const patterns = BINDS_PROCESS_ENV.test(text) ? [...READ_PATTERNS, ...BOUND_ENV_PATTERNS] : READ_PATTERNS;
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (name && !reads.has(name)) reads.set(name, file.slice(ROOT.length + 1));
      }
    }
  }
  return reads;
}

/** The KEY of every `KEY=value` line in .env.example, and of every commented-out `# KEY=value` example. */
function documentedKeys(): Set<string> {
  const text = readFileSync(join(ROOT, ".env.example"), "utf8");
  return new Set([...text.matchAll(/^(?:#[ \t]*)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] ?? ""));
}

describe(".env.example", () => {
  it("documents every environment variable the code reads", () => {
    const documented = documentedKeys();
    const missing = [...envReads()]
      .filter(([name]) => !documented.has(name) && !PLATFORM_SET.has(name))
      .map(([name, file]) => `${name} (read in ${file})`);
    expect(missing, "add these to .env.example with a comment").toEqual([]);
  });

  it("finds the reads it is meant to police", () => {
    // Guards the scanner itself: if these stop matching, the test above passes vacuously.
    const reads = envReads();
    // SMOKE_URL is read as env.SMOKE_URL through `import { env } from "node:process"` (scripts/smoke.mts).
    for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "EMAIL_CONSOLE_PRINT_BODIES", "OPENSHIPKIT_ALLOW_LOCALHOST_URL", "SMOKE_URL"]) {
      expect(reads.has(name), name).toBe(true);
    }
  });
});
