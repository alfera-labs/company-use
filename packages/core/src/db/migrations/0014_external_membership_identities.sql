ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "external_identity_provider" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "external_identity_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspace_members_external_identity_unique" ON "workspace_members" USING btree ("external_identity_provider","external_identity_id") WHERE "external_identity_provider" IS NOT NULL AND "external_identity_id" IS NOT NULL;
