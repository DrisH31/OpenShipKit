import "server-only";

//
// The shape of one MCP tool. A tool is data plus a `run` that calls a service
// (src/server/services/*) — never the DataStore — so every write an agent
// makes is validated and audited exactly like an admin's.
//
// `input` is a zod object: it validates the arguments before `run` sees them
// and becomes the tool's JSON Schema in tools/list (z.toJSONSchema). Use
// z.strictObject so a misspelt argument is refused instead of silently dropped.
//

import type { z } from "zod";
import type { Actor, AgentKey, AgentScope } from "@/core/types";

/** Who is calling: the authenticated key and the audit actor derived from it. */
export interface ToolContext {
  key: AgentKey;
  actor: Actor;
}

/** MCP tool annotations (hints for the client's approval UI; never a security boundary). */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface McpTool<S extends z.ZodObject = z.ZodObject> {
  /** snake_case, verb last within a noun group: content_get, post_publish. */
  name: string;
  /** Short human label for client UIs. */
  title: string;
  /** Written for the agent: what it does, when to use it, what to pass, what comes back. */
  description: string;
  /** The least scope that may call it (scopes are cumulative: read < write < admin). */
  scope: AgentScope;
  annotations: ToolAnnotations;
  input: S;
  /**
   * Method syntax on purpose: it is checked bivariantly, so a tool with a
   * specific argument type still fits in the registry's McpTool[]. The
   * arguments have been parsed by `input` before this runs.
   */
  run(args: z.output<S>, ctx: ToolContext): Promise<Record<string, unknown>>;
}

/** Identity helper that keeps each tool's `args` typed from its own schema. */
export function defineTool<S extends z.ZodObject>(tool: McpTool<S>): McpTool<S> {
  return tool;
}

/** Reads: safe to call any number of times. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** A write that sets state to what you pass; repeating it changes nothing more. */
export const WRITE_IDEMPOTENT: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** A write that adds something new each time (a post, a restore entry). */
export const WRITE_ADDITIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** A write that removes or overwrites in a way a client should confirm. */
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
