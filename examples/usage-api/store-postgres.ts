import "server-only";

//
// The API key store on Postgres: the table from ./migration.sql, through the
// app's Drizzle client, in raw SQL (drizzle-kit never sees the table).
//

import { sql } from "drizzle-orm";
import { getDrizzle, type Db } from "@/adapters/data/postgres/db";
import { isUuid, type ApiKey, type ApiKeyStore, type ApiRequest } from "./store";

type Row = { id: string; user_id: string; name: string; prefix: string; created_at: Date | string; last_used_at: Date | string | null; revoked_at: Date | string | null };

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
const toKey = (r: Row): ApiKey => ({ id: r.id, userId: r.user_id, name: r.name, prefix: r.prefix, createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at), revokedAt: iso(r.revoked_at) });
const COLUMNS = sql`id, user_id, name, prefix, created_at, last_used_at, revoked_at`;

type ReqRow = { id: string; api_key_id: string; idempotency_key: string; body_hash: string; response: unknown; created_at: Date | string };
const toRequest = (r: ReqRow): ApiRequest => ({ id: r.id, apiKeyId: r.api_key_id, key: r.idempotency_key, bodyHash: r.body_hash, response: r.response ?? null, createdAt: iso(r.created_at)! });

export function createPostgresApiKeyStore(opts: { db?: Db } = {}): ApiKeyStore {
  const db = () => opts.db ?? getDrizzle();
  return {
    async create({ userId, name, prefix, hash }) {
      const r = await db().execute<Row>(sql`insert into example_api_keys (user_id, name, prefix, key_hash) values (${userId}, ${name}, ${prefix}, ${hash}) returning ${COLUMNS}`);
      return toKey(r.rows[0]);
    },
    async list(userId) {
      if (!isUuid(userId)) return [];
      const r = await db().execute<Row>(sql`select ${COLUMNS} from example_api_keys where user_id = ${userId} order by created_at desc, id desc`);
      return r.rows.map(toKey);
    },
    async findActiveByHash(hash) {
      const r = await db().execute<Row>(sql`select ${COLUMNS} from example_api_keys where key_hash = ${hash} and revoked_at is null`);
      return r.rows[0] ? toKey(r.rows[0]) : null;
    },
    async revoke(userId, id) {
      if (!isUuid(userId) || !isUuid(id)) return false;
      const r = await db().execute<{ id: string }>(sql`update example_api_keys set revoked_at = now() where user_id = ${userId} and id = ${id} and revoked_at is null returning id`);
      return r.rows.length > 0;
    },
    async touch(id, at) {
      if (!isUuid(id)) return;
      await db().execute(sql`update example_api_keys set last_used_at = ${at} where id = ${id}`);
    },
    async claimRequest({ apiKeyId, key, bodyHash, windowMs, leaseMs }) {
      const window = sql`now() - make_interval(secs => ${windowMs / 1000})`;
      const lease = sql`now() - make_interval(secs => ${leaseMs / 1000})`;
      // A release can delete the row between the two statements: then claim again (bounded).
      for (let attempt = 0; attempt < 3; attempt++) {
        // One statement, on the database's clock: insert; or replace a row older than the window (a new
        // id); or take back an unanswered one with the same body whose lease is over (the SAME id).
        const claimed = await db().execute<ReqRow>(sql`
          insert into example_api_requests (api_key_id, idempotency_key, body_hash)
          values (${apiKeyId}, ${key}, ${bodyHash})
          on conflict (api_key_id, idempotency_key) do update set
            id = case when example_api_requests.created_at < ${window} then gen_random_uuid() else example_api_requests.id end,
            body_hash = excluded.body_hash,
            response = case when example_api_requests.created_at < ${window} then null else example_api_requests.response end,
            created_at = case when example_api_requests.created_at < ${window} then now() else example_api_requests.created_at end,
            locked_at = now()
          where example_api_requests.created_at < ${window}
             or (example_api_requests.response is null and example_api_requests.body_hash = excluded.body_hash and example_api_requests.locked_at < ${lease})
          returning *`);
        if (claimed.rows[0]) return { claimed: true, request: toRequest(claimed.rows[0]) };
        const seen = await db().execute<ReqRow>(sql`select * from example_api_requests where api_key_id = ${apiKeyId} and idempotency_key = ${key}`);
        if (seen.rows[0]) return { claimed: false, request: toRequest(seen.rows[0]) };
      }
      throw new Error("Couldn't claim the Idempotency-Key (it kept being released); retry the request.");
    },
    async saveResponse(requestId, response) {
      if (!isUuid(requestId)) return;
      await db().execute(sql`update example_api_requests set response = ${JSON.stringify(response)}::jsonb where id = ${requestId}`);
    },
    async releaseRequest(requestId) {
      if (!isUuid(requestId)) return;
      await db().execute(sql`delete from example_api_requests where id = ${requestId} and response is null`);
    },
    async pruneRequests(apiKeyId, windowMs) {
      if (!isUuid(apiKeyId)) return 0;
      const r = await db().execute<{ id: string }>(
        sql`delete from example_api_requests where api_key_id = ${apiKeyId} and created_at < now() - make_interval(secs => ${windowMs / 1000}) returning id`,
      );
      return r.rows.length;
    },
  };
}
