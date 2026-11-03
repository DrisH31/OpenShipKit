//
// loadLocalEnv() — the one .env loader every CLI shares (db-migrate, seed,
// mcp-key, smoke) and drizzle.config.ts.
//
// Reads .env.local then .env from the working directory. A variable already
// set (in the shell, or by the earlier file) wins: loadEnvFile never
// overrides one. A file that can't be read or parsed is reported on stderr
// and skipped, so every command behaves the same with a broken .env: it runs
// on the shell's variables and says why the file was ignored.
//

import { existsSync } from "node:fs";

/** The files read, in order: the first to set a variable wins. */
export const LOCAL_ENV_FILES = [".env.local", ".env"] as const;

/**
 * Load .env.local then .env into process.env, never overriding a variable
 * already set. `label` prefixes the warning for an unreadable file.
 */
export function loadLocalEnv(label = "env"): void {
  for (const file of LOCAL_ENV_FILES) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch (error) {
      console.error(`${label}: could not read ${file}: ${(error as Error).message}`);
    }
  }
}
