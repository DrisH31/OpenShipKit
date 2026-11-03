-- modules/ai — the daily free-quota ledger. One row per person per UTC day.
--
-- Apply it as a Drizzle custom migration (modules/ai/README.md, "Enable"):
--   npm run db:generate -- --custom --name ai_usage
--   cp modules/ai/migration.sql drizzle/<the new file>.sql
-- Idempotent (IF NOT EXISTS), so applying it twice is harmless.
--
-- The primary key is what makes reserve() atomic (INSERT … ON CONFLICT …
-- WHERE count < limit). CHECK (count >= 0) backs up the refund path's
-- greatest(count - 1, 0). Deleting a person deletes their rows.
-- The day index serves the sweep, which deletes by age across everyone (the
-- primary key leads with user_id and can't).

CREATE TABLE IF NOT EXISTS "ai_usage" (
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL CHECK ("count" >= 0),
	PRIMARY KEY ("user_id", "day")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_day_idx" ON "ai_usage" ("day");
