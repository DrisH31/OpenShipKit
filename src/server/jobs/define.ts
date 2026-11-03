//
// A background job's definition: its kind, the shape of its payload, how
// many times it may run, and what it does. The list of every job the runner
// knows is ./definitions.ts.
//

import type { z } from "zod";

export interface JobDefinition<T> {
  /** "<area>.<verb>", stored on the row: renaming one strands its queued jobs. */
  kind: string;
  /** Checked when the job is enqueued and again before it runs (code may have changed in between). */
  schema: z.ZodType<T>;
  /** Default 5. Retries back off: 30 s, 1 min, 2 min … up to an hour apart. */
  maxAttempts?: number;
  /**
   * The payload holds something that mustn't outlive the job, such as a live
   * sign-in link: it is deleted from the row once the job succeeds or has failed for good.
   */
  sensitive?: boolean;
  /** Throw to fail the attempt. A PermanentJobError fails it for good, without retries. */
  run(payload: T): Promise<void>;
}

export function defineJob<T>(definition: JobDefinition<T>): JobDefinition<T> {
  return definition;
}

/** Thrown by a job that can never succeed (bad input, a refused address): no retries. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
