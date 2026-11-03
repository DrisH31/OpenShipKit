DROP INDEX "usage_events_key_key";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_period_start" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "report_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "reported_at" timestamp (3) with time zone;--> statement-breakpoint
CREATE INDEX "usage_events_report_idx" ON "usage_events" USING btree ("created_at") WHERE report_pending;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_key_key" ON "usage_events" USING btree ("subject_type","subject_id","metric","key") WHERE key is not null;