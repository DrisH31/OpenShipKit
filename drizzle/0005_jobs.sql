CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp (3) with time zone,
	"last_error" text,
	"key" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	CONSTRAINT "jobs_status_check" CHECK (status in ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "jobs_attempts_check" CHECK (attempts >= 0 and max_attempts >= 1)
);
--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("run_at","id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_key_unfinished_key" ON "jobs" USING btree ("key") WHERE key is not null and status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "jobs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "jobs_finished_idx" ON "jobs" USING btree ("finished_at") WHERE finished_at is not null;