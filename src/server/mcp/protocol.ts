import "server-only";

//
// The MCP wire protocol: stateless Streamable HTTP, one JSON-RPC message per
// POST, answered with plain JSON (never an SSE stream). A tools-only server
// needs four methods: initialize, ping, tools/list and tools/call.
//
// Pure: a message and an authenticated caller in, a reply out — the route
// (src/app/api/mcp/route.ts) does HTTP, auth and limits, and tests drive this
// directly. Rules:
//   - A notification (no id) or a client's response (no method) gets null;
//     the route answers 202 with no body.
//   - tools/list shows only the tools the key's scope allows; tools/call
//     checks the scope again, so a hidden tool can't be called by name.
//     Under OPENSHIPKIT_PROFILE=site the plan tools are not offered at all
//     (tools/index.ts): unlisted, and an unknown tool to tools/call.
//   - Bad arguments and refusals come back as a tool result with isError and
//     structuredContent {error, message, details?} — the model reads it and
//     retries. Protocol mistakes (unknown method or tool) are JSON-RPC errors.
//   - A ServiceError (or the adapter's DataError) is a readable refusal; any
//     other error is logged and returned as "server_error", never its text.
//

import { DataError } from "@/core/data";
import { scopeAllows } from "@/server/services/agent-keys";
import { ServiceError, serializeError } from "@/server/services/errors";
import { siteProfile } from "@/server/env";
import { SERVER_INFO, instructionsFor } from "./server-info";
import { toJsonSchema } from "./json-schema";
import { findTool, toolsForScope } from "./tools";
import type { McpTool, ToolContext } from "./types";

/**
 * Protocol revisions this server speaks, newest first. All four are
 * compatible for a tools-only, stateless JSON server. An unknown requested
 * version is answered with the newest; the client decides whether to go on.
 */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];

export function isSupportedProtocolVersion(version: string): boolean {
  return (PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** JSON-RPC 2.0 error codes used here. */
export const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcReply = JsonRpcSuccess | JsonRpcFailure;

/** What a tools/call result looks like (MCP CallToolResult). */
export interface ToolCallResult extends Record<string, unknown> {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: true;
}

const success = (id: JsonRpcId, result: Record<string, unknown>): JsonRpcSuccess => ({ jsonrpc: "2.0", id, result });

/** A JSON-RPC error reply. Exported for the route's parse and batch errors. */
export function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolResult(output: Record<string, unknown>, isError = false): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
    ...(isError ? { isError: true as const } : {}),
  };
}

/** How one tool appears in tools/list. */
export function describeTool(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toJsonSchema(tool.input),
    annotations: { title: tool.title, ...tool.annotations },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An error a tool threw, as what the agent reads — or null when it is a bug or an outage. */
function refusalFor(error: unknown): Record<string, unknown> | null {
  if (error instanceof ServiceError) return serializeError(error);
  if (error instanceof DataError) return { error: error.code, message: error.message };
  return null;
}

/**
 * Run one tools/call: find, check scope, validate, run. Never throws; null
 * means there is no tool by that name (a protocol error, not a tool result).
 */
export async function callTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolCallResult | null> {
  const tool = findTool(name);
  if (!tool) return null;
  if (!scopeAllows(ctx.key.scope, tool.scope)) {
    return toolResult(
      { error: "forbidden", message: `${tool.name} needs ${tool.scope === "admin" ? "an" : "a"} ${tool.scope} key; this key (${ctx.key.name}) has scope ${ctx.key.scope}. Ask the site owner for a key with more scope.` },
      true,
    );
  }
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const summary = details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join("; ");
    return toolResult({ error: "invalid", message: `Invalid arguments for ${tool.name}: ${summary}`, details }, true);
  }
  try {
    return toolResult(await tool.run(parsed.data, ctx));
  } catch (error) {
    const refusal = refusalFor(error);
    if (refusal) return toolResult(refusal, true);
    console.error(`[mcp] ${tool.name} failed (key ${ctx.key.name})`, error);
    return toolResult({ error: "server_error", message: "The server hit an unexpected error and logged it. Try again later or tell the site owner." }, true);
  }
}

/**
 * Handle one JSON-RPC message from an authenticated caller. Returns the reply,
 * or null when the message needs none (a notification or a response).
 */
export async function handleMcpMessage(message: unknown, ctx: ToolContext): Promise<JsonRpcReply | null> {
  if (!isObject(message) || message.jsonrpc !== "2.0") return rpcError(null, RPC_ERROR.invalidRequest, "Invalid request: expected one JSON-RPC 2.0 object");
  const { id, method, params } = message;

  // A response to a server request (we send none) or a notification
  // (notifications/initialized, notifications/cancelled …): nothing to do.
  if (method === undefined && ("result" in message || "error" in message)) return null;
  if (typeof method !== "string") return rpcError(typeof id === "string" || typeof id === "number" ? id : null, RPC_ERROR.invalidRequest, "Invalid request: method must be a string");
  if (id === undefined) return null;
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, RPC_ERROR.invalidRequest, "Invalid request: id must be a string or a number");
  if (params !== undefined && !isObject(params)) return rpcError(id, RPC_ERROR.invalidParams, "params must be an object");

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion = typeof requested === "string" && isSupportedProtocolVersion(requested) ? requested : LATEST_PROTOCOL_VERSION;
      return success(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: instructionsFor(siteProfile()),
      });
    }
    case "ping":
      return success(id, {});
    case "tools/list":
      return success(id, { tools: toolsForScope(ctx.key.scope).map(describeTool) });
    case "tools/call": {
      const name = params?.name;
      if (typeof name !== "string") return rpcError(id, RPC_ERROR.invalidParams, "tools/call needs params.name");
      const args = params?.arguments;
      if (args !== undefined && args !== null && !isObject(args)) return rpcError(id, RPC_ERROR.invalidParams, "params.arguments must be an object");
      const outcome = await callTool(name, args ?? {}, ctx);
      if (!outcome) return rpcError(id, RPC_ERROR.invalidParams, `Unknown tool: ${name}. Call tools/list for the tools this key can use.`);
      return success(id, outcome);
    }
    default:
      return rpcError(id, RPC_ERROR.methodNotFound, `Method not found: ${method}. This server offers tools only (initialize, ping, tools/list, tools/call).`);
  }
}
