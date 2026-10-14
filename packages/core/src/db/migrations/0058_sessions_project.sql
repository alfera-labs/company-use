-- Which project a conversation happens in.
--
-- This is the column that makes the permission gate real: without it a run has no project, so
-- `build_participants` can only return an empty project list, and every project-restricted
-- resource would be denied by the no-participant guard.
--
-- NULL is legal and means "not in a project" — which is exactly what every conversation is
-- today, so every existing row stays valid and nothing is backfilled. A session with no project
-- reaches whatever the workspace shares, which is the behaviour that shipped before projects.
--
-- Placement is a single-valued fact about the row, so it is a column. It deliberately does NOT
-- spread to runs, run_messages, or tool_calls: those reach it through session_id, and a copy
-- would be a second source of truth that can disagree.
--
-- Idempotent: every statement is safe to re-run.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint

-- "Everything that happened in this project." Partial because the column is NULL on every
-- conversation that predates projects, and on every one that never joins a project.
CREATE INDEX IF NOT EXISTS "idx_sessions_project"
  ON "sessions" USING btree ("workspace_id","project_id")
  WHERE "project_id" IS NOT NULL;
