CREATE TABLE "run_events" (
	"run_event_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"event_sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_label" text,
	"event_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "run_events_type_check" CHECK (event_type IN ('start', 'progress', 'message', 'error', 'end'))
);
--> statement-breakpoint
CREATE TABLE "run_model_context_snapshots" (
	"run_model_context_snapshot_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"snapshot_kind" text NOT NULL,
	"snapshot_sequence" integer DEFAULT 1 NOT NULL,
	"model_provider" text,
	"model_name" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"tool_count" integer DEFAULT 0 NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "run_model_context_snapshots_kind_check" CHECK (snapshot_kind IN ('runtime_context', 'engine_input', 'provider_payload', 'compaction'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_run_events_run_sequence_unique" ON "run_events" USING btree ("run_id","event_sequence");
--> statement-breakpoint
CREATE INDEX "idx_run_events_run" ON "run_events" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "idx_run_events_workspace_created" ON "run_events" USING btree ("workspace_id","created_time");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_run_model_context_snapshots_run_kind_sequence_unique" ON "run_model_context_snapshots" USING btree ("run_id","snapshot_kind","snapshot_sequence");
--> statement-breakpoint
CREATE INDEX "idx_run_model_context_snapshots_run" ON "run_model_context_snapshots" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "idx_run_model_context_snapshots_workspace_created" ON "run_model_context_snapshots" USING btree ("workspace_id","created_time");
--> statement-breakpoint
INSERT INTO "run_events" (
	"run_event_id",
	"workspace_id",
	"session_id",
	"run_id",
	"event_sequence",
	"event_type",
	"event_label",
	"event_payload",
	"event_metadata",
	"created_time",
	"last_updated_time",
	"created_by",
	"last_updated_by"
)
SELECT
	'evt_legacy_' || "run_message_id",
	"workspace_id",
	"session_id",
	"run_id",
	"message_sequence",
	COALESCE("message_content"->'data'->>'event_type', 'progress'),
	"content_text",
	"message_content",
	COALESCE("message_content"->'data'->'metadata', '{}'::jsonb),
	"created_time",
	"last_updated_time",
	"created_by",
	"last_updated_by"
FROM "run_messages"
WHERE "message_role" = 'event'
	AND "run_id" IS NOT NULL
	AND COALESCE("message_content"->'data'->>'event_type', 'progress') IN ('start', 'progress', 'message', 'error', 'end')
ON CONFLICT DO NOTHING;
