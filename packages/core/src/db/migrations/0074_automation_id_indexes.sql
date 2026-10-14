-- coworker-migration: no-transaction
-- The two automation lookups on tables that are already large and hot: every run of every workspace
-- lands in "runs", and the ingress reads "triggers" on every fire. A plain CREATE INDEX takes an
-- ACCESS EXCLUSIVE lock and would stall both for as long as the build takes, so these are built
-- CONCURRENTLY in their own non-transactional migration (0073 adds the columns themselves).
--
-- Both are partial: rows without an automation_id are every trigger and every chat that predates
-- automations, which is nearly all of them, and nothing ever asks this question about them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_runs_automation_time"
  ON "runs" ("workspace_id", "automation_id", "created_time" DESC)
  WHERE "automation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_triggers_automation"
  ON "triggers" ("workspace_id", "automation_id")
  WHERE "automation_id" IS NOT NULL;
