ALTER TABLE "subscriptions" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "seats" integer;--> statement-breakpoint
CREATE INDEX "subscriptions_org_idx" ON "subscriptions" USING btree ("org_id") WHERE org_id is not null;