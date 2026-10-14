-- The memory-import feature adds NO schema: the grant lives as the
-- memory_import_grant JSONB key on workspaces.workspace_data, and each
-- archive's grant link lives as the import_grant_id key in
-- artifacts.artifact_metadata. This migration only cleans up environments
-- that ran an earlier version of this file (which created an import_grants
-- table and an artifacts.import_grant_id column); everywhere else, including
-- prod, every statement is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'artifacts' AND column_name = 'import_grant_id'
  ) THEN
    UPDATE artifacts
    SET artifact_metadata = jsonb_set(
      COALESCE(artifact_metadata, '{}'::jsonb),
      '{import_grant_id}',
      to_jsonb(import_grant_id)
    )
    WHERE import_grant_id IS NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_artifacts_import_grant";--> statement-breakpoint
ALTER TABLE "artifacts" DROP COLUMN IF EXISTS "import_grant_id";--> statement-breakpoint
DROP TABLE IF EXISTS "import_grants";
