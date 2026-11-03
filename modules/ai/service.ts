import "server-only";

//
// The AI service: what the routes (and your own server actions or pages) call.
//
//   generateChat(user, input, options)  → { text, remainingToday }
//   generateImage(user, input, signal)  → { url, remainingToday }
//   getAiUsage(user)                    → today's allowance, for the UI
//
// Each one: configured? → validate (zod, parseInput — a malformed request
// costs no quota and no rate-limit slot, because it costs the provider
// nothing) → the guard chain (./guard.ts) → the provider, inside the total
// deadline → refund the quota unless an answer was delivered.
//
// Nothing here writes app data, so nothing is audited: the usage ledger is a
// counter, not a record anyone edits. Prompts and answers aren't stored or
// logged. If your feature keeps them (a chat history), that is a table and a
// service of its own, audited like every other write.
//

import { z } from "zod";
import type { User } from "@/core/types";
import { ServiceError, parseInput } from "@/server/services/errors";
import { aiConfig, type AiConfig } from "./config";
import { acquireAiGeneration, secondsLeft, type AiPermit } from "./guard";
import { chatCompletion, generateImage as providerImage, type ChatMessage } from "./providers";
import { usageSummary } from "./usage";

/** A requested model: absent → the default; present → must be on the allowlist (never silently swapped). */
function modelField(allowed: string[], fallback: string) {
  return z
    .string()
    .max(200)
    .optional()
    .transform((m) => m || fallback)
    .refine((m) => allowed.includes(m), "That model isn’t available");
}

export function chatInputSchema(config: AiConfig) {
  return z
    .object({
      model: modelField(config.allowedChatModels, config.chatModel),
      messages: z
        .array(
          z.object({
            // No "system" from the client: the system prompt is the server's (options.system).
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1, "Each message needs text"),
          }),
        )
        .min(1, "Send at least one message")
        .max(config.maxMessages, `At most ${config.maxMessages} messages`),
    })
    .refine((v) => v.messages.reduce((n, m) => n + m.content.length, 0) <= config.maxInputChars, {
      message: `Messages may total at most ${config.maxInputChars} characters`,
      path: ["messages"],
    });
}

export function imageInputSchema(config: AiConfig) {
  return z.object({
    model: modelField(config.allowedImageModels, config.imageModel),
    prompt: z.string().trim().min(1, "Describe the image").max(config.maxInputChars, `At most ${config.maxInputChars} characters`),
  });
}

/** Run `call` under the guard chain and the total deadline; the quota is refunded unless it returns. */
async function guarded<T>(user: User, config: AiConfig, call: (timeoutSeconds: number) => Promise<T>): Promise<{ value: T; remainingToday: number | null }> {
  const deadline = Date.now() + config.totalTimeoutSeconds * 1000;
  let permit: AiPermit | undefined;
  let delivered = false;
  try {
    permit = await acquireAiGeneration(user.id, config);
    const value = await call(secondsLeft(deadline, config));
    delivered = true;
    return { value, remainingToday: permit.reservation.remaining };
  } finally {
    if (permit) {
      if (!delivered) {
        await permit.reservation.release().catch((error: unknown) => console.error("[ai] quota refund failed:", error instanceof Error ? error.message : error));
      }
      permit.releaseSlot();
    }
  }
}

export interface ChatOptions {
  /** The inbound request's signal: a closed tab stops the upstream call. */
  signal?: AbortSignal;
  /** Your feature's instructions, sent first. Server-side only — clients can't send a system message. */
  system?: string;
}

export async function generateChat(user: User, input: unknown, options: ChatOptions = {}): Promise<{ text: string; remainingToday: number | null }> {
  const config = aiConfig();
  if (!config.chatEnabled) throw new ServiceError("unavailable", "AI isn’t set up on this site yet.");
  const { model, messages } = parseInput(chatInputSchema(config), input);
  const sent: ChatMessage[] = options.system ? [{ role: "system", content: options.system }, ...messages] : messages;
  const { value, remainingToday } = await guarded(user, config, (timeoutSeconds) =>
    chatCompletion(config, model, sent, { timeoutSeconds, signal: options.signal }),
  );
  return { text: value, remainingToday };
}

export async function generateImage(user: User, input: unknown, signal?: AbortSignal): Promise<{ url: string; remainingToday: number | null }> {
  const config = aiConfig();
  if (!config.imageEnabled) throw new ServiceError("unavailable", "Image generation isn’t set up on this site yet.");
  const { model, prompt } = parseInput(imageInputSchema(config), input);
  const { value, remainingToday } = await guarded(user, config, (timeoutSeconds) => providerImage(config, model, prompt, { timeoutSeconds, signal }));
  return { url: value, remainingToday };
}

export async function getAiUsage(user: User) {
  const config = aiConfig();
  return { chat: config.chatEnabled, image: config.imageEnabled, ...(await usageSummary(user.id, config)) };
}
