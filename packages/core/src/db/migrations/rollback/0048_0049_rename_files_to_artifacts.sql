-- REVERSE of 0048 + 0049. Not run by the migration runner; apply by hand.
--
-- Why it exists: Cloud Run rollback is a traffic switch back to the previous revision, but
-- that revision reads `artifacts` / `artifact_id` / `output_artifact_id`. Without this file
-- the standard incident response for a bad deploy is "hand-write reverse SQL under
-- pressure", which is not a response.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0048_0049_rename_files_to_artifacts.sql
--
-- Then delete the 0048 and 0049 entries from drizzle.__drizzle_migrations so a later
-- `bun run db:migrate` re-applies them cleanly.
--
-- Renames only: no row is read or rewritten, so this is instant and lossless. Columns added
-- by 0047 (file_direction) and its indexes are left in place; they are additive and the old
-- code ignores them.
ALTER TABLE "tool_calls" RENAME COLUMN "output_file_id" TO "output_artifact_id";--> statement-breakpoint

ALTER TABLE "files" RENAME COLUMN "file_id" TO "artifact_id";--> statement-breakpoint
ALTER TABLE "files" RENAME COLUMN "file_purpose" TO "artifact_kind";--> statement-breakpoint
ALTER TABLE "files" RENAME COLUMN "file_status" TO "artifact_status";--> statement-breakpoint
ALTER TABLE "files" RENAME COLUMN "file_direction" TO "artifact_direction";--> statement-breakpoint
ALTER TABLE "files" RENAME COLUMN "file_metadata" TO "artifact_metadata";--> statement-breakpoint

ALTER INDEX IF EXISTS "idx_files_run" RENAME TO "idx_artifacts_run";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_files_source_tool_call" RENAME TO "idx_artifacts_source_tool_call";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_files_workspace_created" RENAME TO "idx_artifacts_workspace_created";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_files_pending_created" RENAME TO "idx_artifacts_pending_created";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_files_local_workspace_environment" RENAME TO "idx_artifacts_local_workspace_environment";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_files_workspace_session_created" RENAME TO "idx_artifacts_workspace_session_created";--> statement-breakpoint

ALTER TABLE "files" RENAME TO "artifacts";
