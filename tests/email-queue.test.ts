//
// sendEmail() sends now and queues a retry only when the provider fails
// (ROADMAP 1.6): the caller still succeeds, the retry keeps the first
// attempt's idempotency key, the job delivers it, and the reset link in the
// payload is deleted once it has.
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/adapters/data/memory";
import type { DataStore } from "@/core/data";
import type { EmailMessage } from "@/core/email";

let store: DataStore;
vi.mock("@/server/data", () => ({ getData: async () => store }));

// The provider sendEmail picks with no RESEND_API_KEY or SMTP_URL, faked: its answers are queued per test.
const provider = vi.hoisted(() => ({ answers: [] as ("ok" | Error)[], sent: [] as EmailMessage[] }));
vi.mock("@/adapters/email/console", () => ({
  createConsoleProvider: () => ({
    id: "console",
    async send(message: EmailMessage) {
      const next = provider.answers.shift() ?? "ok";
      if (next instanceof Error) throw next;
      provider.sent.push(message);
      return { id: `em_${provider.sent.length}` };
    },
  }),
}));

const { sendEmail } = await import("@/server/email");
const { runDueJobs } = await import("@/server/jobs");

const reset: EmailMessage = { to: "someone@example.com", subject: "Reset your password", html: "<a href=\"https://example.com/r?t=SECRET\">", text: "https://example.com/r?t=SECRET" };
const past = () => Date.now() - 2 * 60 * 60_000;

beforeEach(() => {
  store = createMemoryStore({ fresh: true });
  provider.answers = [];
  provider.sent = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("sendEmail with the queue behind it", () => {
  it("sends straight away when it can, and queues nothing", async () => {
    expect(await sendEmail(reset)).toEqual({ id: "em_1" });
    expect(provider.sent[0].idempotencyKey).toMatch(/^openshipkit-/);
    expect((await store.jobs.counts()).queued).toBe(0);
  });

  it("queues a failed send, retries it with the same idempotency key, and drops the link afterwards", async () => {
    provider.answers = [new Error("Resend is down"), new Error("still down"), "ok"];
    const result = await sendEmail(reset);
    expect(result).toEqual({ id: null, queued: true });

    const [job] = (await store.jobs.list({ status: "queued" })).items;
    expect(job).toMatchObject({ kind: "email.send", payload: { to: "someone@example.com" } });
    const key = (job.payload as EmailMessage).idempotencyKey;
    expect(key).toMatch(/^openshipkit-/);

    expect(await runDueJobs({ now: past })).toMatchObject({ retrying: 1 });
    expect(await runDueJobs()).toMatchObject({ succeeded: 1 });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].idempotencyKey).toBe(key);
    expect(await store.jobs.get(job.id)).toMatchObject({ status: "succeeded", payload: null });
  });

  it("keeps a caller's own idempotency key", async () => {
    provider.answers = [new Error("down")];
    await sendEmail({ ...reset, idempotencyKey: "welcome-user-1" });
    const [job] = (await store.jobs.list({})).items;
    expect((job.payload as EmailMessage).idempotencyKey).toBe("welcome-user-1");
  });

  it("throws the send's own error when even the queue is unavailable", async () => {
    provider.answers = [new Error("Resend is down")];
    store.jobs.enqueue = async () => {
      throw new Error("database down");
    };
    await expect(sendEmail(reset)).rejects.toThrow("Resend is down");
  });
});
