-- REVERSE of 0078 and 0079. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0079_event_job_open_question_index.sql
--
-- Then delete the 0078 and 0079 entries from drizzle.__drizzle_migrations so a later
-- `bun run db:migrate` re-applies them cleanly.
--
-- Deploy the code from before 0078 FIRST, and cancel or resume every paused chat message: the old
-- index allows one waiting job per event type and key, so it cannot be built while two paused
-- messages of one session wait for the same resume event.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_event_jobs_awaiting_unique"
  ON "event_jobs" ("workspace_id", "awaits_event_type", "awaits_subject_key")
  WHERE "job_status" = 'waiting';
DROP INDEX CONCURRENTLY IF EXISTS "idx_event_jobs_open_question_unique";
