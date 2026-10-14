ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "external_identity_provider" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "external_identity_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_external_identity_unique" ON "users" USING btree ("external_identity_provider","external_identity_id") WHERE "external_identity_provider" IS NOT NULL AND "external_identity_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspaces_external_identity_unique" ON "workspaces" USING btree ("external_identity_provider","external_identity_id") WHERE "external_identity_provider" IS NOT NULL AND "external_identity_id" IS NOT NULL;
