-- Ask, and the job that waits for the answer.
--
-- `policies` is the third answer to "may this run use this thing?", next to the registry default
-- and `resource_grants`: not may-it, but must-a-person-say-so-first. A row is an exception, so
-- absence keeps every workspace behaving exactly as it did before this migration.
--
-- The wait lives on `event_jobs` rather than in a table of its own. A run that stops on `ask` is
-- a job that has not run yet, and the queue already knows how to hold one, lock it, retry it, and
-- report it. A parallel `approval_requests` table would duplicate all of that and then disagree
-- with it. That is why `event_id` becomes nullable: a waiting job is created by a run, not by an
-- inbound event, and it adopts the event that later releases it.
--
-- Idempotent: every statement is safe to re-run. A development database can already carry these
-- objects from a hand-run of the design SQL, and re-running the migration must adopt them rather
-- than fail the whole file.
CREATE TABLE IF NOT EXISTS "policies" (
  "policy_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "policy_mode" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL,
  CONSTRAINT "policies_mode_check" CHECK ("policy_mode" IN ('allow','ask','never'))
);--> statement-breakpoint

-- One decision per (resource, scope). The gate reads this key directly, and the uniqueness is
-- what makes "set the policy" an upsert instead of a read-then-write race.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_policies_unique"
  ON "policies" USING btree ("workspace_id","resource_type","resource_id","scope_type","scope_id");--> statement-breakpoint

-- The two list views: everything one scope decided, and everyone who decided about one resource.
CREATE INDEX IF NOT EXISTS "idx_policies_scope"
  ON "policies" USING btree ("workspace_id","scope_type","scope_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_policies_resource"
  ON "policies" USING btree ("workspace_id","resource_type","resource_id");--> statement-breakpoint

-- A waiting job has no event yet. Dropping the NOT NULL is re-runnable as written.
ALTER TABLE "event_jobs" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "event_jobs" ADD COLUMN IF NOT EXISTS "awaits_event_type" text;--> statement-breakpoint
ALTER TABLE "event_jobs" ADD COLUMN IF NOT EXISTS "awaits_subject_key" text;--> statement-breakpoint

-- One wait per question. The subject key already hashes the run, the node, and the tool input, so
-- a re-asked question conflicts with the job that is already holding the run, and the insert can
-- do nothing instead of stacking a second prompt on the same person. Partial because a job that
-- is not waiting carries NULL here and must not collide with anything.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_event_jobs_awaiting_unique"
  ON "event_jobs" USING btree ("workspace_id","awaits_event_type","awaits_subject_key")
  WHERE "job_status" = 'waiting';--> statement-breakpoint

ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "resumed_from_job_id" text;--> statement-breakpoint

-- One resume per released job. A decision can arrive twice -- two clicks, a webhook retry, a
-- redelivered event -- and without this the second delivery starts a second run of the same tool.
-- Partial because ordinary runs all carry NULL here.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_runs_resumed_from_job_unique"
  ON "runs" USING btree ("workspace_id","resumed_from_job_id")
  WHERE "resumed_from_job_id" IS NOT NULL;
