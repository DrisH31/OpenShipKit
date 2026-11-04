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
   * Claim an Idempotency-Key for this API key, within a window of `windowMs`:
   *   - none, or one older than the window: a new request (claimed, a new id);
   *   - unanswered, same body, its lease (`leaseMs`) over: taken back WITH THE SAME ID (claimed), so
   *     whatever it already counted is deduplicated by that id;
   *   - anything else comes back as it is (not claimed): answered, still leased, or another body.
   * Times are the database's own clock.
   */
  claimRequest(input: { apiKeyId: string; key: string; bodyHash: string; windowMs: number; leaseMs: number }): Promise<{ claimed: boolean; request: ApiRequest }>;
  /** The answer to replay for a claimed request. */
  saveResponse(requestId: string, response: unknown): Promise<void>;
  /** Keep an unanswered claim's lease while its work runs. */
  renewLease(requestId: string): Promise<void>;
  /** Give back a claim that counted nothing (refused before any work), so a retry is a fresh request. */
  releaseRequest(requestId: string): Promise<void>;
  /** Delete this API key's requests older than the window. Returns how many. */
  pruneRequests(apiKeyId: string, windowMs: number): Promise<number>;
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
  const lockedAt = new Map<string, string>();
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
    async claimRequest({ apiKeyId, key, bodyHash, windowMs, leaseMs }) {
      const id = `${apiKeyId}:${key}`;
      const seen = requests.get(id);
      const now = Date.now();
      if (seen && Date.parse(seen.createdAt) > now - windowMs) {
        const lapsed = seen.response === null && seen.bodyHash === bodyHash && Date.parse(lockedAt.get(seen.id) ?? seen.createdAt) <= now - leaseMs;
        if (!lapsed) return { claimed: false, request: { ...seen } };
        lockedAt.set(seen.id, new Date(now).toISOString());
        return { claimed: true, request: { ...seen } };
      }
      const request: ApiRequest = { id: crypto.randomUUID(), apiKeyId, key, bodyHash, response: null, createdAt: new Date(now).toISOString() };
      requests.set(id, request);
      lockedAt.set(request.id, request.createdAt);
      return { claimed: true, request: { ...request } };
    },
    async saveResponse(requestId, response) {
      for (const r of requests.values()) if (r.id === requestId) r.response = response;
    },
    async renewLease(requestId) {
      if (lockedAt.has(requestId)) lockedAt.set(requestId, new Date().toISOString());
    },
    async releaseRequest(requestId) {
      for (const [k, r] of requests) if (r.id === requestId && r.response === null) requests.delete(k);
    },
    async pruneRequests(apiKeyId, windowMs) {
      let n = 0;
      for (const [k, r] of requests) {
        if (r.apiKeyId === apiKeyId && Date.parse(r.createdAt) <= Date.now() - windowMs) {
          requests.delete(k);
          n++;
        }
      }
      return n;
    },
  };
}
