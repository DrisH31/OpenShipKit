//
// zod schema → the admin editor's form model, on the server. Kept apart from
// ./schema-form (which client components import) so zod never ships to the
// browser just to draw a form.
//

import { z } from "zod";
import { toFieldNode, type FieldNode, type JsonSchema } from "./schema-form";

/**
 * The form model for a zod schema — what a server page passes to the admin's
 * SchemaEditor. Uses the INPUT side of the schema (fields with defaults are
 * optional), and keeps anything JSON Schema can't express as a raw-JSON box.
 */
export function fieldNodeFor(schema: z.ZodType): FieldNode {
  return toFieldNode(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema);
}
