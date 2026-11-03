# Example: a usage-billed API

Your customers call your API with keys they mint themselves. Every call is
counted against their plan, refused past it, and, with a metered price,
billed. Built on the kit's own pieces; read it as the shape of an API product.

- **Customer API keys.** Minted by a signed-in person (`POST /api/api-keys`),
  shown once, stored only as a SHA-256, revocable, and dead the moment the
  person is banned.
- **Metering that holds the limit exactly.** Each call is one
  `consumeUsage(subject, "api_calls", 1)`: the plan's `api_calls` limit is
  checked and the call recorded in one atomic step, so ten requests at the
  last unit let exactly one through (the rest get 429).
- **Idempotency the way Stripe does it.** An `Idempotency-Key` is kept per API
  key for 24 hours: the same key and body replay the first answer (with
  `Idempotent-Replayed: true`; no work, no charge), the same key with another
  body is 422, and one still being answered is 409. A key can never buy new
  work for free.
- **Whose plan:** the person's (keys belong to a person). For a team API, mint
  keys per organisation and meter `{ type: "org" }` instead.
- **Billing for usage, with nothing provider-specific here.** Set
  `BILLING_METERED_METRICS=api_calls` with Polar or Stripe, create the meter
  (docs/usage.md, "Charging for usage"), and every counted call is reported by
  the kit's outbox: retried, never twice, expired past the provider's window.
- **The write path.** The demo guard, zod, the store, the audit log
  (`example_api_key.create`, `example_api_key.revoke`; never the key itself).

The API's work is a stand-in (`runWork()` shouts the text back): replace it.

## Files

| File | What |
|---|---|
| `service.ts` | `mintApiKey`, `listApiKeys`, `revokeApiKey`, `authenticateApiKey`, `callApi` |
| `store.ts`, `store-postgres.ts` | the key store: contract, memory, Postgres |
| `migration.sql` | the `example_api_keys` and `example_api_requests` (idempotency) tables |
| `routes/call.ts` | `POST /api/v1/shout`, authenticated by `Authorization: Bearer uk_…` |
| `routes/keys.ts`, `routes/key.ts` | `GET`/`POST /api/api-keys`, `DELETE /api/api-keys/:id` (the session) |

## Enable

1. Apply the table as a Drizzle custom migration, with `npm run dev` stopped:

   ```bash
   npm run db:generate -- --custom --name example_api_keys
   # paste migration.sql into the new file, then
   npm run db:migrate
   ```

2. Mount the three routes (the comment at the top of each has its lines).
3. Add them to `ROUTES` in `tests/authz.test.ts` (`call.ts` is public with
   the reason "authenticated by its own API key"; the key routes use `apiUser`)
   and to `ENDPOINTS` in `src/server/api-reference.ts`, then `npm run docs:api`.
4. Give your plans an `api_calls` limit in `/admin/plans` (a metric that isn't
   listed is unlimited).
5. To charge for it: a metered price at your provider and
   `BILLING_METERED_METRICS=api_calls`. The Usage card on `/dashboard/billing`
   shows each customer where they are.
6. A page for the keys: list them (`listApiKeys`) and mint one in a server
   action that shows the key once. `/admin/agents` is the pattern.

## Calling it

```bash
curl -X POST https://example.com/api/v1/shout \
  -H "Authorization: Bearer uk_…" -H "Idempotency-Key: $(uuidgen)" \
  -H "content-type: application/json" -d '{"text":"hello"}'
# {"result":"HELLO","usage":{"used":1,"limit":1000}}
```

## Remove

Delete `examples/usage-api/`, its mounted routes and their entries, and drop
the table in a new migration.
