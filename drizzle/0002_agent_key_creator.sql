ALTER TABLE "agent_keys" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_keys_created_by_idx" ON "agent_keys" USING btree ("created_by");