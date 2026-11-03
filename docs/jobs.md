# Background jobs

Work that shouldn't run inside a request, or should be retried when it fails,
goes into a queue in your own Postgres. There's no Redis and no separate worker
service: every app process runs a small runner that picks jobs up within
seconds. Today the app queues one kind itself, an email whose first send failed.

## How it behaves

- **Claimed safely.** Runners claim due jobs with `FOR UPDATE SKIP LOCKED`, so
  two app processes never run the same job at the same time.
- **At least once.** A claim is a five-minute lease. If a process dies mid-job,
  the job is due again once the lease runs out. A job therefore has to be safe
  to run twice. An email may arrive twice; anything that moves money must check
  before it acts.
- **Retries with backoff.** A failed attempt runs again after 30 s, then 1, 2
  and 4 minutes, doubling up to an hour, until the job's `maxAttempts`. Then it
  stays **failed** for a person to look at.
- **Visible.** `/admin/jobs` lists failed and waiting jobs with their last
  error and a **Retry** button, which is audited. Agents get `jobs_list` and
  `job_retry` ([MCP](mcp.md)). `/api/health` reports `jobs.ok: false` when a
  due job has waited more than five minutes ([observability](observability.md#health)).
- **Tidy.** Finished jobs are deleted after 14 days. A *sensitive* job's payload
  (a queued email holds a live sign-in link) is deleted the moment it succeeds
  or fails for good.
- **Bounded.** An attempt that runs over two minutes counts as failed.

## Email retries

`sendEmail()` sends straight away, exactly as before. Only when the provider
fails (Resend down, a rate limit, your SMTP server unreachable) does it queue
an `email.send` job and return, so the person filling in the form never sees an
error. The retry uses the same idempotency key as the first attempt, so Resend
delivers the message at most once. Retries stop after about eight minutes:
sign-in and reset links expire, and a dead link arriving an hour later helps
nobody.

## Adding a job

1. Define it in a file of its own under `src/server/jobs/`:

   ```ts
   import { z } from "zod";
   import { defineJob, PermanentJobError } from "./define";

   export const welcomeSequenceJob = defineJob({
     kind: "onboarding.day3",
     schema: z.object({ userId: z.string() }),
     maxAttempts: 5,
     run: async ({ userId }) => {
       const user = await getUserDetail(userId); // src/server/services/users.ts; dayThreeTemplate is yours to write
       if (!user) throw new PermanentJobError("the account is gone"); // no retries
       await sendEmail({ to: user.email, ...(await dayThreeTemplate(user)) });
     },
   });
   ```

2. List it in `src/server/jobs/definitions.ts`.
3. Queue it from a service:

   ```ts
   await enqueueJob(welcomeSequenceJob, { userId }, { runAt: inThreeDays, key: `day3:${userId}` });
   ```

   `key` keeps one unfinished job per key, so signing up twice doesn't queue
   two emails. The payload is checked against the schema when it's queued, so
   a bad one fails at the caller rather than later in the background.

The `kind` is stored on the row. Renaming a kind strands its queued jobs: they
fail with "no job is defined", and you can retry them once the old name is back.

## Running it

Every process runs the runner by default. `JOBS_RUNNER=off` stops one from
claiming jobs, though it can still queue them. Use it on replicas that should
only serve requests, with one process (or a dedicated container running the
same image) left on. Turn it off everywhere and nothing runs: `/api/health`
then shows `jobs.ok: false` once anything has waited five minutes.

## What it isn't

It's a queue for a SaaS app's own background work: emails, webhooks to send,
reports, clean-ups. It isn't a cron. Schedule a recurring job by having the job
queue its next run, with a `key` so there's only ever one. For a very high
volume of jobs (thousands a second) use a dedicated queue: past that point the
`jobs` table, and its vacuuming, become a load of their own.
