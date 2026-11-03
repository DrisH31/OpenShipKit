# Observability

What the server tells you when something goes wrong: one structured log
line per event, and, if you want it, every server error sent to an error
tracker you can host yourself. Nothing leaves the server until you set
`ERROR_TRACKING_DSN`.

## Logs

Server code writes through one logger, `log` in `src/server/log.ts`, never
straight to `console`. `npm run lint` refuses a bare `console.*` in server
code.

```ts
import { log } from "@/server/log";

log.info("billing", "webhook recorded", { event: id });
log.warn("indexnow", "403 for 3 URL(s)");
log.error("billing", "checkout failed", error); // also reported, when tracking is on
```

In production each line is one JSON object, which Docker, Dokploy, Coolify,
journald and any log shipper read as it is:

```json
{"time":"2026-11-03T09:12:44.120Z","level":"error","scope":"billing","msg":"checkout failed","error":{"name":"Error","message":"connect ECONNREFUSED","stack":"…"}}
```

In development the same call prints `[billing] checkout failed` with the
error beside it.

| Variable | Values | Default |
|---|---|---|
| `LOG_FORMAT` | `json`, `pretty` | `json` in production, `pretty` otherwise |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |

Reading them on a server:

```bash
docker compose logs app --since 1h | grep '"level":"error"'
docker compose logs app --since 1h | jq -R 'fromjson? | select(.level=="error") | {time, scope, msg, error: .error.message}'
```

**What never goes in a log line:** request bodies, cookies, tokens,
passwords, or anything a webhook carried. A person's id is fine, and so is an
email address when the line is about that address (a send that failed).

## Error tracking

Set `ERROR_TRACKING_DSN` to a DSN from any service that speaks Sentry's
protocol, and every server error is sent there with its stack, grouped and
counted, with an email when a new one appears. OpenShipKit sends the events
itself over HTTPS (`src/server/error-reporting.ts`), without a vendor SDK.

```bash
ERROR_TRACKING_DSN=https://<key>@errors.example.com/<project id>
ERROR_TRACKING_ENVIRONMENT=production   # optional; default NODE_ENV
```

Two paths report:

- **`log.error()`**: everything the code catches and logs as an error: a
  failed checkout, an email that couldn't be sent, a server action's
  unexpected failure.
- **Next.js's `onRequestError`** (`src/instrumentation.ts`): anything nothing
  caught, in a page, route handler, server action or the proxy, with the
  route it happened on.

### What an event carries, and what it doesn't

| Sent | Never sent |
|---|---|
| The scope and message | Request headers and cookies |
| The error's type, message and stack frames | Request or webhook bodies |
| The route (`/dashboard/billing`), method and path | The query string (reset and verification tokens travel there) |
| The environment | Who was signed in, their email, their IP address |
| A failed query's SQL | The query's parameter values |

That last row matters more than it looks. drizzle-orm puts a failed query's
parameters in the error message, and during a database blip those are session
tokens, reset identifiers and emails. `src/server/scrub.ts` cuts them from
every message, stack and cause before anything is logged or sent, in both log
formats. A message still holds whatever the code wrote into it, which is why the
rule above keeps secrets out of log lines.

### It can't take the site down with it

- Reporting runs in the background for `log.error` and gives up after three
  seconds. A slow or unreachable tracker never delays a response.
- At most 30 events a minute per process, and the same failure (scope,
  route, message and error) at most once a minute. An outage that fails every
  request would otherwise spend the tracker's quota in minutes, and one bad row
  failing on every render would crowd out everything else. The log still has
  every line.
- A failure to report is one line in the log, never a report about a report.

### Running your own tracker

[GlitchTip](https://glitchtip.com) is open source, accepts Sentry DSNs and
runs on the same kind of server as OpenShipKit (it needs its own Postgres
database). Install it with its own guide, ideally on a different machine
from the app, because a tracker on the same machine goes down with it. Then:

1. Create an organisation and a project (platform: Node.js).
2. Copy the project's DSN into `ERROR_TRACKING_DSN` in the app's environment.
3. Restart the app, then check one arrives: request a page that throws on a
   staging copy, or watch the next real error.

Sentry's hosted service works the same way with its DSN. That adds a third
party, so the privacy page should say so (AGENTS.md, rule 15).

## Health

| Endpoint | Answers | Point at it |
|---|---|---|
| `/api/health` | 200 when the database answers, 503 when it doesn't | Uptime monitors and load balancers (readiness) |
| `/api/health/live` | 200 whenever the process can answer, without touching the database | Restart policies (liveness): a database blip shouldn't restart a healthy app |

`/api/health` also reports `"schema": {"ok": …, "state": "current" | "behind" | "ahead"}`:
whether the database has every migration this build expects (the newest entry in
`drizzle/meta/_journal.json`). **Behind** is a 503: a deploy skipped
`npm run db:migrate`, and queries for new columns would fail, so a load balancer
should hold traffic until it runs. **Ahead** (older code on a newer database,
during a rollback) is reported but serves. **Unknown** is a 503 too: the database
answers but its migrations table can't be read (a missing grant, a half-made
database), so nobody can say the schema is current.

It also reports `"jobs": {"ok": false}` when a due background job
has waited more than five minutes, because the runner is stopped, stuck or
behind ([background jobs](jobs.md)). That doesn't change the status code. Add a
keyword monitor for `"jobs":{"ok":true` to hear about it. The endpoint is public
and never says how many of anything.
