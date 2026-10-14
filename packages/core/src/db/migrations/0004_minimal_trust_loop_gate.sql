ALTER TABLE "run_events" ADD COLUMN "tool_call_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cost_microcents_estimate" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "context_compile_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "engine_first_event_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "model_total_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tool_total_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "db_write_total_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "total_run_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "eval_reports" (
	"eval_report_id" text PRIMARY KEY NOT NULL,
	"suite_name" text NOT NULL,
	"task_source" text NOT NULL,
	"task_id" text NOT NULL,
	"run_id" text NOT NULL,
	"runtime_environment_id" text,
	"harness_name" text DEFAULT 'coworker' NOT NULL,
	"harness_version" text NOT NULL,
	"runtime_version" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_microcents" bigint DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"trace_pointer" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "eval_reports_task_source_check" CHECK ("task_source" IN ('internal', 'swe_bench', 'terminal_bench')),
	CONSTRAINT "eval_reports_status_check" CHECK ("status" IN ('pass', 'fail', 'error'))
);--> statement-breakpoint
CREATE INDEX "idx_run_events_tool_call" ON "run_events" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "idx_eval_reports_suite_runtime_created" ON "eval_reports" USING btree ("suite_name","runtime_version","created_time");--> statement-breakpoint
CREATE INDEX "idx_eval_reports_task_created" ON "eval_reports" USING btree ("task_id","created_time");--> statement-breakpoint
CREATE INDEX "idx_eval_reports_failure_created" ON "eval_reports" USING btree ("failure_reason","created_time");--> statement-breakpoint
CREATE INDEX "idx_eval_reports_run" ON "eval_reports" USING btree ("run_id");--> statement-breakpoint
-- Invariant:
-- "eval_reports has exactly one row per (suite_name, task_id, run_id)".
CREATE UNIQUE INDEX "idx_eval_reports_suite_task_run_unique" ON "eval_reports" USING btree ("suite_name","task_id","run_id");
