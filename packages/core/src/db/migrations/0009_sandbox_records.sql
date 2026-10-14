CREATE TABLE "sandboxes" (
	"sandbox_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text,
	"session_id" text,
	"runtime_environment_id" text,
	"sandbox_provider" text NOT NULL,
	"sandbox_status" text DEFAULT 'pending' NOT NULL,
	"provider_sandbox_id" text,
	"provider_template_id" text,
	"workspace_mount_key" text NOT NULL,
	"root_path" text DEFAULT '/work' NOT NULL,
	"working_directory" text DEFAULT '/work/repo' NOT NULL,
	"sandbox_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sandbox_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_started_time" timestamp with time zone,
	"last_paused_time" timestamp with time zone,
	"last_stopped_time" timestamp with time zone,
	"last_heartbeat_time" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_time" timestamp with time zone,
	"created_by" text,
	"last_updated_by" text,
	"deleted_by" text
);
--> statement-breakpoint
CREATE INDEX "idx_sandboxes_workspace" ON "sandboxes" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_sandboxes_session" ON "sandboxes" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "idx_sandboxes_runtime_environment" ON "sandboxes" USING btree ("runtime_environment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sandboxes_provider_mount_unique" ON "sandboxes" USING btree ("workspace_id","sandbox_provider","workspace_mount_key");
