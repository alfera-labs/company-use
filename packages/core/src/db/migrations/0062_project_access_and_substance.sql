ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_access" text DEFAULT 'members' NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_workspace_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_description" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_instructions" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_access_check') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_access_check"
      CHECK ("project_access" IN ('private','members','workspace'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_private_owner_check') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_private_owner_check"
      CHECK ("project_access" <> 'private' OR "personal_for_user_id" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_personal_access_check') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_personal_access_check"
      CHECK ("personal_for_user_id" IS NULL OR "project_access" = 'private') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_workspace_default_access_check'
  ) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_default_access_check"
      CHECK (NOT "is_workspace_default" OR "project_access" = 'workspace');
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_workspace_default_unique"
  ON "projects" USING btree ("workspace_id") WHERE "is_workspace_default";
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "project_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_artifacts_project"
  ON "artifacts" USING btree ("workspace_id","project_id") WHERE "project_id" IS NOT NULL;
