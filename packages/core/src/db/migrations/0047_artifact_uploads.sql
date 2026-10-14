-- Artifacts become the platform's one byte catalog for BOTH directions: agent output
-- (already here) and files a person hands us (chat uploads, Slack files). No new table —
-- artifacts already carries storage_provider, storage_key, checksum, size and status.
--
-- Two additions:
--   1. artifact_direction, because "did a person upload this?" is not derivable:
--      source_tool_call_id is null for a Slack file too, and created_by is a system actor
--      there. The files list needs it to say Uploaded vs Created.
--   2. Three indexes for queries that previously had none: the abandoned-upload sweep,
--      the rescue scan for bytes still stranded in a sandbox, and the per-session list.
--
-- The TypeScript names for this table say `file`; the columns keep saying `artifact`. The
-- mapping lives in db/schema/core.ts, which explains why: renaming the columns would break
-- the previous API revision during its own rollout.
--
-- Idempotent: every statement is safe to re-run.
ALTER TABLE "artifacts"
  ADD COLUMN IF NOT EXISTS "artifact_direction" text NOT NULL DEFAULT 'outbound';--> statement-breakpoint

-- Existing rows are all agent-produced (the only writer was the tool service), except
-- memory-import archives, which a person uploaded.
UPDATE "artifacts"
SET "artifact_direction" = 'inbound'
WHERE "artifact_kind" = 'memory_import_archive'
  AND "artifact_direction" <> 'inbound';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_artifacts_pending_created"
  ON "artifacts" USING btree ("created_time")
  WHERE "artifact_status" = 'pending';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_artifacts_local_workspace_environment"
  ON "artifacts" USING btree ("runtime_environment_id")
  WHERE "storage_provider" = 'local_workspace';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_artifacts_workspace_session_created"
  ON "artifacts" USING btree ("workspace_id","session_id","created_time");
