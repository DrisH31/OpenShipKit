import "server-only";

//
// The audit log: every write records who did it and the value before and
// after. restoreAuditEntry() puts the `before` value back — the undo button in
// /admin/audit and the MCP tool audit_restore.
//

import type { Actor, AuditEntry, AuditQuery, Page, Plan, Post } from "@/core/types";
import { isContentKey } from "@/core/content";
import { normalizeTags } from "@/core/schemas";
import { assertNotDemo } from "../demo";
import { getData } from "../data";
import { ServiceError, fromDataError } from "./errors";
import { assertSafePlanChange, carryPlanRename, validatePlanWrite } from "./plans";
import { announcePostChange } from "./indexnow";
import { assertNotFutureDated } from "./posts";
import { log } from "@/server/log";

export async function recordAudit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  const data = await getData();
  try {
    await data.audit.record({ actor, action, entity, entityId, before: before ?? null, after: after ?? null });
  } catch (error) {
    // The write already happened; a lost audit row must not turn it into a 500.
    log.error("audit", `failed to record ${action} on ${entityId}`, error);
  }
}

export async function listAudit(query: AuditQuery): Promise<Page<AuditEntry>> {
  return (await getData()).audit.list(query);
}

export async function getAuditEntry(id: string): Promise<AuditEntry | null> {
  return (await getData()).audit.getById(id);
}

/** Entities whose changes can be undone. */
export const RESTORABLE_ENTITIES = ["content", "post", "plan"] as const;

export async function restoreAuditEntry(entryId: string, actor: Actor): Promise<{ restored: string; entity: string; entityId: string | null }> {
  assertNotDemo(actor);
  const data = await getData();
  const entry = await data.audit.getById(entryId);
  if (!entry) throw new ServiceError("not_found", `No audit entry ${entryId}`);

  switch (entry.entity) {
    case "content": {
      const key = entry.entityId;
      if (!isContentKey(key)) throw new ServiceError("invalid", "Entry has no content key");
      const current = await data.content.get(key);
      if (entry.before === null || entry.before === undefined) await data.content.delete(key).catch(fromDataError);
      else await data.content.set(key, entry.before).catch(fromDataError);
      await recordAudit(actor, "content.restore", "content", key, current?.value ?? null, entry.before ?? null);
      return { restored: entry.id, entity: "content", entityId: key };
    }
    case "post": {
      const before = entry.before as Post | null;
      const after = entry.after as Post | null;
      if (!before && after) {
        // Undo a create: delete it.
        const current = await data.posts.getById(after.id);
        if (current) await data.posts.delete(after.id).catch(fromDataError);
        await recordAudit(actor, "post.restore", "post", after.id, current, null);
        announcePostChange(current, null);
        return { restored: entry.id, entity: "post", entityId: after.id };
      }
      if (!before) throw new ServiceError("invalid", "Nothing to restore");
      const current = await data.posts.getById(before.id);
      const fields = {
        slug: before.slug,
        title: before.title,
        description: before.description,
        body: before.body,
        coverImage: before.coverImage,
        // Snapshots from before posts had coverAlt carry none: decorative.
        coverAlt: before.coverAlt ?? null,
        // Stored in today's form, so an old snapshot can't bring back "Guides" beside "guides".
        tags: normalizeTags(before.tags ?? []),
        status: before.status,
        // Snapshots from before posts had `listed` were all on the lists.
        listed: before.listed ?? true,
        authorName: before.authorName,
        seoTitle: before.seoTitle,
        seoDescription: before.seoDescription,
        publishedAt: before.publishedAt,
      };
      // Same rule as editing: no published post dated ahead (there is no scheduling).
      assertNotFutureDated(fields.status, fields.publishedAt);
      // A deleted post comes back with its own id and creation date, so its earlier audit entries still restore.
      // A slug now taken by another post is a DataError("conflict"): shown to the admin, not logged as a bug.
      const restored = current
        ? await data.posts.update(before.id, fields).catch(fromDataError)
        : await data.posts.create({ kind: before.kind, id: before.id, createdAt: before.createdAt, ...fields }).catch(fromDataError);
      await recordAudit(actor, "post.restore", "post", restored.id, current, restored);
      announcePostChange(current, restored);
      return { restored: entry.id, entity: "post", entityId: restored.id };
    }
    case "plan": {
      const before = entry.before as Plan | null;
      const after = entry.after as Plan | null;
      const key = before?.key ?? after?.key;
      if (!key) throw new ServiceError("invalid", "Nothing to restore");
      const current = await data.plans.getByKey(key);
      if (!before) {
        // Same rule as deleting: never orphan customers who pay for this plan.
        await assertSafePlanChange(key, current, null);
        if (current) await data.plans.delete(key).catch(fromDataError);
        await recordAudit(actor, "plan.restore", "plan", key, current, null);
        return { restored: entry.id, entity: "plan", entityId: key };
      }
      // Same checks as editing (schema, one price per interval, one Polar
      // product per price), then the same rule: never orphan paying customers.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, updatedAt, ...snapshot } = before;
      const input = await validatePlanWrite({ ...snapshot, key });
      await assertSafePlanChange(key, current, input);
      const restored = await data.plans.upsert(input).catch(fromDataError);
      await recordAudit(actor, "plan.restore", "plan", key, current, restored);
      // Putting back an old name keeps "Everything in <name>" lines pointing at it.
      await carryPlanRename(current, restored, actor);
      return { restored: entry.id, entity: "plan", entityId: key };
    }
    default:
      throw new ServiceError("invalid", `Changes to "${entry.entity}" can't be restored automatically`);
  }
}
