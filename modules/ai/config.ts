import "server-only";

//
// The AI module's settings, read lazily (see modules/shared/config.ts).
// Every number here is a spend control.
//
// Off until configured. Chat is on when AI_API_KEY or AI_BASE_URL is set;
// images when AI_IMAGE_MODEL is set (or FAL_API_KEY, which defaults it).
// Nothing is sent anywhere until then, and the routes answer 503.
//
// One OpenAI-compatible endpoint serves chat (POST {base}/chat/completions)
// and, for models not named "fal-ai/…", images (POST {base}/images/generations):
//
//   OpenRouter (default)  AI_API_KEY=…                        AI_BASE_URL unset
//   Self-hosted Ollama    AI_BASE_URL=http://ollama:11434/v1  AI_CHAT_MODEL=llama3.2   (no key)
//   vLLM / LiteLLM / …    AI_BASE_URL=http://vllm:8000/v1     AI_CHAT_MODEL=…          (key if it wants one)
//
// fal.ai is a separate, optional image provider: FAL_API_KEY, and a model
// slug starting "fal-ai/" (POST https://fal.run/<slug>).
//
// The model a request may name must be on the allowlist, and the default
// model must be on its own allowlist: clients don't send a model, so every
// real request resolves to the default — a list that leaves it out would read
// as a control and not be one. aiConfig() throws when they disagree.
//

import { optionalEnv } from "@/server/env";
import { intEnv, listEnv, urlEnv } from "../shared/config";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL = "openrouter/auto";
const FAL_DEFAULT_IMAGE_MODEL = "fal-ai/flux/schnell";

export interface AiConfig {
  /** OpenAI-compatible base URL, no trailing slash. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer …` when set; a self-hosted endpoint may need none. */
  apiKey: string | null;
  /** Chat is configured (AI_API_KEY or AI_BASE_URL set). */
  chatEnabled: boolean;
  chatModel: string;
  allowedChatModels: string[];
  /** Images are configured (an image model is known). */
  imageEnabled: boolean;
  imageModel: string;
  allowedImageModels: string[];
  falApiKey: string | null;

  maxMessages: number;
  /** Summed over every message: ten 20,000-character messages cost what one of 200,000 does. */
  maxInputChars: number;
  maxOutputTokens: number;
  /** Ceiling on ONE upstream call. */
  requestTimeoutSeconds: number;
  /** Ceiling on the whole request, guard chain included. */
  totalTimeoutSeconds: number;

  maxConcurrent: number;
  maxConcurrentPerUser: number;
  rateLimitPerMinute: number;

  /** Generations a person without an unmetered plan may make per UTC day. 0 = plan holders only. */
  freeCallsPerDay: number;
  /** Plan keys whose holders are unmetered (hasPlan(), so "Everything in Pro" counts as Pro). */
  unmeteredPlans: string[];
}

export function aiConfig(): AiConfig {
  const customBase = urlEnv("AI_BASE_URL");
  const baseUrl = customBase ?? OPENROUTER_BASE_URL;
  const apiKey = optionalEnv("AI_API_KEY") ?? null;
  const chatEnabled = Boolean(apiKey || customBase);

  const chatModel = optionalEnv("AI_CHAT_MODEL") ?? (customBase ? "" : OPENROUTER_DEFAULT_MODEL);
  if (chatEnabled && !chatModel) {
    throw new Error("AI_BASE_URL is set but AI_CHAT_MODEL isn't: name the model your endpoint serves (for Ollama, e.g. llama3.2).");
  }

  const falApiKey = optionalEnv("FAL_API_KEY") ?? null;
  const imageModel = optionalEnv("AI_IMAGE_MODEL") ?? (falApiKey ? FAL_DEFAULT_IMAGE_MODEL : "");
  const imageEnabled = Boolean(imageModel) && (imageModel.startsWith("fal-ai/") ? Boolean(falApiKey) : chatEnabled);

  const allowedChatModels = listEnv("AI_ALLOWED_CHAT_MODELS", chatModel ? [chatModel] : []);
  const allowedImageModels = listEnv("AI_ALLOWED_IMAGE_MODELS", imageModel ? [imageModel] : []);
  if (chatModel && !allowedChatModels.includes(chatModel)) {
    throw new Error(`AI_CHAT_MODEL (${chatModel}) must be in AI_ALLOWED_CHAT_MODELS (${allowedChatModels.join(", ")}).`);
  }
  if (imageModel && !allowedImageModels.includes(imageModel)) {
    throw new Error(`AI_IMAGE_MODEL (${imageModel}) must be in AI_ALLOWED_IMAGE_MODELS (${allowedImageModels.join(", ")}).`);
  }

  const requestTimeoutSeconds = intEnv("AI_REQUEST_TIMEOUT_SECONDS", 60, { max: 300 });
  const totalTimeoutSeconds = intEnv("AI_TOTAL_REQUEST_TIMEOUT_SECONDS", 55, { max: 300 });
  const maxConcurrent = intEnv("AI_MAX_CONCURRENT_REQUESTS", 8, { max: 1_000 });
  const maxConcurrentPerUser = intEnv("AI_MAX_CONCURRENT_REQUESTS_PER_USER", 2, { max: 100 });

  const freeCallsPerDay = intEnv("AI_FREE_CALLS_PER_DAY", 5, { min: 0, max: 1_000_000 });
  const unmeteredPlans = listEnv("AI_UNMETERED_PLANS");
  if (freeCallsPerDay === 0 && unmeteredPlans.length === 0) {
    throw new Error("AI_FREE_CALLS_PER_DAY=0 with no AI_UNMETERED_PLANS lets nobody use AI. Name the plans that may (e.g. AI_UNMETERED_PLANS=pro).");
  }

  return {
    baseUrl,
    apiKey,
    chatEnabled,
    chatModel,
    allowedChatModels,
    imageEnabled,
    imageModel,
    allowedImageModels,
    falApiKey,
    maxMessages: intEnv("AI_MAX_MESSAGES", 32, { max: 200 }),
    maxInputChars: intEnv("AI_MAX_INPUT_CHARS", 24_000, { min: 100, max: 500_000 }),
    maxOutputTokens: intEnv("AI_MAX_OUTPUT_TOKENS", 1_024, { max: 32_768 }),
    requestTimeoutSeconds,
    totalTimeoutSeconds,
    maxConcurrent,
    maxConcurrentPerUser: Math.min(maxConcurrentPerUser, maxConcurrent),
    rateLimitPerMinute: intEnv("AI_RATE_LIMIT_PER_MINUTE", 20, { max: 100_000 }),
    freeCallsPerDay,
    unmeteredPlans,
  };
}
