//
// The usage-billed API example's store: customers' API keys, their contract
// and the memory implementation (./store-postgres.ts over ./migration.sql).
//
//  - Only a key's SHA-256 is stored; the key itself is shown once, at minting.
//  - Every read and revoke by a person takes their userId and filters inside
//    the query. findActiveByHash is the one lookup without it: it is how a
//    request's key becomes a person.
//
// Pure: no server-only, no I/O.
//

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  /** The key's first characters, to tell keys apart in a list ("uk_3fA9…"). */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyStore {
  create(input: { userId: string; name: string; prefix: string; hash: string }): Promise<ApiKey>;
  /** Newest first, revoked ones included. */
  list(userId: string): Promise<ApiKey[]>;
  /** The live key with this hash, if any. */
  findActiveByHash(hash: string): Promise<ApiKey | null>;
  /** True when it was live and is now revoked. */
  revoke(userId: string, id: string): Promise<boolean>;
  touch(id: string, at: string): Promise<void>;
  /**
   * Claim an Idempotency-Key for this API key: a new row (claimed: true) unless one younger than
   * `since` exists, which comes back as it is (claimed: false). An older one is replaced: keys last
   * for the window, then mean a new request.
   */
  claimRequest(input: { apiKeyId: string; key: string; bodyHash: string; since: string }): Promise<{ claimed: boolean; request: ApiRequest }>;
  /** The answer to replay for a claimed request. */
  saveResponse(requestId: string, response: unknown): Promise<void>;
  /** Give a claim back when the request failed before it was answered (it may be retried). */
  releaseRequest(requestId: string): Promise<void>;
}

export interface ApiRequest {
  id: string;
  apiKeyId: string;
  key: string;
  bodyHash: string;
  /** Null while the first request is still being answered. */
  response: unknown;
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export function createMemoryApiKeyStore(): ApiKeyStore {
  const rows = new Map<string, ApiKey & { hash: string }>();
  const requests = new Map<string, ApiRequest>();
  const pub = ({ hash: _h, ...k }: ApiKey & { hash: string }): ApiKey => ({ ...k }); // eslint-disable-line @typescript-eslint/no-unused-vars
  let seq = 0;
  return {
    async create({ userId, name, prefix, hash }) {
      if ([...rows.values()].some((r) => r.hash === hash)) throw new Error("duplicate key hash");
      const row = { id: crypto.randomUUID(), userId, name, prefix, hash, createdAt: new Date(Date.now() + seq++).toISOString(), lastUsedAt: null, revokedAt: null };
      rows.set(row.id, row);
      return pub(row);
    },
    async list(userId) {
      return [...rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(pub);
    },
    async findActiveByHash(hash) {
      const r = [...rows.values()].find((x) => x.hash === hash && !x.revokedAt);
      return r ? pub(r) : null;
    },
    async revoke(userId, id) {
      const r = isUuid(id) ? rows.get(id) : undefined;
      if (!r || r.userId !== userId || r.revokedAt) return false;
      r.revokedAt = new Date().toISOString();
      return true;
    },
    async touch(id, at) {
      const r = rows.get(id);
      if (r) r.lastUsedAt = at;
    },
    async claimRequest({ apiKeyId, key, bodyHash, since }) {
      const id = `${apiKeyId}:${key}`;
      const seen = requests.get(id);
      if (seen && seen.createdAt >= new Date(since).toISOString()) return { claimed: false, request: { ...seen } };
      const request: ApiRequest = { id: crypto.randomUUID(), apiKeyId, key, bodyHash, response: null, createdAt: new Date().toISOString() };
      requests.set(id, request);
      return { claimed: true, request: { ...request } };
    },
    async saveResponse(requestId, response) {
      for (const r of requests.values()) if (r.id === requestId) r.response = response;
    },
    async releaseRequest(requestId) {
      for (const [k, r] of requests) if (r.id === requestId && r.response === null) requests.delete(k);
    },
  };
}
