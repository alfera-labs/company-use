CREATE TABLE IF NOT EXISTS "automations" (
	"automation_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"automation_name" text NOT NULL,
	"automation_status" text DEFAULT 'enabled' NOT NULL,
	"instruction" text NOT NULL,
	"instruction_version" integer DEFAULT 1 NOT NULL,
	"uses_tools" jsonb DEFAULT '{"apps":[]}'::jsonb NOT NULL,
	"run_policy" jsonb DEFAULT '{"subject_from":null,"when_a_run_is_already_going":"wait_for_it_to_finish"}'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"judge" jsonb,
	"created_via" text DEFAULT 'user' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automations_workspace_status_updated" ON "automations" ("workspace_id","automation_status","last_updated_time" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automations_workspace_agent" ON "automations" ("workspace_id","agent_id","created_via","automation_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_events_type_time" ON "events" ("workspace_id","event_type","created_time");
--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN IF NOT EXISTS "automation_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "automation_id" text;
