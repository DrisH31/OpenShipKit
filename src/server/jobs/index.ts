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
//  - A job whose last attempt dies with its worker is failed when its lease
//    ends (failAbandoned), so a job that crashes the process can't restart it forever.
//  - An attempt still running after JOB_TIMEOUT_MS is reported and left to
//    finish: it keeps its claim and its outcome is recorded when it settles.
//    If it outlives the lease, another worker may run it again (at least once).
//  - Finished jobs are pruned after RETENTION_DAYS. A sensitive job's payload is
//    deleted when the job ends, however it ends (./define.ts), so it can't be
//    retried by hand afterwards: the work it carried (a sign-in link) is gone.
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
import { scrubText } from "../scrub";
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
    sensitive: definition.sensitive === true,
    maxAttempts: definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    runAt: options.runAt?.toISOString(),
    key: options.key ?? null,
  });
}

/** Whether `work` settles within `ms`: its outcome if it did, null if it is still running. */
async function within(work: Promise<void>, ms: number): Promise<{ error: unknown } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.then(() => ({ error: undefined }), (error: unknown) => ({ error })), late]);
  } finally {
    clearTimeout(timer);
  }
}

export type RunSummary = { claimed: number; succeeded: number; retrying: number; failed: number; stale: number; slow: number; abandoned: number };

/**
 * One runner tick: ends jobs whose last attempt died with its worker, then claims
 * up to `limit` due jobs and runs them. Exported for tests and scripts.
 *
 * An attempt still running after `timeoutMs` is left alone: it keeps its claim,
 * and its outcome is recorded whenever it settles. JavaScript can't stop the
 * work, so releasing the job would run it twice side by side. Only once the
 * lease (LEASE_MS, longer than the timeout) runs out can another worker take
 * it over, and then the late outcome is refused (fenced on the attempt).
 */
export async function runDueJobs(
  options: { definitions?: readonly AnyDefinition[]; limit?: number; timeoutMs?: number; now?: () => number } = {},
): Promise<RunSummary> {
  const definitions = byKind(options.definitions ?? JOB_DEFINITIONS);
  const now = options.now ?? Date.now;
  const store = (await getData()).jobs;
  const summary: RunSummary = { claimed: 0, succeeded: 0, retrying: 0, failed: 0, stale: 0, slow: 0, abandoned: 0 };

  for (const job of await store.failAbandoned()) {
    summary.abandoned += 1;
    log.error("jobs", `${job.kind} ${job.id} failed for good: its worker stopped during the last attempt (${job.attempts} of ${job.maxAttempts})`);
  }

  const claimed = await store.claim({ limit: options.limit ?? BATCH, leaseMs: LEASE_MS });
  summary.claimed = claimed.length;

  /** Records how an attempt ended. Fenced: a stale claim changes nothing. */
  const record = async (job: Job, error: unknown): Promise<"succeeded" | "retrying" | "failed" | "stale"> => {
    if (error === undefined) return (await store.complete(job.id, job.attempts)) ? "succeeded" : "stale";
    const permanent = error instanceof PermanentJobError;
    const message = scrubText(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    const retryAt = permanent ? null : new Date(now() + backoffMs(job.attempts)).toISOString();
    const after = await store.fail(job.id, job.attempts, { error: message, retryAt });
    if (!after) return "stale";
    const where = `${job.kind} ${job.id} (attempt ${job.attempts} of ${job.maxAttempts})`;
    if (after.status === "failed") {
      log.error("jobs", `${where} failed for good`, error);
      return "failed";
    }
    log.warn("jobs", `${where} failed; retrying at ${after.runAt}`, message);
    return "retrying";
  };

  await Promise.all(
    claimed.map(async (job) => {
      const definition = definitions.get(job.kind);
      let work: Promise<void>;
      if (!definition) work = Promise.reject(new PermanentJobError(`no job is defined for kind "${job.kind}"`));
      else {
        const parsed = definition.schema.safeParse(job.payload);
        work = parsed.success
          ? Promise.resolve().then(() => definition.run(parsed.data))
          : Promise.reject(new PermanentJobError(`invalid payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
      }
      const outcome = await within(work, options.timeoutMs ?? JOB_TIMEOUT_MS);
      if (outcome === null) {
        summary.slow += 1;
        log.warn("jobs", `${job.kind} ${job.id} is still running after ${Math.round((options.timeoutMs ?? JOB_TIMEOUT_MS) / 1000)} s; it keeps its claim until it finishes or the lease ends`);
        void work.then(
          () => record(job, undefined),
          (error: unknown) => record(job, error),
        ).catch((error: unknown) => log.warn("jobs", `couldn't record the outcome of ${job.kind} ${job.id}`, error instanceof Error ? error.message : error));
        return;
      }
      summary[await record(job, outcome.error)] += 1;
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

/**
 * Stops claiming new jobs. It doesn't wait for running ones: Next's own SIGTERM
 * handler exits the process at once, and a job cut off there is due again when
 * its lease ends (or failed, if that was its last attempt).
 */
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
  if (before.sensitive) {
    throw new ServiceError("conflict", "This job's contents were deleted when it failed (it held something private, such as a sign-in link), so it can't run again.");
  }
  const after = await data.jobs.retry(id);
  if (!after) throw new ServiceError("conflict", "The job changed while you were looking at it. Reload and try again.");
  await recordAudit(actor, "job.retry", "job", id, { status: before.status, attempts: before.attempts }, { status: after.status, attempts: after.attempts });
  return after;
}
