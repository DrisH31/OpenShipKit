# examples — apps built on the kit

Two small, complete features on top of OpenShipKit, written the way the kit
writes its own (services, a store contract with memory and Postgres adapters,
SQL migrations, audited writes). They are typechecked and tested by
`npm run check` (`npm run typecheck:modules`, `tests/examples/`), so they stay
true to the current code, and the app imports neither until you enable one.

| Example | What it shows |
|---|---|
| [`projects/`](projects/README.md) | A B2B tool: a team's projects, with roles, membership checks and a plan's `projects` limit |
| [`usage-api/`](usage-api/README.md) | An API product: customer API keys, every call metered against the plan atomically and idempotently, billed through a metered price |

Each README lists its files, how to enable it (apply the SQL, mount the
routes, register them in the authz test and the API reference) and how to
remove it. Opt-in capability (AI, document search, Redis) is in
[`modules/`](../modules/README.md) instead.
