# AI (`modules/ai`)

Chat and image generation for signed-in people, behind controls that let you
leave it switched on: an allowlisted model, a per-process bulkhead, a
per-minute limit, a refundable daily quota and one deadline over the whole
request. **The enable steps, variables and API are in
[modules/ai/README.md](../../modules/ai/README.md).** This page is about
deciding and what changes.

## When you want it

When a feature genuinely needs generation and has somewhere to live — an
assistant in the dashboard, drafting, summarising. A marketing site and a blog
don’t.

The controls are the point. An authenticated endpoint that calls a paid model
with no limits is an invitation to spend your provider balance; this one
can’t be made to call a model you didn’t allow, run longer than its deadline,
or exceed a person’s daily allowance — and a failed call is never charged
against that allowance.

## Choosing a provider

| | Cost | Privacy | Setup |
|---|---|---|---|
| **OpenRouter** (default) | per token, many models behind one key | prompts go to OpenRouter and the model’s host | `AI_API_KEY` |
| **Your own Ollama / vLLM** | your server’s hardware | prompts never leave your server | `AI_BASE_URL`, `AI_CHAT_MODEL` |
| **fal.ai** (images only) | per image | prompts go to fal | `FAL_API_KEY` |

Any OpenAI-compatible endpoint works through `AI_BASE_URL`. If you run a
model yourself, put it on the same private network as the app (a compose
service or a Dokploy/Coolify service), not on a public port.

If you send people’s text to a third-party model, say so in your privacy
policy (`/legal/privacy`, a page you edit in the admin).

## What enabling changes

| Where | Change |
|---|---|
| `drizzle/` | one custom migration: the `ai_usage` table (one row per person per UTC day) |
| `src/app/api/ai/{chat,image,usage}/route.ts` | three re-export files (leave out what you don’t use), each listed in `tests/authz.test.ts` and `src/server/api-reference.ts` ([modules](README.md)) |
| `.env.example` / your environment | the `AI_*` block from the module README |
| `package.json` | nothing |

No page is added: you build the UI your feature needs and call the routes —
or the service, from server code. Nothing about it is shown publicly.

## Paywall

Billing is in the core, so the paywall is configuration:
`AI_UNMETERED_PLANS=pro` makes Pro holders unmetered (checked with
`hasPlan()`, from rows a verified billing webhook wrote), and
`AI_FREE_CALLS_PER_DAY` is everyone else’s allowance (`0` for plan holders
only). With billing off, the free allowance is the whole policy.

## Checking it

1. `npm run check`.
2. Signed in, `GET /api/ai/usage` shows `chat: true` and your allowance.
3. A chat request answers; the next `usage` shows one used.
4. Stop the model (or set a bad key) and send another: it fails with `502`
   and `usage` shows the call was given back.
5. Send more than your allowance: `429` with `Retry-After`.

## Scaling out

The quota is in Postgres and exact on any number of replicas. The per-minute
limit is in-process by default; behind several replicas, enable
[Redis](redis.md) and switch the one import in `modules/ai/rate-limit.ts`.
The bulkhead stays per process on purpose.
