//
// drizzle-kit config for the Postgres adapter.
//
//   npm run db:generate -- --name <change>   write a new SQL migration from schema.ts (no database needed)
//   npm run db:migrate                       apply pending migrations (scripts/db-migrate.mts)
//   npm run db:studio                        browse the database
//
// `generate` needs no DATABASE_URL; `studio` and `push` do. Prefer generate +
// migrate over `push` so every schema change is a reviewed, committed file.
//
// drizzle-kit's own dotenv reads only `.env`, so DATABASE_URL is loaded here
// from `.env.local` then `.env` by the loader the db:* scripts share
// (scripts/load-env.mts). A variable already set in the shell wins.
//

import { defineConfig } from "drizzle-kit";
import { loadLocalEnv } from "./scripts/load-env.mjs";

loadLocalEnv("drizzle-kit");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/adapters/data/postgres/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
