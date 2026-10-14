-- REVERSE of 0076 and 0077. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0077_event_job_fencing.sql
--
-- Then delete the 0076 and 0077 entries from drizzle.__drizzle_migrations so a later
-- `pnpm db:migrate` re-applies them cleanly.
--
-- Deploy the code from before 0076 FIRST: the code from 0076 on writes lock_token on every claim
-- and fails without the column. The code from before fences on locked_by and never names these
-- columns. What is lost: the tokens of jobs running at that moment, the wake times, and the
-- interruption counts. Dropping a nullable or defaulted column rewrites nothing.
DROP INDEX IF EXISTS "idx_event_jobs_unacknowledged_wake";--> statement-breakpoint
ALTER TABLE "event_jobs"
  DROP COLUMN IF EXISTS "interruption_count",
  DROP COLUMN IF EXISTS "wake_sent_time",
  DROP COLUMN IF EXISTS "lock_token";
