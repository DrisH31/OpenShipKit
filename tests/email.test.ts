//
// Email delivery through Resend, with the SDK faked (no network): what we send,
// the idempotency key and the one retry, readable errors with no PII, and that
// the console provider stays the zero-config default.
//

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateEmailOptions, CreateEmailRequestOptions, CreateEmailResponse, ErrorResponse } from "resend";
import { createConsoleProvider } from "@/adapters/email/console";
import { createResendProvider, redact, type ResendClient } from "@/adapters/email/resend";
import type { EmailMessage } from "@/core/email";

const message: EmailMessage = {
  to: "someone@example.com",
  subject: "Your sign-in link",
  html: "<p>Click <a href=\"https://app.test/x\">here</a></p>",
  text: "Click https://app.test/x",
};

const ok = (id: string): CreateEmailResponse => ({ data: { id }, error: null, headers: null });
const fail = (error: ErrorResponse): CreateEmailResponse => ({ data: null, error, headers: null });

/** A fake Resend whose answers the test queues; every call is recorded. */
function fakeResend(...answers: CreateEmailResponse[]) {
  const calls: { payload: CreateEmailOptions; options?: CreateEmailRequestOptions }[] = [];
  const client: ResendClient = {
    emails: {
      send: vi.fn(async (payload: CreateEmailOptions, options?: CreateEmailRequestOptions) => {
        calls.push({ payload, options });
        return answers.shift() ?? ok("em_default");
      }),
    },
  };
  return { client, calls };
}

const env = { ...process.env };
beforeEach(() => {
  process.env.EMAIL_FROM = "Acme <hello@mail.acme.test>";
});
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
});

describe("Resend provider", () => {
  it("sends from EMAIL_FROM with html, text and reply-to, and returns the message id", async () => {
    const { client, calls } = fakeResend(ok("em_1"));
    const resend = createResendProvider({ client });
    expect(resend.id).toBe("resend");
    const res = await resend.send({ ...message, replyTo: "support@acme.test" });
    expect(res).toEqual({ id: "em_1" });
    expect(calls[0].payload).toEqual({
      from: "Acme <hello@mail.acme.test>",
      to: "someone@example.com",
      subject: "Your sign-in link",
      html: message.html,
      text: message.text,
      replyTo: "support@acme.test",
    });
  });

  it("leaves reply-to out when there isn't one", async () => {
    const { client, calls } = fakeResend(ok("em_1"));
    await createResendProvider({ client }).send(message);
    expect(calls[0].payload).not.toHaveProperty("replyTo");
  });

  it("sends an idempotency key: a fresh one per send, or the caller's own", async () => {
    const { client, calls } = fakeResend(ok("a"), ok("b"), ok("c"));
    const resend = createResendProvider({ client });
    await resend.send(message);
    await resend.send(message);
    await resend.send({ ...message, idempotencyKey: "job-42" } as EmailMessage);
    const keys = calls.map((c) => c.options?.idempotencyKey);
    expect(keys[0]).toMatch(/^openshipkit-[0-9a-f-]{36}$/);
    expect(keys[1]).toMatch(/^openshipkit-/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe("job-42");
  });

  it("retries a transient failure once, with the same key, so Resend can't deliver twice", async () => {
    const { client, calls } = fakeResend(fail({ name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" }), ok("em_2"));
    const res = await createResendProvider({ client, retryDelayMs: 0 }).send(message);
    expect(res).toEqual({ id: "em_2" });
    expect(calls).toHaveLength(2);
    expect(calls[1].options?.idempotencyKey).toBe(calls[0].options?.idempotencyKey);
  });

  it("retries network failures and 5xx once, then throws", async () => {
    const down = fail({ name: "application_error", statusCode: null, message: "Unable to fetch data. The request could not be resolved." });
    const { client, calls } = fakeResend(down, down);
    await expect(createResendProvider({ client, retryDelayMs: 0 }).send(message)).rejects.toThrow(/application_error/);
    expect(calls).toHaveLength(2);
  });

  it("doesn't retry a permanent error, and says how to fix it", async () => {
    const { client, calls } = fakeResend(
      fail({ name: "validation_error", statusCode: 403, message: "The acme.test domain is not verified. Please, add and verify your domain on https://resend.com/domains" }),
    );
    const err = (await createResendProvider({ client, retryDelayMs: 0 }).send(message).catch((e: unknown) => e)) as Error;
    expect(calls).toHaveLength(1);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/validation_error, HTTP 403/);
    expect(err.message).toMatch(/EMAIL_FROM/);
  });

  it("explains Resend's test mode (no verified domain)", async () => {
    const { client } = fakeResend(
      fail({
        name: "validation_error",
        statusCode: 403,
        message: "You can only send testing emails to your own email address (owner@acme.test). To send emails to other recipients, please verify a domain.",
      }),
    );
    await expect(createResendProvider({ client }).send(message)).rejects.toThrow(/only delivers to your own address/);
  });

  it("keeps addresses and keys out of the error", async () => {
    const { client } = fakeResend(
      fail({ name: "validation_error", statusCode: 422, message: "Invalid `to` field: someone@example.com. Key re_AbCdEf123456 rejected" }),
    );
    const err = (await createResendProvider({ client }).send(message).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain("someone@example.com");
    expect(err.message).not.toContain("re_AbCdEf123456");
    expect(err.message).toContain("[address]");
    expect(redact("a <b@c.d> e")).toBe("a <[address]> e");
  });

  it("points at RESEND_API_KEY for a bad key", async () => {
    const { client } = fakeResend(fail({ name: "invalid_api_key", statusCode: 403, message: "API key is invalid" }));
    await expect(createResendProvider({ client }).send(message)).rejects.toThrow(/Check RESEND_API_KEY/);
  });

  it("needs RESEND_API_KEY only when it sends, and names it when missing", async () => {
    delete process.env.RESEND_API_KEY;
    const resend = createResendProvider();
    await expect(resend.send(message)).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("warns once in production when EMAIL_FROM is still a resend.dev address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.EMAIL_FROM = "OpenShipKit <onboarding@resend.dev>";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeResend(ok("a"), ok("b"));
    const resend = createResendProvider({ client });
    await resend.send(message);
    await resend.send(message);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("someone@example.com");
    vi.unstubAllEnvs();
  });
});

describe("console provider (the default)", () => {
  it("prints the message instead of sending it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await createConsoleProvider().send(message);
    expect(res).toEqual({ id: null });
    expect(String(info.mock.calls[0][0])).toContain("Click https://app.test/x");
  });
});
