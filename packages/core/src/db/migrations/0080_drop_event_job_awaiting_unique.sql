-- The rule 0061's index enforced lives on in 0078's narrower index. Dropping an index is quick;
-- it takes a short table lock that waits behind queries already running on event_jobs.
DROP INDEX IF EXISTS "idx_event_jobs_awaiting_unique";
