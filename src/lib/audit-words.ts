//
// Audit entries in words, for the admin overview and the audit log:
// "post.publish" on a post → "Published the post “Welcome”", with a link to
// the thing that changed. Pure and client-safe; unknown actions fall back to
// the raw verb, so a new service's entries still read sensibly.
//

import type { AuditEntry } from "@/core/types";
import { CONTENT_KEYS, isContentKey } from "@/core/content";

const VERBS: Record<string, string> = {
  "content.update": "Edited",
  "content.reset": "Reset to default",
  "content.restore": "Restored",
  "post.create": "Created",
  "post.update": "Edited",
  "post.publish": "Published",
  "post.unpublish": "Unpublished",
  "post.delete": "Deleted",
  "post.restore": "Restored",
  "plan.create": "Created",
  "plan.update": "Edited",
  "plan.delete": "Deleted",
  "plan.restore": "Restored",
  "media.upload": "Uploaded",
  "media.delete": "Deleted",
  "user.create": "Account created for",
  "user.promote": "Made",
  "user.role": "Changed the role of",
  "user.ban": "Banned",
  "user.unban": "Unbanned",
  "user.profile": "Updated the profile of",
  "user.delete": "Deleted",
  "feedback.update": "Updated",
  "subscriber.unsubscribe": "Unsubscribed",
  "agent_key.create": "Minted",
  "agent_key.revoke": "Revoked",
  "demo.account": "Set up",
  "seed.run": "Added",
};

const NOUN: Record<string, string> = {
  content: "section",
  post: "post",
  plan: "plan",
  media: "image",
  user: "user",
  feedback: "feedback",
  subscriber: "subscriber",
  agent_key: "agent key",
  demo_admin: "the read-only demo admin",
  seed: "the starter content",
};

/** The entities the audit log can be filtered by, in display order. */
export const AUDIT_ENTITIES: { value: string; label: string }[] = [
  { value: "content", label: "Content" },
  { value: "post", label: "Posts" },
  { value: "plan", label: "Plans" },
  { value: "media", label: "Media" },
  { value: "user", label: "Users" },
  { value: "feedback", label: "Feedback" },
  { value: "subscriber", label: "Subscribers" },
  { value: "agent_key", label: "Agent keys" },
];

function field(v: unknown, key: string): string | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const x = (v as Record<string, unknown>)[key];
    return typeof x === "string" && x.trim() ? x : null;
  }
  return null;
}

export interface AuditWords {
  /** "Published" */
  verb: string;
  /** "the post “Welcome to OpenShipKit”" */
  target: string;
  /** Where the changed thing lives now, when it still exists. */
  href: string | null;
}

export function describeAudit(e: AuditEntry, emails?: Readonly<Record<string, string>>): AuditWords {
  const verb = VERBS[e.action] ?? e.action;
  const snapshot = e.after ?? e.before;
  const noun = NOUN[e.entity] ?? e.entity;
  const deleted = e.action.endsWith(".delete");
  switch (e.entity) {
    case "content": {
      const label = isContentKey(e.entityId) ? CONTENT_KEYS[e.entityId].label : e.entityId ?? "content";
      return { verb, target: `“${label}”`, href: e.entityId ? `/admin/content/${e.entityId}` : null };
    }
    case "post": {
      const title = field(snapshot, "title");
      const kind = field(snapshot, "kind");
      const kindWord = kind === "changelog" ? "changelog entry" : kind === "page" ? "page" : "post";
      return { verb, target: title ? `the ${kindWord} “${title}”` : `a ${kindWord}`, href: !deleted && e.entityId ? `/admin/posts/${e.entityId}` : null };
    }
    case "plan": {
      const name = field(snapshot, "name") ?? e.entityId;
      return { verb, target: `the plan “${name}”`, href: !deleted && e.entityId ? `/admin/plans/${e.entityId}` : null };
    }
    case "user": {
      // Older role and ban entries carry no email: the page can pass the person's
      // current address (`emails`, by user id) so they still say whom.
      const email = field(e.before, "email") ?? field(e.after, "email") ?? (e.entityId ? (emails?.[e.entityId] ?? null) : null);
      const who = email ?? "a user";
      const href = !deleted && e.entityId ? `/admin/users/${e.entityId}` : null;
      if (e.action === "user.role" || e.action === "user.promote") {
        const role = field(e.after, "role");
        if (role === "admin") return { verb: "Made", target: `${who} an admin`, href };
        if (role === "user") return { verb: "Took admin rights from", target: who, href };
        return { verb, target: role ? `${who} to ${role}` : who, href };
      }
      return { verb, target: who, href };
    }
    case "media": {
      // The file has no title; its path (yyyy/mm/<hex>.png) is the name the admin shows.
      const path = field(snapshot, "path") ?? e.entityId;
      return { verb, target: path ? `the image “${path}”` : "an image", href: "/admin/media" };
    }
    case "agent_key": {
      const name = field(snapshot, "name");
      return { verb, target: name ? `the agent key “${name}”` : "an agent key", href: "/admin/agents" };
    }
    case "feedback": {
      const status = field(e.after, "status");
      return { verb, target: status ? `feedback (now ${status.replace("_", " ")})` : "feedback", href: "/admin/feedback" };
    }
    case "subscriber": {
      return { verb, target: field(e.after, "email") ?? "a subscriber", href: "/admin/subscribers" };
    }
    default:
      return { verb, target: noun, href: null };
  }
}

/** System actors' raw labels, in words. Anything else (webhook:polar, ADMIN_EMAILS) shows as recorded. */
const SYSTEM_WORDS: Record<string, string> = { system: "System", "sign-in": "Sign-up", seed: "Starter content" };

/** Who did it, for display: an email, "Agent · Claude on laptop", "Sign-up" or "System". */
export function actorWords(e: AuditEntry): string {
  if (e.actor.type === "agent") return `Agent · ${e.actor.label.replace(/^agent:/, "")}`;
  if (e.actor.type === "system") return SYSTEM_WORDS[e.actor.label] ?? e.actor.label;
  return e.actor.label;
}

/** True for rows the seed wrote (the starter plans and posts), not a change a person or an agent made. */
export function isSeedEntry(e: AuditEntry): boolean {
  return e.actor.type === "system" && e.actor.label === "seed";
}

/** Has anyone (a person or an agent) changed these records? The seed's own rows don't count. */
export function editedByPeople(entries: readonly AuditEntry[]): boolean {
  return entries.some((e) => !isSeedEntry(e));
}

/** User ids in `entries` whose role or ban rows name no email, for the page to look up. */
export function userIdsWithoutEmail(entries: readonly AuditEntry[]): string[] {
  const ids = entries
    .filter((e) => e.entity === "user" && e.entityId && !field(e.before, "email") && !field(e.after, "email"))
    .map((e) => e.entityId as string);
  return [...new Set(ids)];
}
