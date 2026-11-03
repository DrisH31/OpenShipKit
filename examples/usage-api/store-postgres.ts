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
    async claimRequest({ apiKeyId, key, bodyHash, since }) {
      // One statement: insert, or replace a row older than the window; a younger one stays and is read.
      const claimed = await db().execute<ReqRow>(sql`
        insert into example_api_requests (api_key_id, idempotency_key, body_hash)
        values (${apiKeyId}, ${key}, ${bodyHash})
        on conflict (api_key_id, idempotency_key) do update
          set id = gen_random_uuid(), body_hash = excluded.body_hash, response = null, created_at = now()
          where example_api_requests.created_at < ${since}
        returning *`);
      if (claimed.rows[0]) return { claimed: true, request: toRequest(claimed.rows[0]) };
      const seen = await db().execute<ReqRow>(sql`select * from example_api_requests where api_key_id = ${apiKeyId} and idempotency_key = ${key}`);
      return { claimed: false, request: toRequest(seen.rows[0]) };
    },
    async saveResponse(requestId, response) {
      if (!isUuid(requestId)) return;
      await db().execute(sql`update example_api_requests set response = ${JSON.stringify(response)}::jsonb where id = ${requestId}`);
    },
    async releaseRequest(requestId) {
      if (!isUuid(requestId)) return;
      await db().execute(sql`delete from example_api_requests where id = ${requestId} and response is null`);
    },
  };
}
