-- A run that stopped on a question, and the question's deadline.
--
-- 0058 gave the wait a place to live. It left out the other half: what happens to the run and to
-- the call while a person is being asked. Without these four statements a held call is stored as
-- `failed`, the run is stored as `completed`, and the chat has nothing true to show.
--
-- Idempotent: every statement is safe to re-run.

-- Which wait is holding this run. The reverse link -- the wait already names its run inside its
-- payload -- cannot answer "is this chat waiting, and on what" without unpacking jsonb per row,
-- and that is the read the chat does on every poll. `resumed_from_job_id` (0058) points the same
-- direction: from the domain row to the queue row that caused it.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "waiting_on_job_id" text;--> statement-breakpoint

-- "What is this workspace waiting on right now." Partial because a waiting run is the rare one.
CREATE INDEX IF NOT EXISTS "idx_runs_waiting"
  ON "runs" USING btree ("workspace_id","last_updated_time")
  WHERE "run_status" = 'waiting';--> statement-breakpoint

-- Two states a tool call could not be in before.
--   awaiting_approval  held. It has not run, it has not failed, and it still might do either.
--   denied             a person said no. Refusing is an answer, not a fault.
-- `blocked` stays what it always was: a policy said never, and nobody is being asked.
ALTER TABLE "tool_calls" DROP CONSTRAINT IF EXISTS "tool_calls_status_check";--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_status_check" CHECK (tool_status IN (
  'pending','running','requested','validated','executing',
  'completed','failed','blocked','timed_out','cancelled',
  'awaiting_approval','denied'
));--> statement-breakpoint

-- When to stop waiting. A wait with no deadline is a hang: `job_status = 'waiting'` is invisible
-- to both claim queries, so nothing would ever look at the row again. Nullable, because a wait
-- that genuinely has no deadline is legal and must not be swept.
ALTER TABLE "event_jobs" ADD COLUMN IF NOT EXISTS "awaits_until_time" timestamp with time zone;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_event_jobs_awaits_expiry"
  ON "event_jobs" USING btree ("awaits_until_time")
  WHERE "job_status" = 'waiting';
