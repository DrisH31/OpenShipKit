# Usage and limits

A plan can limit how much of something a customer gets: 3 projects, 10,000 API
calls a month, 5 seats. The app counts usage in its own Postgres and checks the
limit before the work. With Polar or Stripe it can also report usage to a
metered price, so customers are charged for what they use.

Nothing here is on until you declare a limit or record usage. With no limits on
any plan, nothing is limited.

## Declaring limits

Limits live on the plan, in `/admin/plans/<key>` (the **Limits** rows) or
through MCP (`plan_update { key, limits }`, which needs an admin key):

```json
{ "api_calls": 10000, "projects": 3, "seats": 5 }
```

- A metric's name is lower-case words joined by underscores: `api_calls`, not
  `API calls`.
- A metric the plan doesn't list is **unlimited** on that plan.
- **Whose limits:** the customer's plan. That's the person's own, or, with teams
  on (`OPENSHIPKIT_TENANCY=org`), the plan of the organisation they're working
  in. With no paid plan, the **free plan's** limits apply: the active plan with
  no paid price, first by sort order. With no free plan, nothing is limited.
- **`seats`** is special: with teams on, it caps a team's members plus open
  invitations, unless the team pays per seat, in which case the seats bought are
  the cap ([teams.md](teams.md)).

Changing a plan's limits changes what customers get, so like prices and trials
it needs an admin MCP key, and an undo through `audit_restore` is held to the
same rule.

## Two kinds of limit

**A count** is something the app already has rows for, like projects. You pass
how many exist now:

```ts
import { requireWithinLimit, usageSubject } from "@/server/services/usage";

const subject = await usageSubject(user); // the person, or their organisation with teams on
await requireWithinLimit(subject, "projects", { current: await countProjects(subject) });
await createProject(...);
```

**Metered usage** is events you record, summed over the current period:

```ts
await requireWithinLimit(subject, "api_calls");                    // before the work
const result = await doTheWork();
await recordUsage(subject, "api_calls", 1, { key: requestId });     // after it
```

- `requireWithinLimit` throws `ServiceError("conflict")` with
  `details.reason === "limit_reached"` (and `metric`, `limit`, `used`). Its
  message is written for the customer: "Your plan allows 10000 api calls a
  month, and that's used up. Upgrade for more."
- `checkLimit` answers the same question without throwing, for a page that
  shows a disabled button instead.
- `adding` (default 1) checks a batch: `{ adding: 50 }` before importing 50 rows.
- `recordUsage` never refuses on a limit. Check first.
- **`key` makes recording idempotent.** Pass the request's or the job's id, and
  a retry records nothing. Without a key, every call counts.

The check and the record are separate calls, so two requests at the same moment
can both pass a check at 9,999 of 10,000. For quotas that's the usual trade-off.
If one unit over would cost you real money, put the check and the work in a
critical section of your own.

## The period

Metered usage resets monthly:

- **On a subscription:** on the renewal day. A plan renewing on the 20th counts
  from the 20th to the 20th, and the 31st becomes the last day of a shorter
  month. A yearly plan's quota resets monthly too, on the same day of the month.
- **On the free plan or a lifetime purchase:** on the 1st of the month (UTC).

A quota meant per year is a count the app keeps itself.

## Where customers and you see it

- **`/dashboard/billing`** has a Usage card: each limited or recorded metric
  this period ("7 of 100", with a meter), and when it resets. For a count, it
  shows the limit only ("Up to 3"), because the app keeps that count, not the
  usage table.
- **MCP:** `usage_get { user }` or `usage_get { orgId }` (admin key) returns the
  same summary for one customer.

## Charging for usage (metered prices)

To bill for usage, rather than only limit it, list the metrics to report:

```bash
BILLING_METERED_METRICS=api_calls,tokens
```

Each recorded event of those metrics queues a `usage.report` background job
([jobs.md](jobs.md)), which sends it to the provider's meter for the customer.
Every event carries our event id, so a retried job is a duplicate the provider
drops, never a second charge.

| Provider | Set up on its side |
|---|---|
| **Polar** | A meter with a filter `name equals api_calls` and the aggregation **sum** over the property `quantity`. Then a product with a metered price on that meter. |
| **Stripe** | A meter with the event name `api_calls`, aggregation **sum**, and the default payload keys (`stripe_customer_id`, `value`). Then a price with usage-based billing on that meter. |
| **Razorpay** | No meters. Usage is counted and limited here only (the server warns at boot if `BILLING_METERED_METRICS` is set). |

Whose customer is charged: the person's own billing customer, or for an
organisation, the customer paying its renewing subscription. An account with no
billing customer (free, never bought) has nothing to bill: the job ends without
sending anything.

A metered price and a limit go together fine. A limit on a metered metric is a
safety cap ("bill per call, but never more than 100,000 a month"). With no limit,
usage is unlimited and billed.

## Storage

Usage events are rows in `usage_events`: who (a user or an organisation), the
metric, the quantity, when, and the optional idempotency key, unique per
customer. They're append-only. Nothing deletes them, so the table grows with
your traffic. At very high volume (millions of events a day), record a
pre-aggregated count every minute instead of one row per request.
