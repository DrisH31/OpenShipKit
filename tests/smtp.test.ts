//
// Email over SMTP (ROADMAP 1.5): SMTP_URL parsing, the provider choice, the
// one retry, errors without the address or the password, a real send over a
// socket to a fake SMTP server, and the production boot checks.
//

import { createServer, type Server, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSmtpProvider, type SmtpTransport } from "@/adapters/email/smtp";
import { redact } from "@/adapters/email/redact";
import type { EmailMessage } from "@/core/email";
import { parseSmtpUrl, resolveEmailProvider } from "@/server/env-rules";

const message: EmailMessage = {
  to: "someone@example.com",
  subject: "Your sign-in link",
  html: "<p>Click <a href=\"https://app.test/x\">here</a></p>",
  text: "Click https://app.test/x",
};

beforeEach(() => vi.stubEnv("EMAIL_FROM", "Acme <hello@mail.acme.test>"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const smtpError = (fields: { code?: string; responseCode?: number; message: string }) => Object.assign(new Error(fields.message), fields);

function fakeTransport(...answers: (Error | string)[]) {
  const calls: Parameters<SmtpTransport["sendMail"]>[0][] = [];
  const transport: SmtpTransport = {
    sendMail: vi.fn(async (mail) => {
      calls.push(mail);
      const next = answers.shift() ?? "<default@acme.test>";
      if (next instanceof Error) throw next;
      return { messageId: next };
    }),
  };
  return { transport, calls };
}

describe("SMTP_URL", () => {
  it("reads TLS from the scheme, the port's default, and the percent-encoded credentials", () => {
    expect(parseSmtpUrl("smtps://me%40acme.test:p%3Ass%2Fw@smtp.example.com")).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "me@acme.test", pass: "p:ss/w" },
    });
    expect(parseSmtpUrl("smtp://u:p@smtp.example.com:2525")).toMatchObject({ port: 2525, secure: false, requireTLS: true });
    expect(parseSmtpUrl("smtp://smtp.example.com")).toMatchObject({ port: 587, requireTLS: true });
    expect(parseSmtpUrl("smtp://smtp.example.com").auth).toBeUndefined();
  });

  it("requires STARTTLS for every host except this machine", () => {
    expect(parseSmtpUrl("smtp://localhost:25").requireTLS).toBe(false);
    expect(parseSmtpUrl("smtp://127.0.0.1:25").requireTLS).toBe(false);
    expect(parseSmtpUrl("smtp://mail.internal:25").requireTLS).toBe(true);
  });

  it("says how to encode a password with a raw %, instead of 'URI malformed'", () => {
    expect(() => parseSmtpUrl("smtps://me:100%sure@smtp.example.com")).toThrow(/isn't percent-encoded: write % as %25/);
  });

  it("refuses what isn't an SMTP URL, without repeating the password", () => {
    expect(() => parseSmtpUrl("https://u:hunter2@smtp.example.com")).toThrow(/must start with smtps:\/\/ .* not https:\/\//);
    expect(() => parseSmtpUrl("smtp.example.com:587")).toThrow();
    for (const bad of ["not a url", "https://u:hunter2@x.test"]) {
      try {
        parseSmtpUrl(bad);
      } catch (error) {
        expect(String(error)).not.toContain("hunter2");
      }
    }
  });
});

describe("choosing the email provider", () => {
  it("Resend wins, then SMTP, then the log; EMAIL_PROVIDER overrides", () => {
    expect(resolveEmailProvider({})).toBe("console");
    expect(resolveEmailProvider({ SMTP_URL: "smtp://x" })).toBe("smtp");
    expect(resolveEmailProvider({ SMTP_URL: "smtp://x", RESEND_API_KEY: "re_x" })).toBe("resend");
    expect(resolveEmailProvider({ SMTP_URL: "smtp://x", RESEND_API_KEY: "re_x", EMAIL_PROVIDER: "smtp" })).toBe("smtp");
    expect(() => resolveEmailProvider({ EMAIL_PROVIDER: "sendgrid" })).toThrow(/resend, smtp, console/);
  });
});

describe("SMTP provider", () => {
  it("sends from EMAIL_FROM with html, text and reply-to, and returns the Message-ID", async () => {
    const { transport, calls } = fakeTransport("<abc@acme.test>");
    const result = await createSmtpProvider({ transport }).send({ ...message, replyTo: "support@acme.test" });
    expect(result).toEqual({ id: "<abc@acme.test>" });
    expect(calls[0]).toEqual({ from: "Acme <hello@mail.acme.test>", ...message, replyTo: "support@acme.test" });
  });

  it("retries once when the server didn't accept the message (4xx, dropped connection)", async () => {
    for (const first of [smtpError({ responseCode: 421, message: "try later" }), smtpError({ code: "ECONNECTION", message: "closed" })]) {
      const { transport, calls } = fakeTransport(first, "<ok@acme.test>");
      await expect(createSmtpProvider({ transport, retryDelayMs: 0 }).send(message)).resolves.toEqual({ id: "<ok@acme.test>" });
      expect(calls).toHaveLength(2);
    }
  });

  it("doesn't retry a permanent refusal, and says how to fix it", async () => {
    const { transport, calls } = fakeTransport(smtpError({ code: "EAUTH", responseCode: 535, message: "Invalid login" }));
    await expect(createSmtpProvider({ transport, retryDelayMs: 0 }).send(message)).rejects.toThrow(
      /SMTP didn't send the email \(EAUTH, SMTP 535\): Invalid login\. Check the user name and password in SMTP_URL/,
    );
    expect(calls).toHaveLength(1);
  });

  it("gives up after the one retry", async () => {
    const down = () => smtpError({ code: "ETIMEDOUT", message: "timed out" });
    const { transport, calls } = fakeTransport(down(), down(), "<never@acme.test>");
    await expect(createSmtpProvider({ transport, retryDelayMs: 0 }).send(message)).rejects.toThrow(/ETIMEDOUT.*check the host and port/);
    expect(calls).toHaveLength(2);
  });

  it("keeps the recipient and any credentials out of the error", async () => {
    const { transport } = fakeTransport(
      smtpError({ code: "EENVELOPE", responseCode: 550, message: "550 <someone@example.com>: rejected by smtp://me:hunter2@relay.test" }),
    );
    const error = await createSmtpProvider({ transport, retryDelayMs: 0 }).send(message).catch((e: Error) => e);
    expect(String(error)).not.toMatch(/someone@example\.com|hunter2/);
    expect(String(error)).toContain("EMAIL_FROM must be an address it may send for");
  });

  it("needs SMTP_URL only when it sends, and names it when missing", async () => {
    const provider = createSmtpProvider();
    vi.stubEnv("SMTP_URL", "");
    await expect(provider.send(message)).rejects.toThrow(/SMTP_URL/);
  });

  it("redact() strips URL credentials, addresses and Resend keys", () => {
    expect(redact("smtps://user:pass@smtp.test to a@b.test with re_ABCDEF1234")).toBe("smtps://[credentials]@smtp.test to [address] with re_[redacted]");
  });
});

/**
 * A minimal SMTP server on a random local port: enough of RFC 5321 for one
 * message with AUTH PLAIN. It records the commands and the message.
 */
async function fakeSmtpServer(): Promise<{ port: number; commands: string[]; data: string[]; close: () => Promise<void> }> {
  const commands: string[] = [];
  const data: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    let body = "";
    socket.write("220 fake.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            data.push(body);
            socket.write("250 2.0.0 queued as FAKE1\r\n");
          } else body += `${line}\n`;
          continue;
        }
        commands.push(line);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") socket.write("250-fake.test\r\n250 AUTH PLAIN\r\n");
        else if (verb === "AUTH") socket.write("235 2.7.0 ok\r\n");
        else if (verb === "MAIL" || verb === "RCPT" || verb === "RSET" || verb === "NOOP") socket.write("250 ok\r\n");
        else if (verb === "DATA") {
          inData = true;
          body = "";
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") socket.end("221 bye\r\n");
        else socket.write("502 unknown\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    commands,
    data,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

describe("SMTP over a real socket", () => {
  it("authenticates, sends the envelope and both parts, and returns the Message-ID", async () => {
    const server = await fakeSmtpServer();
    try {
      vi.stubEnv("SMTP_URL", `smtp://mailer:s3cret@127.0.0.1:${server.port}`);
      const result = await createSmtpProvider().send({ ...message, replyTo: "support@acme.test" });

      expect(result.id).toMatch(/^<.+>$/);
      const auth = server.commands.find((c) => c.startsWith("AUTH PLAIN"));
      expect(Buffer.from(auth!.split(" ")[2], "base64").toString("utf8")).toBe("\0mailer\0s3cret");
      expect(server.commands).toContain("MAIL FROM:<hello@mail.acme.test>");
      expect(server.commands).toContain("RCPT TO:<someone@example.com>");
      const raw = server.data[0];
      expect(raw).toMatch(/^From: Acme <hello@mail\.acme\.test>$/m);
      expect(raw).toMatch(/^Reply-To: support@acme\.test$/m);
      expect(raw).toMatch(/^Subject: Your sign-in link$/m);
      expect(raw).toContain("multipart/alternative");
      expect(raw).toContain("Click https://app.test/x");
    } finally {
      await server.close();
    }
  });
});

describe("the production boot check, with SMTP", () => {
  const GOOD = {
    DATABASE_URL: "postgres://u:p@db:5432/app",
    BETTER_AUTH_SECRET: "q8Vd0mJ2rX5tL9wB3nH7yK1cF4gP6sZaE0uT2iO8",
    NEXT_PUBLIC_SITE_URL: "https://example.com",
    RESEND_API_KEY: "",
    SMTP_URL: "",
    EMAIL_PROVIDER: "",
    BETTER_AUTH_SECRETS: "",
    LOG_FORMAT: "pretty",
  };

  async function boot(env: Record<string, string>) {
    for (const [k, v] of Object.entries({ ...GOOD, ...env })) vi.stubEnv(k, v);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const lines: string[] = [];
    for (const level of ["error", "warn", "info"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
    const { checkProductionEnv } = await import("@/server/boot-check");
    checkProductionEnv();
    return { exited: exit.mock.calls.length > 0, log: lines.join("\n") };
  }

  it("starts with SMTP_URL and EMAIL_FROM, and says nothing about email going to the log", async () => {
    const { exited, log } = await boot({ SMTP_URL: "smtps://u:p@smtp.example.com" });
    expect(exited).toBe(false);
    expect(log).not.toMatch(/No email provider/);
  });

  it("refuses SMTP without EMAIL_FROM, a malformed SMTP_URL, or EMAIL_PROVIDER=smtp with no URL", async () => {
    const noFrom = await boot({ SMTP_URL: "smtps://u:p@smtp.example.com", EMAIL_FROM: "" });
    expect(noFrom).toMatchObject({ exited: true });
    expect(noFrom.log).toMatch(/SMTP needs EMAIL_FROM/);
    vi.restoreAllMocks();

    const bad = await boot({ SMTP_URL: "https://u:hunter2@smtp.example.com" });
    expect(bad.exited).toBe(true);
    expect(bad.log).toMatch(/SMTP_URL must start with smtps:\/\//);
    expect(bad.log).not.toContain("hunter2");
    vi.restoreAllMocks();

    const none = await boot({ EMAIL_PROVIDER: "smtp" });
    expect(none.exited).toBe(true);
    expect(none.log).toMatch(/EMAIL_PROVIDER=smtp but SMTP_URL is not set/);
  });

  it("names SMTP_URL when there's no email provider at all", async () => {
    const { exited, log } = await boot({});
    expect(exited).toBe(false);
    expect(log).toMatch(/Set RESEND_API_KEY, or SMTP_URL for your own mail server/);
  });
});
