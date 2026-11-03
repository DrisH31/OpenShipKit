-- The projects example's table (examples/projects/README.md, "Enable").
-- Each statement is IF NOT EXISTS: applying it twice changes nothing.
-- A project belongs to an organisation and goes with it; its creator may leave.
CREATE TABLE IF NOT EXISTS "example_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
	"name" text NOT NULL CHECK (char_length("name") BETWEEN 1 AND 80),
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "example_projects_org_idx" ON "example_projects" ("org_id", "created_at" DESC);
