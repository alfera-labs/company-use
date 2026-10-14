-- coworker-migration: no-transaction
-- The recovery sweep's index for 0076: "queued jobs whose worker was asked more than N seconds ago
-- and has not claimed them". event_jobs is hot, so the index is built CONCURRENTLY in its own
-- non-transactional migration, as 0074 does. Partial: only queued rows are ever asked about.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_event_jobs_unacknowledged_wake"
  ON "event_jobs" ("wake_sent_time")
  WHERE "job_status" = 'queued';
