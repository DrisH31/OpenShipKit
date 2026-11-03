import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server environment; tests run server code directly.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // The Postgres (PGlite) and docs tests do real I/O. Under a full parallel run
    // on a busy machine they passed alone but timed out at Vitest's default 5 s,
    // failing a random one per run. 20 s still catches a real hang.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
