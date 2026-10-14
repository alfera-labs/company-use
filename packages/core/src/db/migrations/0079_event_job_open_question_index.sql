-- coworker-migration: no-transaction
-- Paused chat messages: a stop parks every queued message of a session as a waiting job on the
-- same resume event (`session.queue_resumed` on `session:<id>`), so many jobs wait for one event.
-- The old unique index (0061) allowed one waiting job per event type and key. It exists to make a
-- question asked twice join the question already open, and only the question handler
-- (`policy_decision_resume`) relies on that, so the new index keeps that rule for it alone.
--
-- event_jobs is hot, so the new index is built CONCURRENTLY in its own non-transactional
-- migration. 0079 drops the old index after this one exists, so the rule never lapses.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_event_jobs_open_question_unique"
  ON "event_jobs" ("workspace_id", "awaits_event_type", "awaits_subject_key")
  WHERE "job_status" = 'waiting' AND "job_handler" = 'policy_decision_resume';
