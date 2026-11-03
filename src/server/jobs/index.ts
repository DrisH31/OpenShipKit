import "server-only";

//
// Background jobs in the app's own Postgres (ROADMAP 1.6): no Redis, no
// worker service. Every app process runs a small runner (started by
// src/instrumentation.ts) that claims due jobs with FOR UPDATE SKIP LOCKED,
// so two processes never run the same job, and runs them.
//
//   await enqueueJob(emailJob, message)                   // run as soon as a runner polls
//   await enqueueJob(reportJob, input, { key: "daily" })  // at most one unfinished per key
//
// Guarantees, and their limits:
//  - At least once. A claim is a lease (LEASE_MS). If the process dies, the
//    job is due again when the lease ends. A job therefore has to be safe to
//    run twice (an email may arrive twice; a payment must check before acting).
//  - A failed attempt retries with exponential backoff (backoffMs) until the
//    definition's maxAttempts, then stays `failed` for a person to look at and
//    retry (retryFailedJob, /admin/jobs, MCP jobs_retry).
//  - An attempt that runs past JOB_TIMEOUT_MS counts as failed. JavaScript can't
//    stop the work itself, so the lease is longer than the timeout and a slow job
//    isn't taken over while it still runs.
//  - Finished jobs are pruned after RETENTION_DAYS. A sensitive job's payload is
//    deleted as soon as it can no longer run (./define.ts).
//
// Job rows are operational state, like rate-limit counters: they aren't
// audited. A person retrying a job is (retryFailedJob).
//
// JOBS_RUNNER=off stops this process from running jobs (enqueueing still
// works), for a deployment that wants a dedicated worker or none on some replicas.
//

import type { Actor, Job, JobCounts, JobStatus, ListQuery, Page } from "@/core/types";
import { getData } from "../data";
import { assertNotDemo } from "../demo";
import { optionalEnv } from "../env";
import { log } from "../log";
import { recordAudit } from "../services/audit";
import { ServiceError } from "../services/errors";
import { PermanentJobError, type JobDefinition } from "./define";
import { JOB_DEFINITIONS } from "./definitions";

export const LEASE_MS = 5 * 60_000;
export const JOB_TIMEOUT_MS = 2 * 60_000;
const BATCH = 5;
const POLL_IDLE_MS = 5_000;
const POLL_ERROR_MS = 30_000;
const PRUNE_EVERY_MS = 60 * 60_000;
export const RETENTION_DAYS = 14;
const DEFAULT_MAX_ATTEMPTS = 5;

/** Wait before the next attempt after `attempts` failures: 30 s doubling to at most an hour, ±20 %. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
  return Math.round(base * (0.8 + 0.4 * random()));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a heterogeneous list; each definition checks its own payload
type AnyDefinition = JobDefinition<any>;

function byKind(definitions: readonly AnyDefinition[]): Map<string, AnyDefinition> {
  return new Map(definitions.map((d) => [d.kind, d]));
}

/** Queue a job. The payload is validated now, so a bad one fails at the caller rather than in the background. */
export async function enqueueJob<T>(
  definition: JobDefinition<T>,
  payload: T,
  options: { runAt?: Date; key?: string } = {},
): Promise<{ job: Job; created: boolean }> {
  const parsed = definition.schema.safeParse(payload);
  if (!parsed.success) throw new Error(`Job ${definition.kind}: invalid payload (${parsed.error.issues.map((i) => i.message).join("; ")})`);
  return (await getData()).jobs.enqueue({
    kind: definition.kind,
    payload: parsed.data,
    maxAttempts: definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    runAt: options.runAt?.toISOString(),
    key: options.key ?? null,
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export type RunSummary = { claimed: number; succeeded: number; retrying: number; failed: number; stale: number };

/** Claims up to `limit` due jobs and runs them. One runner tick; exported for tests and scripts. */
export async function runDueJobs(
  options: { definitions?: readonly AnyDefinition[]; limit?: number; timeoutMs?: number; now?: () => number } = {},
): Promise<RunSummary> {
  const definitions = byKind(options.definitions ?? JOB_DEFINITIONS);
  const now = options.now ?? Date.now;
  const store = (await getData()).jobs;
  const claimed = await store.claim({ limit: options.limit ?? BATCH, leaseMs: LEASE_MS });
  const summary: RunSummary = { claimed: claimed.length, succeeded: 0, retrying: 0, failed: 0, stale: 0 };

  await Promise.all(
    claimed.map(async (job) => {
      const definition = definitions.get(job.kind);
      const sensitive = definition?.sensitive === true;
      try {
        if (!definition) throw new PermanentJobError(`no job is defined for kind "${job.kind}"`);
        const parsed = definition.schema.safeParse(job.payload);
        if (!parsed.success) throw new PermanentJobError(`invalid payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
        await withTimeout(definition.run(parsed.data), options.timeoutMs ?? JOB_TIMEOUT_MS);
        if (await store.complete(job.id, job.attempts, { dropPayload: sensitive })) summary.succeeded += 1;
        else summary.stale += 1;
      } catch (error) {
        const permanent = error instanceof PermanentJobError;
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const retryAt = permanent ? null : new Date(now() + backoffMs(job.attempts)).toISOString();
        const after = await store.fail(job.id, job.attempts, { error: message, retryAt, dropPayload: sensitive });
        if (!after) {
          summary.stale += 1;
          return;
        }
        const where = `${job.kind} ${job.id} (attempt ${job.attempts} of ${job.maxAttempts})`;
        if (after.status === "failed") {
          summary.failed += 1;
          log.error("jobs", `${where} failed for good`, error);
        } else {
          summary.retrying += 1;
          log.warn("jobs", `${where} failed; retrying at ${after.runAt}`, message);
        }
      }
    }),
  );
  return summary;
}

/** Deletes jobs that finished more than RETENTION_DAYS ago. */
export async function pruneJobs(now = Date.now()): Promise<number> {
  return (await getData()).jobs.prune(new Date(now - RETENTION_DAYS * 24 * 60 * 60_000).toISOString());
}

type RunnerState = { timer: ReturnType<typeof setTimeout> | null; stopped: boolean; lastPrune: number };

/**
 * Starts this process's runner, once (Next's dev server re-evaluates modules,
 * so the state lives on globalThis). Polls straight away again while there is
 * work, every POLL_IDLE_MS when idle, and backs off to POLL_ERROR_MS while the
 * database is unreachable. Timers are unref'd: they never keep the process alive.
 */
export function startJobRunner(): void {
  if (optionalEnv("JOBS_RUNNER") === "off") {
    log.info("jobs", "JOBS_RUNNER=off: this process doesn't run background jobs.");
    return;
  }
  const g = globalThis as unknown as { __openshipkitJobRunner?: RunnerState };
  if (g.__openshipkitJobRunner && !g.__openshipkitJobRunner.stopped) return;
  const state: RunnerState = { timer: null, stopped: false, lastPrune: 0 };
  g.__openshipkitJobRunner = state;

  const schedule = (ms: number) => {
    if (state.stopped) return;
    state.timer = setTimeout(tick, ms);
    state.timer.unref?.();
  };
  const tick = async () => {
    try {
      const { claimed } = await runDueJobs();
      if (Date.now() - state.lastPrune > PRUNE_EVERY_MS) {
        state.lastPrune = Date.now();
        const pruned = await pruneJobs();
        if (pruned > 0) log.info("jobs", `pruned ${pruned} finished job(s) older than ${RETENTION_DAYS} days`);
      }
      schedule(claimed >= BATCH ? 0 : POLL_IDLE_MS);
    } catch (error) {
      // The database is down or migrating. Not log.error: that would report once per poll.
      log.warn("jobs", "the runner couldn't reach the database; trying again shortly", error instanceof Error ? error.message : error);
      schedule(POLL_ERROR_MS);
    }
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => stopJobRunner());
  schedule(1_000);
}

/** Stops claiming new jobs. Jobs already running finish (or time out) on their own. */
export function stopJobRunner(): void {
  const state = (globalThis as unknown as { __openshipkitJobRunner?: RunnerState }).__openshipkitJobRunner;
  if (!state) return;
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
}

// ---------------------------------------------------------------- reads and the one person-made write

export async function listJobs(query: ListQuery & { status?: JobStatus }): Promise<Page<Job>> {
  return (await getData()).jobs.list(query);
}

export async function jobCounts(): Promise<JobCounts> {
  return (await getData()).jobs.counts();
}

/** A failed job back in the queue, due now, with its attempts reset. Audited. */
export async function retryFailedJob(id: string, actor: Actor): Promise<Job> {
  assertNotDemo(actor);
  const data = await getData();
  const before = await data.jobs.get(id);
  if (!before) throw new ServiceError("not_found", "No such job.");
  if (before.status !== "failed") throw new ServiceError("conflict", `Only a failed job can be retried; this one is ${before.status}.`);
  const after = await data.jobs.retry(id);
  if (!after) throw new ServiceError("conflict", "The job changed while you were looking at it. Reload and try again.");
  await recordAudit(actor, "job.retry", "job", id, { status: before.status, attempts: before.attempts }, { status: after.status, attempts: after.attempts });
  return after;
}
