# modules/ai — a bounded AI gateway

Chat completions and image generation for signed-in people, behind controls
that make an AI feature something you can leave switched on: an allowlisted
model, an in-process bulkhead, a per-minute limit, a refundable daily quota,
and one deadline over the whole request. Holders of the plans you name are
unmetered.

**Installs nothing.** Plain `fetch` to an OpenAI-compatible endpoint, no SDK.
**Requires** only the app: Better Auth for the person, Postgres for the
quota ledger, billing (optional) for the paywall.

The controls are the product. Without them an authenticated AI endpoint is an
open invitation to spend your provider balance, and the bill arrives before
the traffic graph does.

---

## What it does

| Route | Body | Answers |
|---|---|---|
| `POST /api/ai/chat` | `{ messages: [{ role: "user" \| "assistant", content }] }` | `{ text, remainingToday }` |
| `POST /api/ai/image` | `{ prompt }` | `{ url, remainingToday }` |
| `GET /api/ai/usage` | — | `{ chat, image, unmetered, freePerDay, usedToday, remainingToday, resetsInSeconds }` |

Every refusal is `{ error, message, details? }` (the app’s own shape); `429`
and `503` carry `Retry-After`. `remainingToday` is `null` for unmetered people.

From server code — a page, a server action, your own route — call the
service directly; it takes the `User` from `requireUser()`:

```ts
import { generateChat, getAiUsage } from "../../modules/ai/service"; // path from your file

const user = await requireUser("/dashboard/assistant");
const { text } = await generateChat(
  user,
  { messages: [{ role: "user", content: question }] },
  { system: "You answer questions about invoices. Be brief." },
);
```

Clients can’t send a `system` message or pick a model off the allowlist; the
system prompt is your server code’s (`options.system`).

### Providers

One OpenAI-compatible base URL serves chat (`POST {base}/chat/completions`)
and, for models not named `fal-ai/…`, images (`POST {base}/images/generations`):

| You run | Set |
|---|---|
| OpenRouter (the default) | `AI_API_KEY` |
| Ollama on your server | `AI_BASE_URL=http://ollama:11434/v1`, `AI_CHAT_MODEL=llama3.2` (no key) |
| vLLM, LiteLLM, any OpenAI-compatible server | `AI_BASE_URL`, `AI_CHAT_MODEL`, and `AI_API_KEY` if it wants one |
| fal.ai for images (optional) | `FAL_API_KEY` (defaults `AI_IMAGE_MODEL` to `fal-ai/flux/schnell`) |

Keys never leave the server, and logs carry status codes only: a provider’s
error body can echo the prompt.

## The guard chain, in order

1. **Concurrency** (`concurrency.ts`) — in memory, free, instant. Refusing here
   costs nothing, so under a stampede the rest never runs. Per process on
   purpose: it protects this process’s sockets.
2. **Rate limit** (`rate-limit.ts`) — per person per minute, through the app’s
   `rateLimit()` (in-process). Behind several replicas, swap in
   `modules/redis`’s shared limiter: one import line, shown in that file.
3. **Quota** (`usage.ts`) — the daily allowance, an atomic increment in
   Postgres (`ai_usage`). The only refundable step, so it goes last: only a
   **delivered** answer costs a free call; a provider outage, a timeout or a
   closed tab gives it back.

Then a **total deadline** (`AI_TOTAL_REQUEST_TIMEOUT_SECONDS`) over all of it:
a request that spent 40 s waiting on a busy database gets what is left, not a
fresh 60 s — by then the proxy in front of the app has given up, and the
answer is paid for and thrown away.

Validation runs first of all: a malformed request costs no quota and no
rate-limit slot.

## The paywall

Billing is in OpenShipKit’s core, so this is configuration, not code:

| `AI_FREE_CALLS_PER_DAY` | `AI_UNMETERED_PLANS` | Result |
|---|---|---|
| `5` (default) | unset | everyone gets 5 a day (UTC) |
| `5` | `pro` | Pro holders unlimited, everyone else 5 a day |
| `0` | `pro` | Pro holders only (`403 forbidden` for others) |
| `0` | unset | refused at startup: nobody could use it |

Plans are checked with `hasPlan()` (`src/server/services/billing.ts`): rows a
verified Polar webhook wrote, never a query string, and “Everything in Pro”
counts as Pro. With billing off nobody holds a plan, so the free quota is the
whole policy. The usage screen can show `getAiUsage(user)` before someone hits
the limit, not only when they’re refused.

## Enable

**1. Nothing to install.**

**2. Apply the migration** (one table, `ai_usage`). Stop `npm run dev` first,
then:

```bash
npm run db:generate -- --custom --name ai_usage
cp modules/ai/migration.sql drizzle/0005_ai_usage.sql   # the file name it printed
```

Restart `npm run dev` (it migrates the embedded database at boot). Deploys
apply it with `npm run db:migrate` — the compose `migrate` service runs it.

**3. Mount the routes** — create these three files:

```ts
// src/app/api/ai/chat/route.ts
export { POST } from "../../../../../modules/ai/routes/chat";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

```ts
// src/app/api/ai/image/route.ts
export { POST } from "../../../../../modules/ai/routes/image";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

```ts
// src/app/api/ai/usage/route.ts
export { GET } from "../../../../../modules/ai/routes/usage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

Leave out the ones you don’t use (no images → no image route).

**4. Set the variables** in `.env.local` (or your server’s environment), and
add this block to `.env.example`:

```bash
# ---- AI (modules/ai) — off until AI_API_KEY or AI_BASE_URL is set ----
# AI_API_KEY=                       # OpenRouter by default; any OpenAI-compatible endpoint's key
# AI_BASE_URL=                      # e.g. http://ollama:11434/v1 for a self-hosted Ollama (default: OpenRouter)
# AI_CHAT_MODEL=                    # required with AI_BASE_URL; default openrouter/auto on OpenRouter
# AI_ALLOWED_CHAT_MODELS=           # comma-separated; default: AI_CHAT_MODEL alone
# AI_IMAGE_MODEL=                   # "fal-ai/…" goes to fal.ai, anything else to AI_BASE_URL
# AI_ALLOWED_IMAGE_MODELS=
# FAL_API_KEY=                      # optional, images through fal.ai
# AI_FREE_CALLS_PER_DAY=5           # per person per UTC day; 0 = AI_UNMETERED_PLANS holders only
# AI_UNMETERED_PLANS=               # plan keys whose holders are unmetered, e.g. pro
# AI_RATE_LIMIT_PER_MINUTE=20
# AI_MAX_CONCURRENT_REQUESTS=8
# AI_MAX_CONCURRENT_REQUESTS_PER_USER=2
# AI_MAX_MESSAGES=32
# AI_MAX_INPUT_CHARS=24000          # summed over all messages
# AI_MAX_OUTPUT_TOKENS=1024
# AI_REQUEST_TIMEOUT_SECONDS=60     # one upstream call
# AI_TOTAL_REQUEST_TIMEOUT_SECONDS=55   # the whole request; keep it under your proxy's timeout
```

**5. Check it:** `npm run check`, then, signed in, from the browser console on
your site:

```js
await (await fetch("/api/ai/usage")).json();
await (await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Say hello" }] }) })).json();
```

## Calling it from the browser

```ts
const res = await fetch("/api/ai/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
});
const body = await res.json();
if (!res.ok) {
  // 429/503: wait exactly Retry-After seconds before trying again.
  throw new Error(body.message);
}
```

**Don’t send `model`.** The server uses its default and refuses anything off
the allowlist; a client that names one breaks the day the allowlist changes.
The request must come from your own pages (same origin) with the session
cookie; a cross-site post is refused.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `AI_API_KEY` | — | Turns chat on (OpenRouter unless `AI_BASE_URL`) |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | Turns chat on by itself (a self-hosted endpoint may need no key) |
| `AI_CHAT_MODEL` | `openrouter/auto` on OpenRouter | Required with `AI_BASE_URL` |
| `AI_ALLOWED_CHAT_MODELS` | the default model | Must include the default — checked at startup |
| `AI_IMAGE_MODEL` | `fal-ai/flux/schnell` with `FAL_API_KEY` | Turns images on |
| `AI_ALLOWED_IMAGE_MODELS` | the default image model | |
| `FAL_API_KEY` | — | Only for `fal-ai/…` models |
| `AI_FREE_CALLS_PER_DAY` | `5` | `0` = plan holders only |
| `AI_UNMETERED_PLANS` | — | Plan keys, comma-separated |
| `AI_RATE_LIMIT_PER_MINUTE` | `20` | Per person |
| `AI_MAX_CONCURRENT_REQUESTS` | `8` | Per process |
| `AI_MAX_CONCURRENT_REQUESTS_PER_USER` | `2` | Per process |
| `AI_MAX_MESSAGES` | `32` | |
| `AI_MAX_INPUT_CHARS` | `24000` | Summed: ten 20,000-character messages cost what one 200,000 does |
| `AI_MAX_OUTPUT_TOKENS` | `1024` | |
| `AI_REQUEST_TIMEOUT_SECONDS` | `60` | One upstream call |
| `AI_TOTAL_REQUEST_TIMEOUT_SECONDS` | `55` | The whole request |

The default model must be on its own allowlist: clients don’t send a model,
so every real request uses the default, and an allowlist without it would
read as a control without being one.

## What it stores

`ai_usage(user_id, day, count)`: one row per person per UTC day, swept after
7 days by an hourly timer (one per process, unref’d). Deleting a person
deletes their rows. Prompts and answers are **not** stored or logged; if your
feature keeps a history, that is a table and a service of its own, audited
like every other write.

Generated image URLs aren’t stored either. A fal CDN link expires; if an
image must last, fetch the bytes and keep them yourself. For an image an
admin keeps (a post cover), hand them to the media library’s `uploadMedia()`
(`src/server/services/media.ts`), which checks the file and audits the upload.

## Removing it

1. Delete `src/app/api/ai/` — the module is inert at once.
2. Remove `modules/rag` first if it’s enabled (it uses this module).
3. Drop the table, only when you mean it, as a new migration (never by
   editing the applied one):

   ```bash
   npm run db:generate -- --custom --name drop_ai_usage
   echo 'DROP TABLE IF EXISTS "ai_usage";' > drizzle/00NN_drop_ai_usage.sql
   ```

4. Delete `modules/ai/` and `tests/modules/ai.test.ts` if you won’t want it back.
