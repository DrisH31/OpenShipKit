import "server-only";

//
// The API reference (ROADMAP 5.3): docs/api.md is generated from this file by
// `npm run docs:api`, and tests/api-reference.test.ts fails when the two drift.
//
// Two parts:
//   - HTTP endpoints: ENDPOINTS below, one entry per route handler under
//     src/app (the test fails on a route.ts with no entry, or an entry with no
//     route). A body that's validated with zod names that schema here, the
//     same one the handler parses, so a field can't change in one place only.
//   - MCP tools: every registered tool (src/server/mcp/tools), its scope, its
//     annotations and its input, straight from the tool's own zod schema.
//
// Fields are listed from the INPUT side of each schema (z.toJSONSchema with
// io: "input"): a field with a default is optional to the caller.
//

import { z } from "zod";
import { CONTACT_MESSAGE_MAX, CONTACT_TOPICS } from "@/components/site/contact-topics";
import { checkoutInputSchema, emailSchema, feedbackCreateSchema } from "@/core/schemas";
import { docHeadingId } from "./markdown";
import { toJsonSchema, type JsonSchema } from "./mcp/json-schema";
import { TOOLS } from "./mcp/tools";

export type Auth = "public" | "signed-in" | "admin" | "agent key" | "provider signature" | "Better Auth";

export interface Endpoint {
  /** The route file under src/app, which the test matches against the tree. */
  file: string;
  methods: string[];
  path: string;
  auth: Auth;
  summary: string;
  /** The request body (form post or JSON), when it's validated with zod. */
  body?: z.ZodType;
  /** Anything a caller needs that a schema can't say (content types, redirects, limits). */
  notes?: string;
}

/**
 * The contact endpoint's fields: name, email and message cut from feedbackCreateSchema, the schema
 * submitFeedback parses them with; topic from the form's own list. Anonymous callers must give an
 * email (submitFeedback refuses one without it), which the schema alone can't say: the notes do.
 */
const contactBody = feedbackCreateSchema
  .pick({ name: true, email: true, message: true })
  .extend({ topic: z.enum(CONTACT_TOPICS.map((t) => t.value) as [string, ...string[]]).optional().describe("Which kind of question; default general") });

export const ENDPOINTS: Endpoint[] = [
  {
    file: "src/app/api/health/route.ts",
    methods: ["GET", "HEAD"],
    path: "/api/health",
    auth: "public",
    summary: "Readiness: the database, the schema (current, behind, ahead or unknown), and whether background jobs keep up. 200 when ready, 503 when not.",
    notes: "JSON: { ok, data: { ok, ms }, schema: { ok, state }, jobs: { ok }, stack, version, time }. Never names or counts anyone.",
  },
  { file: "src/app/api/health/live/route.ts", methods: ["GET", "HEAD"], path: "/api/health/live", auth: "public", summary: "Liveness: 200 whenever the process answers, without touching the database." },
  {
    file: "src/app/api/billing/checkout/route.ts",
    methods: ["POST"],
    path: "/api/billing/checkout",
    auth: "signed-in",
    summary: "Start a checkout at the billing provider for a plan's price.",
    body: checkoutInputSchema,
    notes: "A form post gets a 303 to the provider's checkout; Accept: application/json gets { url }. Signed out: to sign-in first. A refusal (a second subscription, a plan already owned) is a 409 with its reason. Origin-checked and rate limited.",
  },
  {
    file: "src/app/api/billing/portal/route.ts",
    methods: ["POST"],
    path: "/api/billing/portal",
    auth: "signed-in",
    summary: "Open the billing provider's customer portal (Polar, Stripe) for your own billing.",
    notes: "303 to the portal. Razorpay has none: the billing page offers Cancel instead.",
  },
  {
    file: "src/app/api/billing/webhook/route.ts",
    methods: ["POST"],
    path: "/api/billing/webhook",
    auth: "provider signature",
    summary: "The billing provider's webhooks. Verified against the raw body, re-fetched from the provider, then applied.",
    notes: "404 while billing is off. docs/billing.md lists the events each provider must send.",
  },
  {
    file: "src/app/api/forms/contact/route.ts",
    methods: ["POST"],
    path: "/api/forms/contact",
    auth: "public",
    summary: "Send a message through the contact form, stored as feedback and copied to the site's contact email.",
    body: contactBody,
    notes: `Form post or JSON. \`email\` is required unless the caller is signed in (then it defaults to theirs). A message over ${CONTACT_MESSAGE_MAX} characters is a 413. JSON gets { ok } or { ok: false, error, message }; a form post a 303 to /contact?sent=1 or ?error=<code>. Origin-checked, rate limited, 64 KB body cap, a honeypot field.`,
  },
  {
    file: "src/app/api/forms/newsletter/route.ts",
    methods: ["POST"],
    path: "/api/forms/newsletter",
    auth: "public",
    summary: "Sign up to the email list.",
    body: z.object({ email: emailSchema.describe("The address to add"), redirect: z.string().optional().describe("The page the form was on, for the 303 back") }),
    notes: "Signing up twice isn't an error, and the answer never says whether the address was known. JSON gets { ok, status }.",
  },
  {
    file: "src/app/api/admin/media/route.ts",
    methods: ["POST"],
    path: "/api/admin/media",
    auth: "admin",
    summary: "Upload one image to the media library.",
    notes: "multipart/form-data with the image in `file`. JSON gets { ok: true, item } (201). Images only, sniffed from the bytes; SVG is refused.",
  },
  {
    file: "src/app/api/mcp/route.ts",
    methods: ["POST", "OPTIONS", "GET", "DELETE"],
    path: "/api/mcp",
    auth: "agent key",
    summary: "The MCP server (JSON-RPC over HTTP): the tools below, with `Authorization: Bearer <agent key>`.",
    notes: "Keys are minted in /admin/agents with a scope (read, write or admin). GET and DELETE answer 405 (no streaming sessions). Every method is 404 with OPENSHIPKIT_WITHOUT=mcp. docs/mcp.md.",
  },
  { file: "src/app/api/auth/[...auth]/route.ts", methods: ["GET", "POST"], path: "/api/auth/*", auth: "Better Auth", summary: "Sign-in, sign-up, sessions, two-factor and OAuth: Better Auth's own endpoints (docs/auth.md)." },
  { file: "src/app/api/demo/route.ts", methods: ["POST"], path: "/api/demo", auth: "public", summary: "\"Try the demo\": sign this browser in as the read-only demo admin. Only on the showcase (DEMO_ADMIN_EMAIL set)." },
  { file: "src/app/api/indexnow/[key]/route.ts", methods: ["GET"], path: "/:INDEXNOW_KEY.txt", auth: "public", summary: "The IndexNow key file (rewritten from the site root). 404 for any other name, or with IndexNow off." },
  { file: "src/app/admin/subscribers/export/route.ts", methods: ["GET"], path: "/admin/subscribers/export", auth: "admin", summary: "The email list as CSV. ?status=subscribed|unsubscribed.", notes: "Every cell is neutralised against spreadsheet formulas." },
  { file: "src/app/uploads/[...path]/route.ts", methods: ["GET", "HEAD"], path: "/uploads/:yyyy/:mm/:file", auth: "public", summary: "An uploaded image, from the disk or the bucket. Long-cached; 404 for anything that isn't one of ours." },
  { file: "src/app/(marketing)/blog/rss.xml/route.ts", methods: ["GET"], path: "/blog/rss.xml", auth: "public", summary: "The blog's RSS feed. 404 with OPENSHIPKIT_WITHOUT=blog." },
  { file: "src/app/(marketing)/changelog/rss.xml/route.ts", methods: ["GET"], path: "/changelog/rss.xml", auth: "public", summary: "The changelog's RSS feed." },
  { file: "src/app/(marketing)/blog/[slug]/og/route.ts", methods: ["GET"], path: "/blog/:slug/og", auth: "public", summary: "A post's Open Graph image (PNG)." },
  { file: "src/app/(marketing)/changelog/[slug]/og/route.ts", methods: ["GET"], path: "/changelog/:slug/og", auth: "public", summary: "A release's Open Graph image (PNG)." },
  { file: "src/app/llms.txt/route.ts", methods: ["GET"], path: "/llms.txt", auth: "public", summary: "A map of the site for language models: key pages, the newest posts and releases, legal pages." },
  { file: "src/app/llms-full.txt/route.ts", methods: ["GET"], path: "/llms-full.txt", auth: "public", summary: "The full text of every published post, release note and page." },
];

type Prop = JsonSchema & { type?: string | string[]; description?: string; enum?: unknown[]; anyOf?: Prop[]; items?: Prop; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; default?: unknown; format?: string };

/** A JSON Schema property as one table cell's type: "string", "pro | free", "string[]", "number | null". */
function typeOf(p: Prop): string {
  if (p.enum) return p.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (p.anyOf) return p.anyOf.map(typeOf).join(" | ");
  if (p.type === "array") return `${p.items ? typeOf(p.items) : "any"}[]`;
  if (Array.isArray(p.type)) return p.type.join(" | ");
  if (p.type === "integer") return "integer";
  if (p.format === "email") return "email";
  return p.type ?? "any";
}

/** Limits and defaults, in words: "1–60 characters", "≥ 0", "default false". */
function constraints(p: Prop): string {
  const out: string[] = [];
  if (p.minLength !== undefined || p.maxLength !== undefined) out.push(p.minLength ? `${p.minLength}–${p.maxLength ?? "∞"} characters` : `up to ${p.maxLength} characters`);
  if (p.minimum !== undefined || p.maximum !== undefined) out.push(p.minimum !== undefined && p.maximum !== undefined ? `${p.minimum}–${p.maximum}` : p.minimum !== undefined ? `≥ ${p.minimum}` : `≤ ${p.maximum}`);
  if (p.default !== undefined) out.push(`default ${JSON.stringify(p.default)}`);
  return out.join("; ");
}

/** One table cell: pipes escaped, one line, and a bare "<" outside code spans kept from reading as HTML. */
const cell = (s: string) =>
  s
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replace(/</g, "&lt;")))
    .join("")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();

/** A schema's top-level fields as a Markdown table. */
function fieldsTable(schema: JsonSchema): string[] {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const keys = Object.keys(props);
  if (!keys.length) return ["No arguments."];
  return [
    "| Field | Type | Required | Notes |",
    "|---|---|---|---|",
    ...keys.map((k) => {
      const p = props[k];
      const notes = [p.description, constraints(p)].filter(Boolean).join(". ");
      return `| \`${k}\` | ${cell(typeOf(p))} | ${required.has(k) ? "yes" : ""} | ${cell(notes)} |`;
    }),
  ];
}

/** A heading's id as the /docs pages make it (the one rule: src/server/markdown.ts). */
const anchor = docHeadingId;

/** docs/api.md, in full. Deterministic: the same code gives the same file. */
export function renderApiReference(): string {
  const lines: string[] = [
    "# API reference",
    "",
    "<!-- Generated by `npm run docs:api` from src/server/api-reference.ts and the MCP tools' own schemas. Don't edit by hand: tests/api-reference.test.ts fails when this file and the code disagree. -->",
    "",
    "Every HTTP endpoint the app answers, and every tool its MCP server offers. Request fields come from the zod schemas the code validates with, and the test that keeps this file current also checks each endpoint's methods against its handler.",
    "",
    "## HTTP endpoints",
    "",
    "| Method | Path | Who | What |",
    "|---|---|---|---|",
    ...ENDPOINTS.map((e) => `| ${e.methods.join(", ")} | [\`${e.path}\`](#${anchor(`${e.methods[0]} ${e.path}`)}) | ${e.auth} | ${cell(e.summary)} |`),
    "",
  ];
  for (const e of ENDPOINTS) {
    lines.push(`### ${e.methods[0]} ${e.path}`, "", cell(e.summary), "", `**Who:** ${e.auth}. **Methods:** ${e.methods.join(", ")}.`, "");
    if (e.body) lines.push("**Body** (form post or JSON):", "", ...fieldsTable(toJsonSchema(e.body)), "");
    if (e.notes) lines.push(cell(e.notes), "");
  }
  lines.push(
    "## MCP tools",
    "",
    "Called with `tools/call` on `/api/mcp`. **Scope** is the least agent-key scope that may call it (read < write < admin). **Kind** comes from the tool's annotations: read-only, idempotent write (repeating it changes nothing more), additive write (each call adds something), or destructive. [mcp.md](mcp.md) explains keys and clients.",
    "",
    "| Tool | Scope | Kind | What |",
    "|---|---|---|---|",
  );
  const kind = (t: (typeof TOOLS)[number]) =>
    t.annotations.readOnlyHint ? "read-only" : t.annotations.destructiveHint ? "destructive" : t.annotations.idempotentHint ? "idempotent write" : "additive write";
  const sorted = [...TOOLS].sort((a, b) => a.name.localeCompare(b.name));
  lines.push(...sorted.map((t) => `| [\`${t.name}\`](#${anchor(t.name)}) | ${t.scope} | ${kind(t)} | ${cell(t.title)} |`), "");
  for (const t of sorted) {
    lines.push(`### ${t.name}`, "", cell(t.description), "", `**Scope:** ${t.scope}. **Kind:** ${kind(t)}.`, "", ...fieldsTable(toJsonSchema(t.input)), "");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
