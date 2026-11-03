import "server-only";

//
// email.send: delivers one message the first attempt couldn't (a provider
// outage, a rate limit, an SMTP server that's down). sendEmail() in
// ../email.ts queues it. It is never queued up front.
//
// The message carries the idempotency key its first attempt used, so Resend
// delivers it at most once whatever happens between attempts. It is
// sensitive: a reset or sign-in link sits in the payload until the job
// finishes, then the payload is deleted.
//

import { z } from "zod";
import { isPermanentEmailError } from "@/core/email";
import { PermanentJobError, defineJob } from "./define";

const emailMessageSchema = z.strictObject({
  to: z.string().min(3).max(320),
  subject: z.string().max(998),
  html: z.string(),
  text: z.string(),
  replyTo: z.string().max(320).optional(),
  idempotencyKey: z.string().max(256).optional(),
});

export const emailJob = defineJob({
  kind: "email.send",
  schema: emailMessageSchema,
  // 30 s, 1, 2 and 4 min apart: ~8 minutes in all. Sign-in and reset links expire, so retrying for
  // hours would only deliver dead ones.
  maxAttempts: 5,
  sensitive: true,
  run: async (message) => {
    const { deliverEmail } = await import("../email");
    try {
      await deliverEmail(message);
    } catch (error) {
      // A wrong password or a refused address won't fix itself: stop now, not after five tries.
      if (isPermanentEmailError(error)) throw new PermanentJobError((error as Error).message);
      throw error;
    }
  },
});
