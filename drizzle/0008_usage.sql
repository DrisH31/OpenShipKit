CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"quantity" bigint NOT NULL,
	"key" text,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_subject_check" CHECK ("usage_events"."subject_type" in ('user', 'org')),
	CONSTRAINT "usage_events_quantity_check" CHECK ("usage_events"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "limits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_events_sum_idx" ON "usage_events" USING btree ("subject_type","subject_id","metric","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_key_key" ON "usage_events" USING btree ("subject_type","subject_id","key") WHERE key is not null;