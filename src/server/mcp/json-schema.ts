import "server-only";

//
// zod → JSON Schema for tools/list and the guide. Always the INPUT side
// (io: "input"): a field with a default is optional to the caller, and that
// is what an agent needs to know. The `$schema` line is dropped — MCP
// defaults to 2020-12, which is what zod emits, and some clients choke on it.
//

import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

const cache = new WeakMap<z.ZodType, JsonSchema>();

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const hit = cache.get(schema);
  if (hit) return hit;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  cache.set(schema, rest);
  return rest;
}
