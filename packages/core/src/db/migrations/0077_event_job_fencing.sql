-- The job table learns to fence a claim, to remember when a worker was asked to run a job, and to
-- tell an interruption from a failure.
--
-- 1. lock_token is new on every claim. Every later write on a claimed job names it, so a worker
--    whose lease expired and was reclaimed changes no row.
-- 2. wake_sent_time is when the worker was last asked to run a queued job. The recovery sweep
--    asks again for queued jobs whose ask is old. Its index is in 0077, built CONCURRENTLY.
-- 3. interruption_count counts the times a worker stopped holding a job without a result: a crash
--    or a deploy. An interruption does not spend an attempt.
--
-- The code now calls subject_key "queue_key". That rename is in TypeScript only: the drizzle
-- field maps onto the subject_key column, so no table is rewritten.
--
-- All three columns are nullable or have a constant default, so PostgreSQL adds them without a
-- table rewrite: the ACCESS EXCLUSIVE lock is held for milliseconds.
ALTER TABLE "event_jobs"
  ADD COLUMN IF NOT EXISTS "lock_token" uuid,
  ADD COLUMN IF NOT EXISTS "wake_sent_time" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "interruption_count" integer DEFAULT 0 NOT NULL;
