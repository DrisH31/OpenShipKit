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
  stays **failed** for a person to look at. A job that throws
  `PermanentJobError` fails at once.
- **No endless crashes.** A job whose worker dies on every attempt (it runs the
  process out of memory, say) is taken over only while it has attempts left.
  After its last one, it's marked failed when the lease runs out.
- **Visible.** `/admin/jobs` lists failed and waiting jobs with their last
  error and a **Retry** button, which is audited. A sensitive job can't be
  retried: its contents were deleted when it failed. Agents get `jobs_list` and
  `job_retry` ([MCP](mcp.md)). `/api/health` reports `jobs.ok: false` when a
  due job has waited more than five minutes ([observability](observability.md#health)).
- **Tidy.** Finished jobs are deleted after 14 days. A *sensitive* job's payload
  (a queued email holds a live sign-in link) is deleted the moment it succeeds
  or fails for good.
- **Slow jobs.** An attempt still running after two minutes is logged and
  left to finish: it keeps its claim, and its outcome is recorded when it ends.
  It isn't handed to another worker while it may still be running. If it
  outlives the five-minute lease, though, it can be.
- **Shutdown.** Stopping the app (SIGTERM) ends the process at once. A job cut
  off then is due again when its lease ends, or failed if that was its last attempt.

## Email retries

`sendEmail()` sends straight away, exactly as before. Only when the provider
fails for a reason that can pass (Resend down, a rate limit, your SMTP server
unreachable) does it queue an `email.send` job and return, so the person
filling in the form never sees an error. A refusal that retrying can't fix (a
wrong SMTP password or API key, a refused address) is thrown at once, like
before the queue existed, and is in the log. The retry uses the same idempotency key as the first attempt, so Resend
delivers the message at most once. Retries stop after about eight minutes:
sign-in and reset links expire, and a dead link arriving an hour later helps
nobody.

## Usage reports

With `BILLING_METERED_METRICS` set, each recorded usage event of a listed metric
is stored as pending and queues a `usage.report` job that sends the stored event
to the Polar or Stripe meter
([usage.md](usage.md#charging-for-usage-metered-prices)), then marks it
reported. An event already reported is never sent again. Retries run for about
three hours (30 seconds doubling to an hour), and every five minutes the runner
re-queues events still pending from the last day, so a crash between recording
and queueing loses nothing. A report that failed for good is in `/admin/jobs` to
retry.

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
