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
- **Whose limits:** the customer's plan (`usageSubject(user)`). That's the
  person's own, or, with teams on (`OPENSHIPKIT_TENANCY=org`), the plan of the
  organisation they're working in, unless the organisation has no plan and the
  person has one of their own: then the person's. (`requirePlan` lets either
  plan through; for limits and metered billing one plan has to win, and the
  team's does when it has one.) The billing page shows the same customer's
  usage. With no paid plan, the **free plan's** limits apply: the
  active plan with no paid price that isn't "contact sales", first by sort
  order. With no free plan, nothing is limited.
- **Outside the browser** (an API request authenticated by a key) there is no
  "current organisation": pass it, `usageSubject(user, { orgId })`. It must be
  one of the person's organisations.
- **`seats`** is special: with teams on, it caps a team's members plus open
  invitations, unless the team pays per seat, in which case the seats bought are
  the cap ([teams.md](teams.md)).

Changing a plan's limits changes what customers get, so like prices and trials
it needs an admin MCP key, and so does anything that changes **which** plan is
the free plan (hiding it, re-sorting it, adding a priceless plan before it). An
undo through `audit_restore` is held to the same rules.

## Two kinds of limit

**A count** is something the app already has rows for, like projects. You pass
how many exist now:

```ts
import { requireWithinLimit, usageSubject } from "@/server/services/usage";

const subject = await usageSubject(user); // the person, or their organisation with teams on
await requireWithinLimit(subject, "projects", { current: await countProjects(subject) });
await createProject(...);
```

**Metered usage** is events you record, summed over the current period. Check
and record in one atomic step:

```ts
await consumeUsage(subject, "api_calls", 1, { key: requestId });   // refuses past the limit
const result = await doTheWork();
```

or in two steps, recording after the work:

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
- `recordUsage` never refuses on a limit. Check first, or use `consumeUsage`.
- **`key` makes recording idempotent, per metric.** Pass the request's or the
  job's id, and a retry records nothing. One request may use the same id for
  two metrics (`api_calls` and `tokens`); each is its own event. The same key
  again with a different quantity is refused (`reason: "key_reused"`): that's a
  bug in the caller, not a retry. Without a key, every call counts.

`consumeUsage` holds the limit exactly **as long as every write of that metric
goes through it**: concurrent consumes for one customer's metric queue on a
database lock, so ten requests at 9,999 of 10,000 let one through. A
`recordUsage` of the same metric doesn't take the lock and can land between a
consume's check and its write. The two-step form can let both of two
simultaneous requests through at 9,999. For most quotas that's fine; where one
unit over costs money, consume everywhere.

Each consume sums the period's events for that customer and metric while it
holds the lock. That's quick for thousands of events a period and fine into
the hundreds of thousands; around a million events per customer per month it
costs tens of milliseconds a call, serialised per customer. Past that, keep a
running counter instead (one row per customer, metric and period, updated in
the same transaction).

## The period

Metered usage resets monthly:

- **On a subscription:** the subscription's own billing period, as the
  provider reports it (31 January to 28 February to 31 March, for one that
  renews on the 31st). Where the provider hasn't given the period's start yet,
  a month back from the renewal. A yearly plan's quota resets monthly too, on
  the same day of the month.
- **On the free plan or a lifetime purchase:** on the 1st of the month (UTC).

A quota meant per year is a count the app keeps itself.

## Where customers and you see it

- **`/dashboard/billing`** has a Usage card: each limited or recorded metric
  this period ("7 of 100 this period", with a meter), and when it resets. For a
  count the app keeps (projects), it shows the limit only ("Up to 3"). A team's
  seats show the seats in use against what it bought or its plan allows.
- **MCP:** `usage_get { user }` or `usage_get { orgId }` (admin key) returns the
  same summary for one customer.

## Charging for usage (metered prices)

To bill for usage, rather than only limit it, list the metrics to report:

```bash
BILLING_METERED_METRICS=api_calls,tokens
```

Each recorded event of those metrics is stored as **pending**, and a
`usage.report` background job ([jobs.md](jobs.md)) sends the stored event (never
the caller's arguments) to the provider's meter, then marks it reported. That's
an outbox:

- An event already reported is never sent again: not when the caller repeats
  `recordUsage` with the same key, not when a job is retried by hand.
- Every five minutes the job runner re-queues events still pending from the last
  day (leaving out those already queued), so a crash between recording and
  queueing loses nothing. Events still unsent after a day are logged as an
  error; their failed jobs in `/admin/jobs` say why.
- Billing off, or unable to meter, where the job runs (a worker started without
  the provider's key) is an error, not a skip: the event stays pending and is
  sent once billing is back.
- The one window left, a crash after the provider accepted the event and before
  it was marked, resends the same event id, which the provider drops as a
  duplicate (Polar `external_id`; Stripe `identifier`, within its 24 hours,
  well inside the job's three hours of retries).

| Provider | Set up on its side |
|---|---|
| **Polar** | A meter with a filter `name equals api_calls` and the aggregation **sum** over the property `quantity`. Then a product with a metered price on that meter. |
| **Stripe** | A meter with the event name `api_calls`, aggregation **sum**, and the default payload keys (`stripe_customer_id`, `value`). Then a price with usage-based billing on that meter. |
| **Razorpay** | No meters. Usage is counted and limited here only (the server warns at boot if `BILLING_METERED_METRICS` is set). |

Whose customer is charged: the person's own billing customer, or for an
organisation, the customer of the subscription that gives it access (one set to
cancel still has its last period billed). An account with no billing customer
(free, never bought) has nothing to bill: the event is settled without sending
anything.

A metered price and a limit go together fine. A limit on a metered metric is a
safety cap ("bill per call, but never more than 100,000 a month"). With no limit,
usage is unlimited and billed.

## Storage

Usage events are rows in `usage_events`: who (a user or an organisation), the
metric, the quantity, when, the optional idempotency key (unique per customer
and metric), and its report state (pending, sent, or settled with nobody to
bill). They're append-only: nothing deletes them, so the table grows with your
traffic. At very high volume (millions of events a day), record a
pre-aggregated count every minute instead of one row per request.
