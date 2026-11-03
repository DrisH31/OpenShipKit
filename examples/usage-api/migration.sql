-- The usage-billed API example's table (examples/usage-api/README.md, "Enable").
-- Each statement is IF NOT EXISTS: applying it twice changes nothing.
-- Only a key's SHA-256 is stored; a person's keys go with the person.
CREATE TABLE IF NOT EXISTS "example_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"name" text NOT NULL CHECK (char_length("name") BETWEEN 1 AND 60),
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL UNIQUE,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "example_api_keys_user_idx" ON "example_api_keys" ("user_id", "created_at" DESC);
