import "server-only";

//
// The in-process bulkhead: at most AI_MAX_CONCURRENT_REQUESTS generations in
// flight in this process, AI_MAX_CONCURRENT_REQUESTS_PER_USER per person.
//
// AI calls are slow next to everything else the app does. A few stuck upstream
// requests must not turn the server into a queue of held sockets and database
// connections, and refusing here costs nothing — so it is the first step of
// the guard chain (./guard.ts), and under a stampede the others never run.
//
// Per PROCESS on purpose: its job is protecting this process's sockets, so it
// multiplies with replicas and should. (The per-minute limit and the daily
// quota are the per-person spend controls; they don't.)
//
// The counters live on globalThis: dev hot reloads re-evaluate this module, and
// a fresh counter would let in-flight requests' releases drive it negative.
//

export class AiBusyError extends Error {
  readonly retryAfterSeconds = 2;
  constructor() {
    super("AI is busy right now. Try again in a moment.");
    this.name = "AiBusyError";
  }
}

type State = { total: number; byUser: Map<string, number> };
const g = globalThis as unknown as { __openshipkitAiConcurrency?: State };

function state(): State {
  return (g.__openshipkitAiConcurrency ??= { total: 0, byUser: new Map() });
}

/** In flight right now (for tests and a health line). */
export function aiInFlight(userId?: string): number {
  const s = state();
  return userId ? (s.byUser.get(userId) ?? 0) : s.total;
}

/**
 * Take a slot or throw AiBusyError. The returned function gives it back and is
 * safe to call twice: callers release from a `finally`, and a double release
 * would otherwise drift the counter below zero and quietly raise the ceiling.
 */
export function acquireAiSlot(userId: string, maxTotal: number, maxPerUser: number): () => void {
  const s = state();
  const mine = s.byUser.get(userId) ?? 0;
  if (s.total >= maxTotal || mine >= maxPerUser) throw new AiBusyError();
  s.total += 1;
  s.byUser.set(userId, mine + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const now = state();
    now.total = Math.max(0, now.total - 1);
    const left = (now.byUser.get(userId) ?? 1) - 1;
    // Delete rather than keep a zero: one entry per person who ever asked is a slow leak.
    if (left <= 0) now.byUser.delete(userId);
    else now.byUser.set(userId, left);
  };
}
