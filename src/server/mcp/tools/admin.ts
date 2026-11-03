import "server-only";

//
// Admin-scope tools: people (roles, bans), the email list and agent keys.
// The services enforce the hard rules — the last admin can't be demoted or
// banned — and these tools add one of their own: a key can't revoke itself
// (lock yourself out by accident, mid-session). There is deliberately no
// tool that mints a key or deletes a user; those stay with a person in /admin.
//

import { z } from "zod";
import { emailSchema } from "@/core/schemas";
import { jobCounts, listJobs, retryFailedJob } from "@/server/jobs";
import { listAgentKeys, revokeAgentKey } from "@/server/services/agent-keys";
import { listSubscribers, unsubscribe } from "@/server/services/community";
import { ServiceError } from "@/server/services/errors";
import { getUserDetail, listUsers, setUserBanned, setUserRole } from "@/server/services/users";
import { DESTRUCTIVE, READ_ONLY, WRITE_IDEMPOTENT, defineTool } from "../types";
import { paging, pagingShape } from "./shared";

const userId = z.string().min(1).max(100).describe("The user's id from users_list or user_get");

export const usersList = defineTool({
  name: "users_list",
  title: "List users",
  description:
    "List the site's users, newest first: id, email, name, role (user | admin), banned, createdAt and lastSeenAt. Filter by role, or search email and name. Personal data: use it for the task at hand only.",
  scope: "admin",
  annotations: READ_ONLY,
  input: z.strictObject({
    search: z.string().max(100).optional().describe("Part of an email or name"),
    role: z.enum(["user", "admin"]).optional(),
    ...pagingShape,
  }),
  async run(args) {
    const page = await listUsers({ search: args.search, role: args.role, ...paging(args) });
    return { items: page.items, nextCursor: page.nextCursor };
  },
});

export const userGet = defineTool({
  name: "user_get",
  title: "Read a user",
  description:
    "Read one user by id or email, with what they can use right now (entitlement: planKey, source subscription | purchase | free, status) and their subscriptions, purchases and feedback.",
  scope: "admin",
  annotations: READ_ONLY,
  input: z.strictObject({ idOrEmail: z.string().min(1).max(254).describe("A user id, or an email address") }),
  async run({ idOrEmail }) {
    return getUserDetail(idOrEmail);
  },
});

export const userSetRole = defineTool({
  name: "user_set_role",
  title: "Change a user's role",
  description:
    "Make a user an admin, or an admin a regular user. Admins can open /admin and do everything. The last admin can't be demoted, nor can an address listed in ADMIN_EMAILS (it must be removed there first). Demoting an admin also revokes every agent key they minted (each revoke is audited). Only when the person explicitly asks. Returns the user. Recorded in the audit log.",
  scope: "admin",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({ id: userId, role: z.enum(["user", "admin"]) }),
  async run({ id, role }, ctx) {
    return { ...(await setUserRole(id, role, ctx.actor)) };
  },
});

export const userSetBanned = defineTool({
  name: "user_set_banned",
  title: "Ban or unban a user",
  description:
    "Ban a user (their sessions end and they can no longer sign in or use the app) or lift a ban. Their data is kept. The last admin can't be banned. Banning an admin also revokes every agent key they minted, and lifting the ban doesn't restore them. Only when the person explicitly asks. Returns the user. Recorded in the audit log.",
  scope: "admin",
  annotations: DESTRUCTIVE,
  input: z.strictObject({ id: userId, banned: z.boolean() }),
  async run({ id, banned }, ctx) {
    return { ...(await setUserBanned(id, banned, ctx.actor)) };
  },
});

export const subscribersList = defineTool({
  name: "subscribers_list",
  title: "List email subscribers",
  description:
    "List the newsletter list, newest first: id, email, source (the form that added it), status (subscribed | unsubscribed) and createdAt. Filter by status or search the email. Personal data: use it for the task at hand only; there is no tool that emails them.",
  scope: "admin",
  annotations: READ_ONLY,
  input: z.strictObject({
    status: z.enum(["subscribed", "unsubscribed"]).optional(),
    search: z.string().max(100).optional(),
    ...pagingShape,
  }),
  async run(args) {
    const page = await listSubscribers({ status: args.status, search: args.search, ...paging(args) });
    return { items: page.items, nextCursor: page.nextCursor };
  },
});

export const subscriberUnsubscribe = defineTool({
  name: "subscriber_unsubscribe",
  title: "Unsubscribe an email",
  description:
    "Take an email address off the newsletter list (kept as unsubscribed, so a later sign-up does not re-subscribe it). Use when someone asked to be removed. Returns the subscriber.",
  scope: "admin",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({ email: emailSchema.describe("The subscriber's email address") }),
  async run({ email }, ctx) {
    const subscriber = await unsubscribe(email, ctx.actor);
    if (!subscriber) throw new ServiceError("not_found", `${email} is not on the list`);
    return { ...subscriber };
  },
});

export const agentKeysList = defineTool({
  name: "agent_keys_list",
  title: "List agent keys",
  description:
    "List the MCP agent keys: id, name, scope (read | write | admin), the last six characters (hint), createdBy (the id of the admin who minted it, or null for a key minted by the CLI, before creators were recorded, or whose creator was deleted), createdAt, lastUsedAt and revokedAt. A key ends when the admin who minted it is demoted, banned or deleted. The keys themselves are never stored or shown. `you` marks the key making this call.",
  scope: "admin",
  annotations: READ_ONLY,
  input: z.strictObject({}),
  async run(_args, ctx) {
    const keys = await listAgentKeys();
    return { items: keys.map((k) => ({ ...k, active: k.revokedAt === null, you: k.id === ctx.key.id })) };
  },
});

export const agentKeyRevoke = defineTool({
  name: "agent_key_revoke",
  title: "Revoke an agent key",
  description:
    "Revoke an agent key by id: it stops working on its next request, permanently (mint a new one in /admin to replace it). You can't revoke the key you are calling with. Only when the person explicitly asks. Returns the revoked key.",
  scope: "admin",
  annotations: DESTRUCTIVE,
  input: z.strictObject({ id: z.string().min(1).max(100).describe("The key's id from agent_keys_list") }),
  async run({ id }, ctx) {
    if (id === ctx.key.id) throw new ServiceError("forbidden", "That is the key this session is using; revoke it from /admin/agents instead");
    return { ...(await revokeAgentKey(id, ctx.actor)) };
  },
});

export const jobsList = defineTool({
  name: "jobs_list",
  title: "List background jobs",
  description:
    "The background job queue, newest first: id, kind (email.send …), status (queued | running | succeeded | failed), attempts of maxAttempts, runAt, lastError, finishedAt, plus counts per status and oldestDueAt (how far behind the runner is). Defaults to failed jobs: the ones that ran out of retries. Payloads are never returned (a queued email holds a live sign-in link).",
  scope: "admin",
  annotations: READ_ONLY,
  input: z.strictObject({
    status: z.enum(["queued", "running", "succeeded", "failed", "all"]).optional().describe("Default failed"),
    ...pagingShape,
  }),
  async run(args) {
    const status = args.status === "all" ? undefined : (args.status ?? "failed");
    const [page, counts] = await Promise.all([listJobs({ status, ...paging(args) }), jobCounts()]);
    return {
      counts,
      items: page.items.map(({ payload: _payload, ...job }) => job), // eslint-disable-line @typescript-eslint/no-unused-vars
      nextCursor: page.nextCursor,
    };
  },
});

export const jobRetry = defineTool({
  name: "job_retry",
  title: "Retry a failed job",
  description:
    "Put a failed background job back in the queue by id (from jobs_list): it runs again within seconds with its attempts reset. Only for a failed job, and only once whatever made it fail is fixed (check lastError), or it fails the same way. Returns the job.",
  scope: "admin",
  annotations: WRITE_IDEMPOTENT,
  input: z.strictObject({ id: z.string().min(1).max(100).describe("The job's id from jobs_list") }),
  async run({ id }, ctx) {
    const { payload: _payload, ...job } = await retryFailedJob(id, ctx.actor); // eslint-disable-line @typescript-eslint/no-unused-vars
    return job;
  },
});

export const ADMIN_TOOLS = [usersList, userGet, userSetRole, userSetBanned, subscribersList, subscriberUnsubscribe, agentKeysList, agentKeyRevoke, jobsList, jobRetry];
