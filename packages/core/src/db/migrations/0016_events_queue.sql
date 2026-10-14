CREATE TABLE "events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "source" text NOT NULL,
  "source_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "subject_key" text NOT NULL,
  "actor_key" text NOT NULL,
  "event_body" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "event_status" text DEFAULT 'accepted' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_events_source_unique" ON "events" USING btree ("workspace_id","source","source_event_id");--> statement-breakpoint
CREATE INDEX "idx_events_subject_time" ON "events" USING btree ("workspace_id","subject_key","created_time");--> statement-breakpoint
CREATE INDEX "idx_events_status_time" ON "events" USING btree ("workspace_id","event_status","created_time");--> statement-breakpoint
CREATE TABLE "event_jobs" (
  "job_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "event_id" text NOT NULL,
  "subject_key" text NOT NULL,
  "job_handler" text NOT NULL,
  "job_status" text DEFAULT 'queued' NOT NULL,
  "available_time" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_by" text,
  "locked_until" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "run_id" text,
  "result_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE INDEX "idx_event_jobs_ready" ON "event_jobs" USING btree ("workspace_id","job_status","available_time","subject_key");--> statement-breakpoint
CREATE INDEX "idx_event_jobs_subject_status" ON "event_jobs" USING btree ("workspace_id","subject_key","job_status");--> statement-breakpoint
CREATE INDEX "idx_event_jobs_run" ON "event_jobs" USING btree ("workspace_id","run_id");
