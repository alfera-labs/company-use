CREATE TABLE "agent_nodes" (
	"agent_node_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"node_id" text NOT NULL,
	"connection_id" text,
	"agent_node_status" text DEFAULT 'enabled' NOT NULL,
	"instance_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "agent_nodes_status_check" CHECK (agent_node_status IN ('enabled', 'disabled', 'error'))
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS user_id_sequence START 1;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS workspace_id_sequence START 1;--> statement-breakpoint
CREATE TABLE "runtime_environments" (
	"runtime_environment_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text,
	"session_id" text,
	"environment_provider" text NOT NULL,
	"environment_status" text NOT NULL,
	"provider_environment_id" text,
	"workspace_mount_key" text,
	"root_path" text DEFAULT '/work' NOT NULL,
	"last_started_time" timestamp with time zone,
	"last_stopped_time" timestamp with time zone,
	"last_heartbeat_time" timestamp with time zone,
	"environment_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"environment_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "runtime_environments_provider_check" CHECK (environment_provider IN ('local', 'docker', 'modal', 'daytona', 'e2b', 'cloudflare', 'fly', 'opencomputer')),
	CONSTRAINT "runtime_environments_status_check" CHECK (environment_status IN ('pending', 'starting', 'running', 'idle', 'stopping', 'stopped', 'failed', 'destroyed'))
);
--> statement-breakpoint
ALTER TABLE "run_messages" DROP CONSTRAINT "run_messages_role_check";--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_status_check";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_status_check";--> statement-breakpoint
ALTER TABLE "tool_calls" DROP CONSTRAINT "tool_calls_status_check";--> statement-breakpoint
ALTER TABLE "triggers" DROP CONSTRAINT "triggers_type_check";--> statement-breakpoint
ALTER TABLE "triggers" DROP CONSTRAINT "triggers_status_check";--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_kind_check";--> statement-breakpoint
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_role_check";--> statement-breakpoint
ALTER TABLE "triggers" ALTER COLUMN "trigger_status" SET DEFAULT 'enabled';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_id" SET DEFAULT 'user_' || nextval('user_id_sequence')::text;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "workspace_id" SET DEFAULT 'ws_' || nextval('workspace_id_sequence')::text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_slug" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
WITH "numbered_workspace_agents" AS (
	SELECT
		"agent_id",
		ROW_NUMBER() OVER (
			PARTITION BY "workspace_id"
			ORDER BY "created_time", "agent_id"
		) AS "agent_slug_position"
	FROM "agents"
)
UPDATE "agents"
SET "agent_slug" = CASE
	WHEN "numbered_workspace_agents"."agent_slug_position" = 1 THEN 'main'
	ELSE 'main-' || "numbered_workspace_agents"."agent_slug_position"::text
END
FROM "numbered_workspace_agents"
WHERE "agents"."agent_id" = "numbered_workspace_agents"."agent_id";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_kind" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "system_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "default_model" text DEFAULT 'gpt-5.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "node_runtime" text DEFAULT 'native_tool' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "message_kind" text DEFAULT 'status' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "content_text" text;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "content_json" jsonb;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "tool_call_id" text;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "token_count" integer;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "is_visible_to_user" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "run_reason" text DEFAULT 'user_message' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "provider_name" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cost_microcents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "finished_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "run_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "session_source" text DEFAULT 'dashboard' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "external_thread_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "context_summary" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "summarized_until_message_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_run_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "locked_by_run_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "lock_expires_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "runtime_environment_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_message_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_message_preview" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "session_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "input_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "output_json" jsonb;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "output_text" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "tool_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "finished_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "trigger_name" text DEFAULT 'Untitled trigger' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "provider_name" text;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "cost_microcents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "usage_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_nodes_agent_node_unique" ON "agent_nodes" USING btree ("agent_id","node_id");--> statement-breakpoint
CREATE INDEX "idx_agent_nodes_workspace_agent" ON "agent_nodes" USING btree ("workspace_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_environments_workspace" ON "runtime_environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_environments_session" ON "runtime_environments" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agents_workspace_slug_unique" ON "agents" USING btree ("workspace_id","agent_slug");--> statement-breakpoint
CREATE INDEX "idx_run_messages_workspace_created" ON "run_messages" USING btree ("workspace_id","created_time");--> statement-breakpoint
CREATE INDEX "idx_runs_workspace_status_created" ON "runs" USING btree ("workspace_id","run_status","created_time");--> statement-breakpoint
CREATE INDEX "idx_sessions_status_updated" ON "sessions" USING btree ("workspace_id","session_status","last_updated_time");--> statement-breakpoint
CREATE INDEX "idx_sessions_locked_by_run" ON "sessions" USING btree ("locked_by_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sessions_external_thread_unique" ON "sessions" USING btree ("workspace_id","agent_id","session_source","external_thread_key") WHERE "sessions"."external_thread_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tool_calls_workspace_tool_created" ON "tool_calls" USING btree ("workspace_id","tool_name","created_time");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_workspace_status_created" ON "tool_calls" USING btree ("workspace_id","tool_status","created_time");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_kind_check" CHECK (agent_kind IN ('main', 'specialist', 'system'));--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_runtime_check" CHECK (node_runtime IN ('native_tool', 'connected_app', 'mcp_tool', 'sandbox_tool', 'harness_tool', 'browser_tool'));--> statement-breakpoint
ALTER TABLE "run_messages" ADD CONSTRAINT "run_messages_kind_check" CHECK (message_kind IN ('input', 'output', 'progress', 'reasoning_summary', 'tool_request', 'tool_result', 'status', 'summary', 'error'));--> statement-breakpoint
ALTER TABLE "run_messages" ADD CONSTRAINT "run_messages_role_check" CHECK (message_role IN ('system', 'user', 'assistant', 'tool', 'event', 'error', 'tool_result'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_reason_check" CHECK (run_reason IN ('user_message', 'trigger', 'api', 'retry', 'continue', 'system'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_status_check" CHECK (run_status IN ('queued', 'starting', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'expired'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_source_check" CHECK (session_source IN ('dashboard', 'slack', 'api', 'trigger', 'system'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_status_check" CHECK (session_status IN ('active', 'idle', 'running', 'closed', 'failed', 'cancelled', 'waiting', 'completed', 'archived'));--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_status_check" CHECK (tool_status IN ('pending', 'running', 'requested', 'validated', 'executing', 'completed', 'failed', 'blocked', 'timed_out', 'cancelled'));--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_type_check" CHECK (trigger_type IN ('api_event', 'manual', 'slack_event', 'slack_mention', 'slack_channel', 'webhook', 'schedule', 'system_event'));--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_status_check" CHECK (trigger_status IN ('enabled', 'disabled', 'error', 'active', 'paused', 'deleted'));--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_kind_check" CHECK (usage_kind IN ('llm_tokens', 'runtime_seconds', 'tool_call', 'browser_seconds', 'browser_minutes', 'storage_bytes', 'custom', 'message'));--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_role_check" CHECK (member_role IN ('owner', 'admin', 'member', 'viewer'));
