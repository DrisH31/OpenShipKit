import "server-only";

//
// seedDatabase() — insert the starter plans and posts (src/content/seed.ts)
// into a database that has never been seeded. Used by `npm run db:seed` (which
// the Docker migrator runs on EVERY deploy) and by the embedded database's
// first boot (src/adapters/data/postgres/embedded.ts).
//
// Runs once. The first run writes a marker to the audit log (entity "seed",
// action "seed.run"); every later run sees it and does nothing, so a starter
// post or plan you deleted in /admin stays deleted across deploys. A database
// that already holds plans or posts but has no marker (seeded before the marker
// existed, or filled by hand) is treated as seeded too, and gets the marker.
//
// `force: true` (`npm run db:seed -- --force`) adds back any starter plan whose
// key or post whose (kind, slug) is missing. It never overwrites an edit made
// in /admin. Each insert is written to the audit log as actor "seed".
//
// Every run (marker or not) first rewrites stored tags into their normalised
// form (normalizeStoredTags: "Getting Started" → "getting-started", see
// normalizeTag in src/core/schemas.ts) — a one-off for tags written before
// the schema normalised them; once they are clean it changes nothing.
//

import { MAX_LIMIT, type DataStore } from "@/core/data";
import { normalizeTags } from "@/core/schemas";
import type { Actor, Page, Post } from "@/core/types";
import { SEED } from "@/content/seed";

const SEED_ACTOR: Actor = { type: "system", id: null, label: "seed" };

/** The audit entity that marks a database as seeded. */
export const SEED_MARKER = { entity: "seed", entityId: "starter" } as const;

export interface SeedResult {
  plans: number;
  posts: number;
  skipped: number;
  /** True when nothing ran because the database was seeded before (and `force` was off). */
  alreadySeeded: boolean;
}

/** Has this database been seeded before? The marker, or any plan or post at all. */
export async function isSeeded(data: DataStore): Promise<{ seeded: boolean; marked: boolean }> {
  const marker = await data.audit.list({ entity: SEED_MARKER.entity, entityId: SEED_MARKER.entityId, limit: 1 });
  if (marker.items.length > 0) return { seeded: true, marked: true };
  const [plans, posts] = await Promise.all([data.plans.list(), data.posts.list({ limit: 1 })]);
  return { seeded: plans.length > 0 || posts.items.length > 0, marked: false };
}

async function writeMarker(data: DataStore, detail: Record<string, unknown>): Promise<void> {
  await data.audit.record({
    actor: SEED_ACTOR,
    action: "seed.run",
    entity: SEED_MARKER.entity,
    entityId: SEED_MARKER.entityId,
    before: null,
    after: detail,
  });
}

/**
 * Rewrite every post whose tags aren't in their normalised form, audited as
 * "post.update" by actor "seed". Returns how many posts changed (0 once clean).
 */
export async function normalizeStoredTags(data: DataStore, log: (line: string) => void = () => {}): Promise<number> {
  const stale: Post[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<Post> = await data.posts.list({ limit: MAX_LIMIT, cursor });
    for (const post of page.items) {
      const tags = normalizeTags(post.tags);
      if (tags.length !== post.tags.length || tags.some((t, i) => t !== post.tags[i])) stale.push(post);
    }
    cursor = page.nextCursor;
  } while (cursor);
  for (const before of stale) {
    const after = await data.posts.update(before.id, { tags: normalizeTags(before.tags) });
    await data.audit.record({ actor: SEED_ACTOR, action: "post.update", entity: "post", entityId: after.id, before, after });
    log(`  ~ tags of ${after.kind} ${after.slug}: ${after.tags.join(", ") || "(none)"}`);
  }
  return stale.length;
}

export async function seedDatabase(
  data: DataStore,
  log: (line: string) => void = () => {},
  opts: { force?: boolean } = {},
): Promise<SeedResult> {
  const total = SEED.plans.length + SEED.posts.length;
  await normalizeStoredTags(data, log);
  if (!opts.force) {
    const { seeded, marked } = await isSeeded(data);
    if (seeded) {
      if (!marked) await writeMarker(data, { note: "database already had plans or posts; starter content not added" });
      log("  Already seeded: starter plans and posts are added only once, so ones you deleted stay deleted.");
      log("  Run `npm run db:seed -- --force` to add back any that are missing.");
      return { plans: 0, posts: 0, skipped: total, alreadySeeded: true };
    }
  }

  let plans = 0;
  for (const input of SEED.plans) {
    if (await data.plans.getByKey(input.key)) continue;
    const plan = await data.plans.upsert(input);
    await data.audit.record({ actor: SEED_ACTOR, action: "plan.create", entity: "plan", entityId: plan.key, before: null, after: plan });
    log(`  + plan ${plan.key}`);
    plans++;
  }
  let posts = 0;
  for (const input of SEED.posts) {
    if (await data.posts.getBySlug(input.kind, input.slug)) continue;
    // The content's own date, not the install time: "Updated", dateModified and sitemap lastmod stay true.
    const written = input.updatedAt ?? input.publishedAt ?? undefined;
    const post = await data.posts.create({ ...input, createdAt: input.createdAt ?? written, updatedAt: written });
    await data.audit.record({ actor: SEED_ACTOR, action: "post.create", entity: "post", entityId: post.id, before: null, after: post });
    log(`  + ${post.kind} ${post.slug}`);
    posts++;
  }
  await writeMarker(data, { plans, posts, forced: Boolean(opts.force) });
  return { plans, posts, skipped: total - plans - posts, alreadySeeded: false };
}
