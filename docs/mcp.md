# The MCP server

OpenShipKit has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server at **`/api/mcp`**. Connect Claude Code, Claude Desktop, Cursor, VS Code, Codex or any MCP client, and an agent can run the whole site in plain words: edit any section of the landing page, write and publish posts, change plans, triage feedback, look up users, and undo its own mistakes.

Agents go through the same services as the admin panel (`src/server/services/*`), so every change is validated by the same schemas and recorded in the same audit log, with the value before and after.

- [Quick start (local)](#quick-start-local)
- [Agent keys and scopes](#agent-keys-and-scopes)
- [Connect a client](#connect-a-client): [Claude Code](#claude-code) · [Claude Desktop](#claude-desktop) · [Cursor](#cursor) · [VS Code](#vs-code) · [Codex](#codex) · [Anything else](#any-other-client)
- [Tool reference](#tool-reference)
- [Security model](#security-model)
- [Example sessions](#example-sessions)
- [Protocol details](#protocol-details)
- [Troubleshooting](#troubleshooting)
- [Adding a tool](#adding-a-tool)

---

## Quick start (local)

1. Put a development key in `.env.local` (`npm run setup` writes one for you):

   ```bash
   MCP_DEV_KEY=osk_<43 random characters>
   ```

   It only works while the site runs on the local demo database (no `DATABASE_URL`) and `NODE_ENV` isn’t `production`, and it acts as an **admin** key. On a real server it does nothing.

2. Start the site: `npm run dev`.

3. Tell your client the key. In this repository, Claude Code reads `.mcp.json`, which takes the key from your environment:

   ```bash
   export OPENSHIPKIT_MCP_KEY="$(grep ^MCP_DEV_KEY= .env.local | cut -d= -f2)"
   claude
   ```

   Approve the `openshipkit` server when Claude Code asks, then try: *“Call the guide tool, then tell me what’s on the landing page.”*

4. Check the door by hand:

   ```bash
   curl -s http://localhost:3000/api/mcp \
     -H "Authorization: Bearer $OPENSHIPKIT_MCP_KEY" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

---

## Agent keys and scopes

An agent key looks like `osk_` followed by 43 characters. It is shown **once**, when it is created; only its SHA-256 hash is stored. Lost a key? Revoke it and mint another.

| Scope | What it can do |
|---|---|
| `read` | Read everything that isn’t a secret or personal data: content, posts (drafts too), plans, feedback, the audit log. |
| `write` | `read`, plus edit and publish content and posts, edit plans’ copy and presentation, triage feedback, and restore from the audit log. |
| `admin` | `write`, plus plan prices, provider price ids, trials, limits, which plan is the free plan, and plan deletion; the site’s `contactEmail`; users (roles, bans), the email list, agent keys and personal data. |

Give each agent the smallest scope that does the job. A writing assistant needs `write`; almost nothing needs `admin`.

Three lines are drawn inside the tools, not just between them:

- **Personal data is admin-only.** Below `admin`, `feedback_list` leaves out the sender’s email and name (`hasEmail` / `hasName` say whether there is one), `audit_list` shows before/after only for `content`, `post`, `plan`, `feedback` and `seed` entries and withholds the rest (`user`, `subscriber`, `subscription`, `purchase`, `billing_customer`, `agent_key`, and any entity added later), and a person who made a change shows as `user:<id>` rather than their email. The same applies to `site_overview`’s recent changes.
- **What customers are charged is admin-only.** A `write` key can change a plan’s name, description, features, `highlighted`, `contactSales`, `ctaLabel`, `active` and `sortOrder`. Setting or changing `prices` (amounts, intervals, currencies, the provider ids `polarProductId`, `stripePriceId`, `razorpayPlanId`), `trialDays` or `limits`, changing which plan is the free plan (whose limits everyone without a paid plan gets: a priceless plan’s `active`, `sortOrder` or `contactSales`, or a new or deleted priceless plan), deleting a plan, or an `audit_restore` that would do any of these, needs `admin`. Entitlements come from matching a webhook’s product or price id against plan prices, so remapping an id is remapping who gets paid access.
- **Where contact-form messages go is admin-only.** Every contact-form submission, with the sender’s name and email, is emailed to the `site` section’s `contactEmail`. A `content_update`, `content_reset` or `audit_restore` that would change that address needs `admin`, so an agent fooled by a hostile feedback message can’t redirect your visitors’ messages to itself.

**Create a key** in the admin at **/admin/agents** (the page shows ready-to-paste client config), or from a terminal:

```bash
npm run mcp:key -- --name "Claude Code on my laptop" --scope write
npm run mcp:key -- list
npm run mcp:key -- revoke <id>
```

Name each key after the agent or person using it: the audit log shows that name (`agent:Claude Code on my laptop`) next to every change it makes.

A key minted in /admin/agents belongs to the admin who minted it: demoting, banning or deleting that admin revokes it, and each revoke is in the audit log. A key minted with the CLI has no owner (`createdBy` is null) and lasts until you revoke it.

The CLI works against your Postgres (`DATABASE_URL`) and against the embedded demo database. The embedded database (PGlite) opens in **one process at a time**, so with `npm run dev` running, either stop it first or use /admin/agents. With `DATA_PROVIDER=memory` the CLI refuses: a key minted into a throwaway store would vanish when the command exits.

---

## Connect a client

Every client needs two things: the endpoint, `https://<your site>/api/mcp` (`http://localhost:3000/api/mcp` locally), and the header `Authorization: Bearer <key>`. The transport is **Streamable HTTP**; no local process is needed except for clients that only speak stdio.

### Claude Code

This repository ships a project `.mcp.json`:

```json
{
  "mcpServers": {
    "openshipkit": {
      "type": "http",
      "url": "${OPENSHIPKIT_MCP_URL:-http://localhost:3000/api/mcp}",
      "headers": { "Authorization": "Bearer ${OPENSHIPKIT_MCP_KEY:-}" }
    }
  }
}
```

Set `OPENSHIPKIT_MCP_KEY` (and `OPENSHIPKIT_MCP_URL` for a deployed site) in the shell you start `claude` from. The key never goes into the repository.

Or add a server by hand, for any site, from anywhere:

```bash
claude mcp add --transport http openshipkit "https://example.com/api/mcp" \
  --header "Authorization: Bearer osk_…"
```

Check it with `/mcp` inside Claude Code.

### OpenCode

[OpenCode](https://opencode.ai) reads MCP servers from `opencode.json`. This repository ships one at the project root, so running `opencode` here finds the local site:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "openshipkit": {
      "type": "remote",
      "url": "http://localhost:3000/api/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:OPENSHIPKIT_MCP_KEY}"
      }
    }
  }
}
```

Set `OPENSHIPKIT_MCP_KEY` in the shell you start `opencode` from: `MCP_DEV_KEY` from `.env.local` for the local demo, or a key minted in `/admin/agents` (or with `npm run mcp:key`). `{env:…}` keeps the key out of the file. For a deployed site, change `url` to `https://<your site>/api/mcp`, or add a second server (say `openshipkit-prod`) in your global OpenCode config so every project can reach it. `"oauth": false` matters: the endpoint takes a bearer key, so without it OpenCode tries OAuth discovery first and reports the server as needing authentication.

Then ask in plain words, for example: “Use openshipkit to change the hero title to ‘Ship it this weekend’, then show me the audit entry.”

### Claude Desktop

Claude Desktop’s config file speaks stdio, so bridge to HTTP with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). In **Settings → Developer → Edit Config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "openshipkit": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://example.com/api/mcp", "--header", "Authorization:${OPENSHIPKIT_AUTH}"],
      "env": { "OPENSHIPKIT_AUTH": "Bearer osk_…" }
    }
  }
}
```

The header value goes through `env` because some platforms mangle spaces inside `args`. `mcp-remote` refuses plain `http://` except for `localhost`; for a local site use `http://localhost:3000/api/mcp`. Restart Claude Desktop after editing.

### Cursor

`.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "openshipkit": {
      "url": "https://example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${env:OPENSHIPKIT_MCP_KEY}" }
    }
  }
}
```

`${env:…}` reads the key from the environment Cursor was started in; paste the key in its place if you prefer, and keep that file out of git.

### VS Code

`.vscode/mcp.json` (GitHub Copilot agent mode). VS Code prompts for the key once and stores it securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "openshipkit-key", "description": "OpenShipKit agent key", "password": true }
  ],
  "servers": {
    "openshipkit": {
      "type": "http",
      "url": "https://example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${input:openshipkit-key}" }
    }
  }
}
```

### Codex

`~/.codex/config.toml` (Codex CLI and the IDE extension share it):

```toml
[mcp_servers.openshipkit]
url = "https://example.com/api/mcp"
bearer_token_env_var = "OPENSHIPKIT_MCP_KEY"
```

Codex sends the value of `OPENSHIPKIT_MCP_KEY` as the bearer token. Older Codex versions only run stdio servers; use the `mcp-remote` command from the Claude Desktop section there.

### Any other client

Most clients accept this shape:

```json
{ "openshipkit": { "type": "http", "url": "https://example.com/api/mcp", "headers": { "Authorization": "Bearer osk_…" } } }
```

A browser-based client (an MCP inspector page, say) sends an `Origin` header, which must be listed in `MCP_ALLOWED_ORIGINS`; see [Security model](#security-model).

---

## Tool reference

Agents read each tool’s full description and JSON Schema from `tools/list`; this is the human summary. **Scope** is the least scope that sees the tool. *Read-only*, *idempotent* and *destructive* are the MCP annotations clients use for their approval prompts.

Every write is live when the call returns (pages render at request time) and is recorded in the audit log.

### Orientation

| Tool | Scope | What it does |
|---|---|---|
| `site_overview` | read | Site URL, what it runs on (data, billing, email, demo or not), database health, headline counts, new accounts and subscribers per UTC day for the last 30 days (`growth`), when it was read (`checkedAt`) and the ten latest changes. Start here. |
| `guide` | read | The manual: working rules, every content key with its label, tip and full JSON Schema, post kinds and Markdown rules, the plan model. `topic`: `content`, `posts`, `plans`, `workflow` or `all` (default). |
| `render_markdown_preview` | read | Renders a Markdown body exactly as a post page will (sanitised HTML, table of contents, reading minutes) without saving. `markdown`, `kind?`. |

### Content (landing page and site chrome)

The editable site is one JSON document per key: `site`, `navigation`, `announcement`, `hero`, `logos`, `features`, `steps`, `stats`, `testimonials`, `pricing`, `latestPosts`, `faq`, `cta` (from `src/core/content.ts`).

| Tool | Scope | What it does |
|---|---|---|
| `content_list` | read | Every section with its label, whether it was edited (`stored`) and when. |
| `content_get` | read | One section’s current value (the default if never edited) and its JSON Schema. `key`. |
| `content_update` | write | Saves a section. `mode: "merge"` (default) deep-merges `value` over the current value: objects merge, arrays and strings replace. `mode: "replace"` stores the whole section. Must pass the schema. Changing `site.contactEmail` needs `admin`. *Idempotent.* |
| `content_reset` | write | Forgets the saved value; the default shows again. *Destructive* (restorable). Resetting `site` when that would change `contactEmail` needs `admin`. |

### Posts (blog, changelog, static pages)

| Tool | Scope | What it does |
|---|---|---|
| `posts_list` | read | Posts newest first, without bodies. Filters: `kind` (`post`, `changelog`, `page`), `status`, `listed`, `tag`, `search` (words in the title or body). Paged. |
| `post_get` | read | One post in full, by `id` or by `kind` + `slug`, with its public `url`. |
| `post_create` | write | Creates a post, a **draft** unless `status: "published"`. Slug derived from the title when omitted. |
| `post_update` | write | Changes some fields by `id`; others keep their value. Set `coverAlt` (what the cover image shows) whenever you set `coverImage`. `listed: false` takes a published post off the lists but keeps it live (see below). |
| `post_publish` | write | Makes a post live now; keeps its `publishedAt` or stamps now (or takes a past date to back-date it). *Idempotent.* |
| `post_unpublish` | write | Back to draft: its URL 404s and it leaves feeds and the sitemap. *Idempotent.* |
| `post_delete` | write | Deletes a post. *Destructive*, but `audit_restore` recreates it. Prefer `post_unpublish`. |

**Published and listed are different questions.** `status` decides whether a post is live at all; `listed` (default `true`) decides whether it is promoted on `/blog`, tag pages, the changelog list, related posts, the home page and `llms.txt`. An unlisted published post still answers 200 at its URL and stays in the sitemap, the RSS feed and `llms-full.txt`. Use it for a post that has outlived its reason to be advertised, instead of unpublishing it (which would drop it from search and break links).

With the blog switched off (`OPENSHIPKIT_WITHOUT=blog`, [site-profile.md](site-profile.md#switching-features-off)), creating or publishing a blog post (`kind: "post"`) is refused; existing ones can still be edited, unpublished or deleted, and changelog entries and pages are unaffected.

There is no scheduling: a published post is live at once, whatever its `publishedAt`. So `post_create`, `post_update` and `post_publish` refuse a published post dated more than a few minutes in the future (`invalid`, on `publishedAt`). To publish later, keep the draft and publish on the day.

### Media (images)

| Tool | Scope | What it does |
|---|---|---|
| `media_list` | read | Images in the media library, newest first: `url` (root-relative `/uploads/…`, for `coverImage` or Markdown), `absoluteUrl`, type, size, upload time. Paged. |
| `media_upload` | write | Adds an image from base64 `data` (or a `data:` URL), up to 700 KB through MCP (the endpoint takes 1 MB requests; `/admin/media` takes up to 5 MB). PNG, JPEG, WebP, AVIF or GIF, checked by the bytes; SVG refused. Returns the image with its `url`. |

There is deliberately no tool that fetches an image from a URL (the server would request whatever address an agent was talked into: SSRF), and no `media_delete`: a deleted file can’t be restored from the audit log, so deletes stay in **/admin/media**, which refuses to delete an image a post or section still uses.

### Plans (pricing)

| Tool | Scope | What it does |
|---|---|---|
| `plans_list` | read | Every plan in display order (`activeOnly?`). |
| `plan_get` | read | One plan by `key`. |
| `plan_upsert` | write | Creates or replaces a whole plan. Omitted fields take defaults, not old values. Setting or changing `prices`, `trialDays` or `limits`, or which plan is the free plan, needs `admin`. |
| `plan_update` | write | Changes some fields of a plan by `key`. Top-level fields replace whole (send the full `prices` or `features`). Changing `prices`, `trialDays` or `limits`, or which plan is the free plan, needs `admin`. |
| `plan_delete` | admin | Deletes a plan. *Destructive* (restorable). Prefer `plan_update {active: false}`. |

`amountCents` is what `/pricing` shows. What a customer is charged is set at the billing provider, on the object in the price’s field for it (`polarProductId`, `stripePriceId` or `razorpayPlanId`; [billing.md](billing.md)); changing a price here never changes the provider, and the tools say so in their reply. Agents are told never to invent an id. `limits` are what the plan allows by metric ([usage.md](usage.md)).

Under `OPENSHIPKIT_PROFILE=site` ([site-profile.md](site-profile.md)) the five plan tools are not offered: `tools/list` leaves them out, calling one answers “Unknown tool”, `guide` explains why under `topic: "plans"`, and `site_overview` reports the profile in `stack.profile`. The plans stay in the database, and switching back to `saas` brings the tools back.

### Feedback and the audit log

| Tool | Scope | What it does |
|---|---|---|
| `feedback_list` | read | The inbox: bug reports, feature requests, notes and contact-form messages. Filters: `status`, `kind`. Paged. The sender’s email and name only with `admin`. |
| `feedback_update` | write | Sets `status` and/or the private `adminNote`. Nothing is emailed. |
| `audit_list` | read | Recorded changes, newest first: who, what, which entity, restorable or not. Filters: `entity`, `entityId`; `includeValues: true` adds before/after (withheld for personal-data entities below `admin`). |
| `audit_restore` | write | Puts back an entry’s *before* value: the undo for content, posts and plans. Restoring a create removes it; restoring a delete recreates it (a post keeps its original id, slug and creation date; refused if another post now has that slug). The restore is itself recorded, so it can be undone too. Its `live` says whether the result is public now (false for a draft, an inactive plan, or something the restore removed). A plan restore that changes prices, provider ids, the trial or limits, changes which plan is the free plan, or removes the plan, and a `site` restore that changes `contactEmail`, need `admin`. |

### Admin

| Tool | Scope | What it does |
|---|---|---|
| `users_list` | admin | Users newest first: email, name, role, banned, dates. Filters: `search`, `role`. |
| `user_get` | admin | One user by id or email, with their entitlement, subscriptions, purchases and feedback. |
| `user_set_role` | admin | `user` or `admin`. The last admin can’t be demoted, nor an `ADMIN_EMAILS` address. Demoting an admin revokes the agent keys they minted. |
| `user_set_banned` | admin | Bans or unbans; a ban ends their sessions. The last admin can’t be banned. Banning an admin revokes the agent keys they minted (unbanning doesn’t bring them back). *Destructive.* |
| `subscribers_list` | admin | The email list: email, source, status. Filters: `status`, `search`. |
| `subscriber_unsubscribe` | admin | Takes an email off the list (kept as unsubscribed, so a later sign-up does not re-subscribe it). |
| `agent_keys_list` | admin | Keys with name, scope, hint, `createdBy` (the admin who minted it; null for CLI keys), last use and revocation; `you` marks the calling key. Keys themselves are never shown. |
| `agent_key_revoke` | admin | Revokes a key by id. Refuses the key making the call. *Destructive.* |
| `jobs_list` | admin | The background job queue with counts per status; failed jobs by default. Never the payloads. |
| `job_retry` | admin | Puts a failed job back in the queue, attempts reset. Audited. |
| `orgs_list` | admin | Every organisation (teams on): name, slug, member count. Filter: `search`. |
| `org_get` | admin | One organisation: members and roles, open invitations, seats, subscriptions. Read-only. |
| `usage_get` | admin | One user's (or, with teams on, organisation's) usage this period against their plan's limits ([usage.md](usage.md)). |

**Deliberately missing:** there is no tool that mints a key, deletes a user, sends an email, changes billing at the billing provider or reads a secret. Those stay with a person in /admin or at the provider.

### Replies and errors

A successful call returns the result as `structuredContent` and the same JSON as text. A refusal is a normal tool result with `isError: true` and

```json
{ "error": "invalid", "message": "title: Too big: expected string to have <=120 characters", "details": [{ "path": "title", "message": "…" }] }
```

`error` is one of `invalid` (bad arguments or a value that fails its schema), `not_found`, `conflict` (a taken slug), `forbidden` (scope, the last admin, your own key), `unavailable`, `rate_limited`, or `server_error` (a bug or an outage: logged on the server, never described to the agent). An agent reads the message, fixes its arguments and retries.

---

## Security model

**Who can call.** Only a bearer token that is an active agent key, looked up by its SHA-256. A revoked key stops working on its next request. Missing or wrong keys get `401` with `WWW-Authenticate: Bearer`; repeated failures from one IP are rate-limited. `MCP_DEV_KEY` is accepted only on the local demo database outside production, so a copied `.env.local` can’t open a real server.

**What they can do.** The key’s scope. `tools/list` hides tools above it, and `tools/call` checks the scope again, so a hidden tool can’t be called by name. Tools call services only, never the database, so an agent gets exactly the validation an admin gets, and the same invariants: the last admin can’t be demoted or banned, a key can’t revoke itself, a slug can’t collide.

**What is recorded.** Every write lands in the audit log with the key’s name, the action, and the value before and after. Content, posts and plans can be restored from **/admin/audit** or with `audit_restore`. Feedback, users, subscribers and keys are recorded but not restorable, so their tools ask agents to act only when explicitly asked.

**The door itself.**

- Off entirely with `OPENSHIPKIT_WITHOUT=mcp`: every method answers `404` ([site-profile.md](site-profile.md#switching-features-off)).
- `POST` only; `GET` and `DELETE` are `405` (no streams, no sessions).
- **Origin check against DNS rebinding:** a request carrying an `Origin` header must come from the site’s own origin (`NEXT_PUBLIC_SITE_URL`) or one listed in `MCP_ALLOWED_ORIGINS` (comma-separated), else `403`. Desktop and CLI clients send no `Origin`.
- 120 calls a minute per key, a 1 MB body cap, JSON only, one message per request (no batches), `Cache-Control: no-store` on every reply.
- No secrets in replies: keys are shown only as a six-character hint, and unexpected errors are logged, never returned.

**Prompt injection.** Feedback messages and form submissions come from the public. The tool descriptions tell agents to treat that text as data, but an agent can still be fooled: give agents that read feedback a `read` or `write` key rather than `admin`, and review the audit log after long sessions. That is why `read` and `write` keys see no personal data, can’t change what customers are charged and can’t move the contact address: a fooled agent with one can’t repeat your users’ emails into a published post, point a cheap product at your Pro plan, or have every future contact message sent to itself.

**Good habits.** One key per agent, named after it. Drafts first, publish after review. Keep `admin` keys rare. An agent key is a password: it belongs in your client’s config or environment, never in a repository or a browser. Revoke keys you no longer use.

`/api/health` is the one other machine-facing route: it reports `{ ok, data, schema, jobs, stack, version, time }` (200, or 503 when the database doesn’t answer or its migrations are behind the code) and nothing secret. `stack.profile` (`saas` or `site`) is how `npm run smoke` knows whether `/pricing` should exist.

---

## Example sessions

### Change a headline, then undo it

> **You:** Change the hero title to “Ship it this weekend”.

The agent calls `content_get {key: "hero"}`, then

```json
{ "name": "content_update", "arguments": { "key": "hero", "mode": "merge", "value": { "title": "Ship it this weekend" } } }
```

and the landing page shows the new title on the next request.

> **You:** Undo that.

`audit_list {entity: "content", entityId: "hero"}` finds the `content.update` entry; `audit_restore {id: "<that entry>"}` puts the old title back.

### Write and publish a changelog entry

> **You:** Draft a changelog entry for today’s dark-mode release, show me, then publish.

1. `render_markdown_preview {markdown: "…", kind: "changelog"}` to check the body.
2. `post_create {kind: "changelog", title: "Dark mode", body: "…"}` returns a draft with its `id` and `url`.
3. After you approve: `post_publish {id}`. It is live at `/changelog/dark-mode`.

### Raise a price

> **You:** Make Pro $29 a month.

With an `admin` key: `plan_get {key: "pro"}`, then `plan_update {key: "pro", prices: [<the full prices array with the month amount set to 2900>]}`. The reply reminds the agent, and it reminds you, that the price behind it must be changed to match at the billing provider in use. A `write` key is refused (`forbidden`) and the agent should say the change needs you, in /admin/plans.

### Triage the inbox

> **You:** What came in this week? Mark the bugs as planned.

`feedback_list {status: "new"}`, then `feedback_update {id, status: "planned"}` for each bug.

### By hand, with curl

```bash
MCP=http://localhost:3000/api/mcp
H=(-H "Authorization: Bearer $OPENSHIPKIT_MCP_KEY" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")

curl -s $MCP "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s $MCP "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"content_get","arguments":{"key":"hero"}}}'
curl -s $MCP "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"content_update","arguments":{"key":"hero","value":{"title":"Ship it this weekend"}}}}'
```

---

## Protocol details

- **Transport:** stateless Streamable HTTP. Each `POST` carries one JSON-RPC 2.0 message and gets a JSON reply (never an SSE stream). Notifications and client responses get `202 Accepted` with no body. No `Mcp-Session-Id`.
- **Versions:** `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. `initialize` echoes the requested version when supported, else answers with the newest. A request whose `MCP-Protocol-Version` header names an unsupported version gets `400`.
- **Methods:** `initialize` (with server `instructions`), `ping`, `tools/list`, `tools/call`. Capabilities: `tools` only (`listChanged: false`). Anything else is `-32601`.
- **Errors:** `-32700` invalid JSON, `-32600` invalid request or a batch, `-32601` unknown method, `-32602` unknown tool or malformed params. Bad tool *arguments* are a tool result with `isError`, so the model can correct itself.
- **Code:** `src/server/mcp/protocol.ts` (the protocol, pure and unit-tested), `src/server/mcp/auth.ts` (keys, dev key, Origin), `src/server/mcp/tools/*` (the tools), `src/app/api/mcp/route.ts` (the HTTP door).

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `401 unauthorized` | No `Authorization: Bearer …` header, a typo, or a revoked key. With `MCP_DEV_KEY`: it is ignored when `DATABASE_URL` is set or in production; mint a real key. |
| Claude Code shows the server as failed | `OPENSHIPKIT_MCP_KEY` isn’t set in the shell that started `claude`. Run `/mcp` to see the error. |
| `403 forbidden` mentioning the origin | A browser-based client. Add its origin to `MCP_ALLOWED_ORIGINS`. |
| A tool returns `forbidden` about scope | The key’s scope is too small for that tool; mint one with more scope (or ask the site owner). |
| `npm run mcp:key` says the database is locked | The embedded database is open in `npm run dev`. Stop it, or mint the key at /admin/agents. |
| `429` | 120 calls a minute per key. The reply’s `Retry-After` says when to try again. |
| A change doesn’t show | Changes are live immediately; a CDN in front of the site may cache pages. Check `content_get` and the audit log. |

---

## Adding a tool

1. Add the service function first (`src/server/services/*`): validation and audit belong there, not in the tool.
2. Define the tool in the matching `src/server/mcp/tools/*.ts` file with `defineTool`: a snake_case `name`, a `title`, a `description` written for an agent (what it does, when to use it, what it returns), the least `scope`, `annotations` (`READ_ONLY`, `WRITE_IDEMPOTENT`, `WRITE_ADDITIVE` or `DESTRUCTIVE`), a `z.strictObject` input and a `run` that calls the service.
3. Add it to that file’s exported list (it is picked up by `src/server/mcp/tools/index.ts`) and to the tables above. `tests/mcp.test.ts` fails if a registered tool isn’t named in this file.
4. Run `npm run docs:api` to regenerate [api.md](api.md), which lists every tool with its input (`tests/api-reference.test.ts` fails until it matches).
