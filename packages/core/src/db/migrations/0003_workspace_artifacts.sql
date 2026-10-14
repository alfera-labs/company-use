ALTER TABLE "tool_calls" ADD COLUMN "risk_class" text;
--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "approval_mode" text;
--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "output_artifact_id" text;
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text,
	"run_id" text,
	"runtime_environment_id" text,
	"source_tool_call_id" text,
	"artifact_kind" text DEFAULT 'file' NOT NULL,
	"artifact_status" text DEFAULT 'ready' NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"workspace_path" text,
	"file_name" text,
	"mime_type" text,
	"byte_size" integer,
	"checksum_sha256" text,
	"content_preview" text,
	"is_visible" boolean DEFAULT true NOT NULL,
	"artifact_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "artifacts_kind_check" CHECK (artifact_kind IN ('file', 'tool_output', 'screenshot', 'download', 'log')),
	CONSTRAINT "artifacts_status_check" CHECK (artifact_status IN ('ready', 'missing', 'deleted', 'failed')),
	CONSTRAINT "artifacts_storage_provider_check" CHECK (storage_provider IN ('local_workspace', 'blob'))
);
--> statement-breakpoint
CREATE INDEX "idx_artifacts_run" ON "artifacts" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "idx_artifacts_source_tool_call" ON "artifacts" USING btree ("source_tool_call_id");
--> statement-breakpoint
CREATE INDEX "idx_artifacts_workspace_created" ON "artifacts" USING btree ("workspace_id","created_time");
