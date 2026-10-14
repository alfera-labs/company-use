CREATE TABLE "agents" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"agent_description" text,
	"agent_status" text DEFAULT 'active' NOT NULL,
	"system_instructions" text NOT NULL,
	"default_model_provider" text,
	"default_model_name" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "agents_status_check" CHECK (agent_status IN ('active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"app_id" text PRIMARY KEY NOT NULL,
	"app_slug" text NOT NULL,
	"app_name" text NOT NULL,
	"app_category" text,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"app_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "apps_auth_type_check" CHECK (auth_type IN ('none', 'api_key', 'oauth2', 'internal')),
	CONSTRAINT "apps_status_check" CHECK (app_status IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"billing_plan_id" text PRIMARY KEY NOT NULL,
	"plan_slug" text NOT NULL,
	"plan_name" text NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id" text,
	"billing_interval" text DEFAULT 'month' NOT NULL,
	"monthly_price_cents" integer,
	"included_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "billing_plans_interval_check" CHECK (billing_interval IN ('month', 'year')),
	CONSTRAINT "billing_plans_status_check" CHECK (plan_status IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"app_id" text NOT NULL,
	"connection_name" text,
	"connection_status" text DEFAULT 'pending' NOT NULL,
	"credentials" jsonb,
	"credential_expiry_time" timestamp with time zone,
	"external_account_id" text,
	"external_account_name" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "connections_status_check" CHECK (connection_status IN ('active', 'pending', 'expired', 'revoked', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"node_id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"node_slug" text NOT NULL,
	"node_name" text NOT NULL,
	"node_kind" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb,
	"approval_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"runtime_handler" text NOT NULL,
	"node_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "nodes_kind_check" CHECK (node_kind IN ('action', 'query', 'trigger', 'tool')),
	CONSTRAINT "nodes_status_check" CHECK (node_status IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "run_messages" (
	"run_message_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text,
	"message_role" text NOT NULL,
	"message_content" jsonb NOT NULL,
	"source_type" text DEFAULT 'runtime' NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message_sequence" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "run_messages_role_check" CHECK (message_role IN ('user', 'assistant', 'system', 'tool_result', 'event')),
	CONSTRAINT "run_messages_source_type_check" CHECK (source_type IN ('dashboard', 'slack', 'api', 'runtime', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"trigger_id" text,
	"run_status" text DEFAULT 'queued' NOT NULL,
	"trigger_type" text DEFAULT 'user_message' NOT NULL,
	"model_provider" text,
	"model_name" text,
	"started_time" timestamp with time zone,
	"completed_time" timestamp with time zone,
	"error_message" text,
	"usage_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "runs_status_check" CHECK (run_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "runs_trigger_type_check" CHECK (trigger_type IN ('user_message', 'slack_event', 'schedule', 'api', 'manual_retry'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_title" text,
	"session_status" text DEFAULT 'active' NOT NULL,
	"source_type" text DEFAULT 'dashboard' NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "sessions_status_check" CHECK (session_status IN ('active', 'waiting', 'completed', 'failed', 'archived')),
	CONSTRAINT "sessions_source_type_check" CHECK (source_type IN ('dashboard', 'slack', 'api', 'trigger'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"subscription_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"billing_plan_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text DEFAULT 'trialing' NOT NULL,
	"current_period_start_time" timestamp with time zone,
	"current_period_end_time" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'cancelled', 'unpaid'))
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"tool_call_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text,
	"tool_name" text NOT NULL,
	"tool_status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error_message" text,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_time" timestamp with time zone,
	"completed_time" timestamp with time zone,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "tool_calls_status_check" CHECK (tool_status IN ('pending', 'running', 'completed', 'failed', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"trigger_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"node_id" text,
	"trigger_type" text NOT NULL,
	"trigger_status" text DEFAULT 'active' NOT NULL,
	"trigger_config" jsonb NOT NULL,
	"schedule_expression" text,
	"next_run_time" timestamp with time zone,
	"last_run_time" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "triggers_type_check" CHECK (trigger_type IN ('manual', 'slack_mention', 'slack_channel', 'webhook', 'schedule')),
	CONSTRAINT "triggers_status_check" CHECK (trigger_status IN ('active', 'paused', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"usage_record_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text,
	"session_id" text,
	"run_id" text,
	"usage_date" date NOT NULL,
	"usage_kind" text NOT NULL,
	"provider" text,
	"quantity" numeric NOT NULL,
	"unit" text NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "usage_records_kind_check" CHECK (usage_kind IN ('llm_tokens', 'tool_call', 'browser_minutes', 'storage_bytes', 'message'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"external_identity_provider" text,
	"external_identity_id" text,
	"user_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "users_status_check" CHECK (user_status IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_member_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"member_role" text DEFAULT 'owner' NOT NULL,
	"member_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "workspace_members_role_check" CHECK (member_role IN ('owner', 'admin', 'member')),
	CONSTRAINT "workspace_members_status_check" CHECK (member_status IN ('active', 'invited', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"workspace_name" text NOT NULL,
	"workspace_slug" text NOT NULL,
	"workspace_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "workspaces_status_check" CHECK (workspace_status IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE INDEX "idx_agents_workspace" ON "agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_apps_slug_unique" ON "apps" USING btree ("app_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billing_plans_slug_unique" ON "billing_plans" USING btree ("plan_slug");--> statement-breakpoint
CREATE INDEX "idx_connections_workspace_app" ON "connections" USING btree ("workspace_id","app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_nodes_app_slug_unique" ON "nodes" USING btree ("app_id","node_slug");--> statement-breakpoint
CREATE INDEX "idx_nodes_kind_status" ON "nodes" USING btree ("node_kind","node_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_run_messages_session_sequence_unique" ON "run_messages" USING btree ("session_id","message_sequence");--> statement-breakpoint
CREATE INDEX "idx_run_messages_run" ON "run_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_runs_session_created" ON "runs" USING btree ("session_id","created_time");--> statement-breakpoint
CREATE INDEX "idx_runs_status" ON "runs" USING btree ("run_status");--> statement-breakpoint
CREATE INDEX "idx_sessions_workspace_updated" ON "sessions" USING btree ("workspace_id","last_updated_time");--> statement-breakpoint
CREATE INDEX "idx_sessions_agent" ON "sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_workspace" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_run" ON "tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_tool_status" ON "tool_calls" USING btree ("tool_name","tool_status");--> statement-breakpoint
CREATE INDEX "idx_triggers_workspace_agent" ON "triggers" USING btree ("workspace_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_usage_records_workspace_date" ON "usage_records" USING btree ("workspace_id","usage_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspace_members_workspace_user_unique" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_user" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspaces_slug_unique" ON "workspaces" USING btree ("workspace_slug");