import "server-only";

//
// getData() — the one door to storage: the Postgres adapter (your server via
// DATABASE_URL, or the embedded development database), or the memory store
// when DATA_PROVIDER=memory (unit tests). Loaded once per process. Nothing
// else imports from src/adapters/data.
//

import type { DataStore } from "@/core/data";
import { dataProvider } from "./env";

let store: Promise<DataStore> | null = null;
/** The embedded database's migrate-if-needed, once the Postgres adapter is loaded. */
let prepare: (() => Promise<void>) | null = null;

async function load(): Promise<DataStore> {
  if (dataProvider() === "memory") return (await import("@/adapters/data/memory")).createMemoryStore();
  const { prepareEmbeddedDatabase } = await import("@/adapters/data/postgres/embedded");
  await prepareEmbeddedDatabase(); // no-op with DATABASE_URL; instrumentation.ts normally did it already
  prepare = prepareEmbeddedDatabase;
  return (await import("@/adapters/data/postgres")).createPostgresStore();
}

export async function getData(): Promise<DataStore> {
  if (!store) {
    store = load().catch((error) => {
      store = null; // let the next request retry instead of caching the failure
      throw error;
    });
  }
  const data = await store;
  // The store outlives a hot reload, so ask again on every call: a migration
  // generated while `npm run dev` runs is applied before the next query uses
  // its column. Cheap: settled at once with DATABASE_URL, and otherwise one
  // read of drizzle/meta/_journal.json that finds nothing new.
  await prepare?.();
  return data;
}
