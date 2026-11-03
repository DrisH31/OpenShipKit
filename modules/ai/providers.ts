import "server-only";

//
// The calls to the AI provider — plain fetch, no SDK. Routing by model slug:
//
//   "fal-ai/…"   → fal.ai's synchronous endpoint  (POST https://fal.run/<slug>, FAL_API_KEY)
//   anything else → the OpenAI-compatible endpoint (AI_BASE_URL: OpenRouter by default,
//                   or your own Ollama / vLLM / LiteLLM)
//
// Keys live only here, on the server; nothing in modules/ai is imported by a
// client component.
//
// Every call goes through providerFetch(): a hard timeout, the caller's own
// abort signal (a closed tab stops the upstream call instead of paying for an
// answer nobody reads), and failures normalised to UpstreamError — never the
// provider's body, which can echo the prompt or run to megabytes of HTML.
// Logs carry the status code only.
//

import { UpstreamError } from "../shared/api";
import type { AiConfig } from "./config";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ProviderCallOptions {
  /** Seconds this call may take (the route passes what is left of its total deadline). */
  timeoutSeconds: number;
  /** The inbound request's signal. */
  signal?: AbortSignal;
}

async function providerFetch(url: string, init: RequestInit, label: string, options: ProviderCallOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(Math.max(1, options.timeoutSeconds) * 1_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    // The caller going away and the upstream breaking both abort this fetch;
    // only the second is worth logging.
    if (options.signal?.aborted) throw new UpstreamError("The request was cancelled.", 499);
    if (timeout.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new UpstreamError("The AI service took too long to respond. Try again.", 504);
    }
    console.error(`[ai] ${label} unreachable:`, error instanceof Error ? error.message : error);
    throw new UpstreamError("The AI service is unavailable right now.");
  }
}

function bearer(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/** One chat completion; the assistant's text. */
export async function chatCompletion(
  config: AiConfig,
  model: string,
  messages: ChatMessage[],
  options: ProviderCallOptions,
): Promise<string> {
  if (!config.chatEnabled) throw new UpstreamError("AI isn't configured on this server.", 503);
  const response = await providerFetch(
    `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(config.apiKey) },
      body: JSON.stringify({ model, messages, max_tokens: config.maxOutputTokens }),
    },
    "chat",
    options,
  );
  if (!response.ok) {
    console.error(`[ai] chat failed with ${response.status}`);
    throw new UpstreamError("The AI service is unavailable right now.");
  }
  const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new UpstreamError("The AI returned an empty answer.");
  return text;
}

/**
 * One generated image; a URL. For fal it is a link on their CDN that EXPIRES,
 * for an OpenAI-compatible endpoint it may be a data: URI. Neither is stored:
 * anything that must last has to be fetched and saved by your own code.
 */
export async function generateImage(config: AiConfig, model: string, prompt: string, options: ProviderCallOptions): Promise<string> {
  return model.startsWith("fal-ai/") ? falImage(config, model, prompt, options) : compatibleImage(config, model, prompt, options);
}

async function falImage(config: AiConfig, model: string, prompt: string, options: ProviderCallOptions): Promise<string> {
  if (!config.falApiKey) throw new UpstreamError("FAL_API_KEY isn't configured on this server.", 503);
  // The synchronous endpoint suits fast models (flux/schnell). A slow model
  // belongs on fal's queue API with a job id: a request that outlives the
  // proxy in front of the app is paid for and thrown away.
  const response = await providerFetch(
    `https://fal.run/${model}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${config.falApiKey}` },
      body: JSON.stringify({ prompt }),
    },
    "fal image",
    options,
  );
  if (!response.ok) {
    console.error(`[ai] fal image failed with ${response.status}`);
    throw new UpstreamError("The image service is unavailable right now.");
  }
  const data = (await response.json().catch(() => null)) as { images?: { url?: unknown }[]; image?: { url?: unknown } } | null;
  const url = data?.images?.[0]?.url ?? data?.image?.url;
  if (typeof url !== "string" || !url) throw new UpstreamError("The image service returned no image.");
  return url;
}

async function compatibleImage(config: AiConfig, model: string, prompt: string, options: ProviderCallOptions): Promise<string> {
  if (!config.chatEnabled) throw new UpstreamError("AI isn't configured on this server.", 503);
  const response = await providerFetch(
    `${config.baseUrl}/images/generations`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(config.apiKey) },
      body: JSON.stringify({ model, prompt }),
    },
    "image",
    options,
  );
  if (!response.ok) {
    console.error(`[ai] image failed with ${response.status}`);
    throw new UpstreamError("The image service is unavailable right now.");
  }
  const data = (await response.json().catch(() => null)) as { data?: { url?: unknown; b64_json?: unknown }[] } | null;
  const first = data?.data?.[0];
  if (typeof first?.url === "string" && first.url) return first.url;
  if (typeof first?.b64_json === "string" && first.b64_json) return `data:image/png;base64,${first.b64_json}`;
  throw new UpstreamError("The image service returned no image.");
}
