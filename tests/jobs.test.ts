//
// The background job runner (ROADMAP 1.6) over the memory store: success,
// retries with backoff, permanent failures, timeouts, sensitive payloads, the
// audited manual retry, and JOBS_RUNNER=off. The queue's storage is covered on
// memory, PGlite and Postgres by tests/contract (describe "jobs").
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMemoryStore } from "@/adapters/data/memory";
import type { DataStore } from "@/core/data";
import type { Actor } from "@/core/types";
import { PermanentJobError, defineJob } from "@/server/jobs/define";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));

const { LEASE_MS, backoffMs, enqueueJob, retryFailedJob, runDueJobs, startJobRunner, stopJobRunner } = await import("@/server/jobs");

const admin: Actor = { type: "user", id: "admin-1", label: "admin@example.com" };
const ran: unknown[] = [];

const echo = defineJob({ kind: "test.echo", schema: z.object({ n: z.number() }), run: async (p) => void ran.push(p) });
const flaky = defineJob({
  kind: "test.flaky",
  schema: z.object({ failTimes: z.number() }),
  maxAttempts: 3,
  run: async (p) => {
    ran.push(p);
    if (ran.length <= p.failTimes) throw new Error(`flake ${ran.length}`);
  },
});
const doomed = defineJob({ kind: "test.doomed", schema: z.object({}), run: async () => Promise.reject(new PermanentJobError("address refused")) });
const secret = defineJob({ kind: "test.secret", schema: z.object({ link: z.string() }), sensitive: true, maxAttempts: 1, run: async () => {} });
const slow = defineJob({ kind: "test.slow", schema: z.object({}), run: () => new Promise((resolve) => setTimeout(resolve, 200)) });
const ALL = [echo, flaky, doomed, secret, slow];

/** A clock two hours behind: any backoff it computes is already in the past, so the retry is due at once. */
const past = () => Date.now() - 2 * 60 * 60_000;

beforeEach(() => {
  store = createMemoryStore({ fresh: true });
  ran.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  stopJobRunner();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("job runner", () => {
  it("runs a due job once and marks it succeeded", async () => {
    const { job } = await enqueueJob(echo, { n: 7 });
    expect(await runDueJobs({ definitions: ALL })).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(ran).toEqual([{ n: 7 }]);
    expect((await store.jobs.get(job.id))?.status).toBe("succeeded");
    expect(await runDueJobs({ definitions: ALL })).toMatchObject({ claimed: 0 });
  });

  it("refuses a bad payload when it is enqueued, not later in the background", async () => {
    await expect(enqueueJob(echo, { n: "seven" } as never)).rejects.toThrow(/test\.echo: invalid payload/);
    expect((await store.jobs.counts()).queued).toBe(0);
  });

  it("retries a failed attempt after a backoff, and the retry then succeeds", async () => {
    const { job } = await enqueueJob(flaky, { failTimes: 1 });
    const t0 = Date.now();
    expect(await runDueJobs({ definitions: ALL, now: () => t0 })).toMatchObject({ retrying: 1 });
    const waiting = await store.jobs.get(job.id);
    expect(waiting).toMatchObject({ status: "queued", attempts: 1, lastError: "Error: flake 1" });
    const delay = Date.parse(waiting!.runAt) - t0;
    expect(delay).toBeGreaterThanOrEqual(24_000);
    expect(delay).toBeLessThanOrEqual(36_000);
    expect(await runDueJobs({ definitions: ALL })).toMatchObject({ claimed: 0 }); // not due yet

    // The same failure seen from a clock two hours back is due at once, and its second attempt succeeds.
    ran.length = 0;
    const again = await enqueueJob(flaky, { failTimes: 1 });
    await runDueJobs({ definitions: ALL, now: past });
    expect(await runDueJobs({ definitions: ALL })).toMatchObject({ succeeded: 1 });
    expect(await store.jobs.get(again.job.id)).toMatchObject({ status: "succeeded", attempts: 2 });
    expect((await store.jobs.get(job.id))?.status).toBe("queued"); // the first one still waits out its backoff
  });

  it("fails for good after maxAttempts, and reports it once as an error", async () => {
    const errors = vi.spyOn(console, "error");
    const { job } = await enqueueJob(flaky, { failTimes: 99 });
    for (let i = 0; i < 3; i++) await runDueJobs({ definitions: ALL, now: past });
    expect(await store.jobs.get(job.id)).toMatchObject({ status: "failed", attempts: 3 });
    expect(ran).toHaveLength(3);
    expect(errors.mock.calls.filter((c) => String(c[0]).includes("failed for good"))).toHaveLength(1);
  });

  it("fails a PermanentJobError, an unknown kind and a payload that no longer parses without retrying", async () => {
    const a = await enqueueJob(doomed, {});
    const b = await store.jobs.enqueue({ kind: "test.removed", payload: {} });
    const c = await store.jobs.enqueue({ kind: "test.echo", payload: { n: "not a number" } });
    expect(await runDueJobs({ definitions: ALL })).toMatchObject({ claimed: 3, failed: 3 });
    expect(await store.jobs.get(a.job.id)).toMatchObject({ status: "failed", attempts: 1, lastError: "PermanentJobError: address refused" });
    expect((await store.jobs.get(b.job.id))?.lastError).toMatch(/no job is defined for kind "test\.removed"/);
    expect((await store.jobs.get(c.job.id))?.lastError).toMatch(/invalid payload/);
  });

  it("leaves an attempt that runs too long holding its claim, and records its outcome when it settles", async () => {
    const { job } = await enqueueJob(slow, {});
    expect(await runDueJobs({ definitions: ALL, timeoutMs: 20 })).toMatchObject({ slow: 1, retrying: 0 });
    expect(await store.jobs.get(job.id)).toMatchObject({ status: "running", attempts: 1 });
    expect(await runDueJobs({ definitions: ALL })).toMatchObject({ claimed: 0 }); // not released: it can't run twice side by side
    await vi.waitFor(async () => expect((await store.jobs.get(job.id))?.status).toBe("succeeded"), { timeout: 2_000 });
  });

  it("doesn't claim more while slow attempts fill the batch", async () => {
    for (let i = 0; i < 2; i++) await enqueueJob(slow, {}, { runAt: new Date(Date.now() - 10_000 + i) });
    await enqueueJob(echo, { n: 1 }); // due after both, so the first batch is the two slow ones
    expect(await runDueJobs({ definitions: ALL, limit: 2, timeoutMs: 10 })).toMatchObject({ claimed: 2, slow: 2 });
    expect(await runDueJobs({ definitions: ALL, limit: 2 })).toMatchObject({ claimed: 0 }); // both still running here
    await vi.waitFor(async () => expect((await store.jobs.counts()).succeeded).toBe(2), { timeout: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 10)); // the slots free after the outcome is recorded
    expect(await runDueJobs({ definitions: ALL, limit: 2 })).toMatchObject({ claimed: 1, succeeded: 1 });
  });

  it("frees a slow attempt's slot when its lease runs out, even if it never settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const forever = defineJob({ kind: "test.forever", schema: z.object({}), run: () => new Promise<void>(() => {}) });
      await enqueueJob(forever, {}, { runAt: new Date(Date.now() - 1_000) });
      await enqueueJob(echo, { n: 1 });
      const first = runDueJobs({ definitions: [forever, echo], limit: 1, timeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(20);
      expect(await first).toMatchObject({ claimed: 1, slow: 1 });
      expect(await runDueJobs({ definitions: [forever, echo], limit: 1 })).toMatchObject({ claimed: 0 }); // its slot is held
      await vi.advanceTimersByTimeAsync(LEASE_MS);
      expect(await runDueJobs({ definitions: [forever, echo], limit: 1 })).toMatchObject({ claimed: 1, succeeded: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a job whose last attempt died with its worker, and reports it", async () => {
    const errors = vi.spyOn(console, "error");
    const { job } = await store.jobs.enqueue({ kind: "test.echo", payload: { n: 1 }, maxAttempts: 1 });
    await store.jobs.claim({ limit: 1, leaseMs: 1 }); // a worker that claims it, then dies
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await runDueJobs({ definitions: ALL })).toMatchObject({ abandoned: 1, claimed: 0 });
    expect((await store.jobs.get(job.id))?.status).toBe("failed");
    expect(errors.mock.calls.some((c) => String(c[0]).includes("the lease on its last attempt"))).toBe(true);
  });

  it("stores the last error scrubbed of a failed query's parameters", async () => {
    const leaky = defineJob({
      kind: "test.leaky",
      schema: z.object({}),
      run: async () => Promise.reject(new Error('Failed query: select 1 where t = $1\nparams: sess_SECRET')),
    });
    const { job } = await enqueueJob(leaky, {});
    await runDueJobs({ definitions: [leaky] });
    expect((await store.jobs.get(job.id))?.lastError).toBe("Error: Failed query: select 1 where t = $1\nparams: [redacted]");
  });

  it("deletes a sensitive job's payload once it finishes, and keeps an ordinary one's", async () => {
    const s = await enqueueJob(secret, { link: "https://example.com/reset?token=abc" });
    const e = await enqueueJob(echo, { n: 1 });
    await runDueJobs({ definitions: ALL });
    expect((await store.jobs.get(s.job.id))?.payload).toBeNull();
    expect((await store.jobs.get(e.job.id))?.payload).toEqual({ n: 1 });
  });

  it("backs off 30 s, doubling, capped at an hour, with jitter", () => {
    expect(backoffMs(1, () => 0.5)).toBe(30_000);
    expect(backoffMs(2, () => 0.5)).toBe(60_000);
    expect(backoffMs(4, () => 0.5)).toBe(240_000);
    expect(backoffMs(20, () => 0.5)).toBe(3_600_000);
    expect(backoffMs(1, () => 0)).toBe(24_000);
    expect(backoffMs(1, () => 1)).toBe(36_000);
  });
});

describe("retrying a failed job by hand", () => {
  it("requeues it from scratch and audits who did it", async () => {
    const { job } = await enqueueJob(doomed, {});
    await runDueJobs({ definitions: ALL });
    const after = await retryFailedJob(job.id, admin);
    expect(after).toMatchObject({ status: "queued", attempts: 0 });
    const [entry] = (await store.audit.list({ entity: "job", entityId: job.id })).items;
    expect(entry).toMatchObject({ action: "job.retry", actor: { label: "admin@example.com" }, before: { status: "failed" }, after: { status: "queued" } });
  });

  it("refuses a sensitive job: its contents were deleted when it failed", async () => {
    const one = defineJob({ kind: "test.secret-once", schema: z.object({ link: z.string() }), sensitive: true, maxAttempts: 1, run: async () => Promise.reject(new Error("down")) });
    const { job } = await enqueueJob(one, { link: "https://example.com/r?t=1" });
    await runDueJobs({ definitions: [one] });
    expect(await store.jobs.get(job.id)).toMatchObject({ status: "failed", payload: null, sensitive: true });
    await expect(retryFailedJob(job.id, admin)).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/contents were deleted/) });
    expect((await store.audit.list({ entity: "job", entityId: job.id })).items).toEqual([]);
  });

  it("refuses a job that isn't failed, and one that doesn't exist", async () => {
    const { job } = await enqueueJob(echo, { n: 1 });
    await expect(retryFailedJob(job.id, admin)).rejects.toMatchObject({ code: "conflict" });
    await expect(retryFailedJob("00000000-0000-4000-8000-000000000000", admin)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("startJobRunner", () => {
  it("does nothing under JOBS_RUNNER=off", async () => {
    vi.stubEnv("JOBS_RUNNER", "off");
    const info = vi.spyOn(console, "info");
    startJobRunner();
    expect(info.mock.calls.some((c) => String(c[0]).includes("JOBS_RUNNER=off"))).toBe(true);
    expect((globalThis as { __openshipkitJobRunner?: unknown }).__openshipkitJobRunner).toBeUndefined();
  });

  it("runs queued jobs in the background", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await enqueueJob(echo, { n: 1 }).catch(() => {});
      // The runner uses the real definitions list, which knows nothing of test.echo:
      // the job fails for good, which is still proof the runner claimed it.
      startJobRunner();
      await vi.advanceTimersByTimeAsync(1_500);
      expect((await store.jobs.counts()).failed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
