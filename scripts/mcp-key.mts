//
// npm run mcp:key — mint, list and revoke MCP agent keys from a terminal.
//
//   npm run mcp:key -- --name "Claude Code" --scope write   mint (scope: read | write | admin; default write)
//   npm run mcp:key -- list                                  every key, active and revoked
//   npm run mcp:key -- revoke <id>                           stops working on its next request
//
// Goes through src/server/services/agent-keys.ts, so a key minted here is
// hashed, audited (actor "cli:mcp-key") and identical to one minted in
// /admin/agents. The key is printed ONCE; only its SHA-256 is stored.
//
// Works on your Postgres (DATABASE_URL) and on the embedded demo database
// (PGLITE_DIR, default .data/pglite) — but PGlite opens in ONE process at a
// time, so with `npm run dev` running either stop it first or mint the key in
// the admin at /admin/agents. Refuses DATA_PROVIDER=memory: a key minted into
// this process's memory would vanish when it exits.
//
// Run as `node --conditions=react-server --import tsx scripts/mcp-key.mts`
// (the package.json script does this). Reads .env.local / .env when the
// variables aren't already set (scripts/load-env.mts, shared by every CLI).
//

import { parseArgs } from "node:util";
import type { AgentKey, AgentScope, Actor } from "@/core/types";
import { dataProvider, optionalEnv, siteUrl } from "@/server/env";
import { mcpEndpoint } from "@/lib/mcp-snippets";
import { loadLocalEnv } from "./load-env.mjs";

const CLI_ACTOR: Actor = { type: "system", id: null, label: "cli:mcp-key" };
const SCOPES: readonly AgentScope[] = ["read", "write", "admin"];

const HELP = `Usage:
  npm run mcp:key -- [--name <name>] [--scope read|write|admin]   mint a key (default scope: write)
  npm run mcp:key -- list                                         list keys
  npm run mcp:key -- revoke <id>                                  revoke a key

Name each key after the agent or person using it ("Claude Code on my laptop"):
the audit log shows that name next to every change it makes.`;

function formatKey(k: AgentKey): string {
  const state = k.revokedAt ? `revoked ${k.revokedAt.slice(0, 10)}` : k.lastUsedAt ? `last used ${k.lastUsedAt.slice(0, 16).replace("T", " ")}` : "never used";
  return `  ${k.id}  ${k.scope.padEnd(5)}  …${k.hint}  ${k.name}  (${state})`;
}

class UsageError extends Error {}

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string", short: "n" },
      scope: { type: "string", short: "s" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const [command = "mint", ...rest] = positionals;
  if (!["mint", "create", "list", "revoke"].includes(command)) throw new UsageError(`Unknown command "${command}".`);

  loadLocalEnv("mcp:key");
  if (dataProvider() === "memory") {
    console.error(
      "DATA_PROVIDER is memory: every process has its own throwaway store, so a key minted here would vanish when this command exits.\n" +
        "Unset DATA_PROVIDER (the embedded Postgres demo) or set DATABASE_URL, or for local work set MCP_DEV_KEY in .env.local instead.",
    );
    return 1;
  }
  if (!optionalEnv("DATABASE_URL")) {
    const { pgliteDir } = await import("@/adapters/data/postgres/db");
    console.log(`Using the embedded database at ${pgliteDir()} (stop \`npm run dev\` first, or use /admin/agents while it runs).`);
  }

  const keys = await import("@/server/services/agent-keys");

  if (command === "list") {
    const all = await keys.listAgentKeys();
    if (all.length === 0) console.log("No agent keys yet. Mint one: npm run mcp:key -- --name \"Claude Code\" --scope write");
    else console.log(`${all.length} key${all.length === 1 ? "" : "s"}:\n${all.map(formatKey).join("\n")}`);
    return 0;
  }

  if (command === "revoke") {
    const id = rest[0];
    if (!id) throw new UsageError("Pass the key's id: npm run mcp:key -- revoke <id> (ids are in `npm run mcp:key -- list`).");
    const revoked = await keys.revokeAgentKey(id, CLI_ACTOR);
    console.log(`Revoked “${revoked.name}” (${revoked.scope}, …${revoked.hint}). It stops working on its next request.`);
    return 0;
  }

  const scope = (values.scope ?? "write") as AgentScope;
  if (!SCOPES.includes(scope)) throw new UsageError(`--scope must be one of ${SCOPES.join(", ")}.`);
  const name = values.name?.trim() || "CLI key";
  const { key, agentKey } = await keys.mintAgentKey(name, scope, CLI_ACTOR);
  const url = mcpEndpoint(siteUrl());
  console.log(`Key created for “${agentKey.name}” (${agentKey.scope}). Shown once: ${key}

Endpoint: ${url}

Claude Code (this repo's .mcp.json reads the key from your environment):
  export OPENSHIPKIT_MCP_KEY=${key}
or add it once, anywhere:
  claude mcp add --transport http openshipkit "${url}" --header "Authorization: Bearer ${key}"

Other clients: docs/mcp.md. Revoke it with: npm run mcp:key -- revoke ${agentKey.id}`);
  if (scope === "admin") console.log("\nThis is an ADMIN key: it can change roles, ban users and revoke other keys. Keep it like a password.");
  return 0;
}

function explain(error: unknown): string {
  if (error instanceof UsageError) return `${error.message}\n\n${HELP}`;
  const e = error as { name?: string; message?: string; code?: string; cause?: { message?: string } };
  if (e.name === "EmbeddedDatabaseLockedError") {
    return `${e.message}\nPGlite opens in one process at a time. Stop \`npm run dev\` and run this again, or mint the key in the admin at /admin/agents while the server runs.`;
  }
  if (e.name === "ServiceError") return e.message ?? String(error);
  const message = e.message ?? String(error);
  // Drizzle wraps the driver's error ("Failed query: …"); its cause holds the real reason.
  return message.startsWith("Failed query") && e.cause?.message ? e.cause.message : message;
}

async function main(): Promise<number> {
  let code = 1;
  try {
    code = await run(process.argv.slice(2));
  } catch (error) {
    console.error(`mcp:key: ${explain(error)}`);
  }
  try {
    const { closeDrizzle } = await import("@/adapters/data/postgres/db");
    await closeDrizzle();
  } catch {
    // nothing was opened
  }
  return code;
}

main().then((code) => process.exit(code));
